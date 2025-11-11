import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AnalysisResult } from "../types";

// Define the expected JSON schema for the model output to ensure strict typing.
const analysisSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.OBJECT,
      properties: {
        document_type: { type: Type.STRING, enum: ['Balanço Patrimonial', 'Balancete', 'DRE', 'Outro'] },
        total_debits: { type: Type.NUMBER, description: "Sum of all extracted debit values (or total expenses in DRE)" },
        total_credits: { type: Type.NUMBER, description: "Sum of all extracted credit values (or total revenues in DRE)" },
        is_balanced: { type: Type.BOOLEAN, description: "True if totals match expected accounting rules for the document type" },
        discrepancy_amount: { type: Type.NUMBER, description: "Absolute difference if not balanced" },
        observations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of key findings, IFRS 18 anomalies for DRE, or general anomalies" }
      },
      required: ["document_type", "total_debits", "total_credits", "is_balanced", "discrepancy_amount", "observations"]
    },
    accounts: {
      type: Type.ARRAY,
      description: "List of all individual line items/accounts extracted from the document",
      items: {
        type: Type.OBJECT,
        properties: {
          account_code: { type: Type.STRING, nullable: true },
          account_name: { type: Type.STRING },
          debit_value: { type: Type.NUMBER },
          credit_value: { type: Type.NUMBER },
          total_value: { type: Type.NUMBER, description: "Net value" },
          type: { type: Type.STRING, enum: ['Debit', 'Credit', 'Unknown'] },
          possible_inversion: { type: Type.BOOLEAN, description: "True if the nature contradicts standard rules (e.g., Asset with Credit balance, or DRE misclassification under IFRS 18)" }
        },
        required: ["account_name", "debit_value", "credit_value", "total_value", "type", "possible_inversion"]
      }
    },
    spell_check: {
      type: Type.ARRAY,
      description: "List of potential misspellings in account names",
      items: {
        type: Type.OBJECT,
        properties: {
          original_term: { type: Type.STRING },
          suggested_correction: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] }
        },
        required: ["original_term", "suggested_correction", "confidence"]
      }
    }
  },
  required: ["summary", "accounts", "spell_check"]
};

export const analyzeDocument = async (fileBase64: string, mimeType: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not found. Please ensure process.env.API_KEY is set.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
Você é um auditor contábil experiente (CPA/CRC) e especialista em análise de documentos financeiros brasileiros.
Sua especialidade abrange três tipos principais de relatórios: **Balanço Patrimonial**, **Balancete** e **DRE (Demonstração do Resultado do Exercício)**.

SUA MISSÃO: Realizar OCR de alta precisão, identificar o tipo do documento e extrair os dados contábeis estruturados, validando a consistência conforme as normas aplicáveis.

DIRETRIZES GERAIS (OCR & EXTRAÇÃO):
1. **Extração Completa**: Extraia TODAS as linhas que contêm contas ou grupos contábeis com saldos.
2. **Layouts Difíceis**: Atenção a documentos onde o nome da conta está longe do valor.
3. **Diferenciação**: Não confunda códigos de conta (ex: "3.01.01") com valores monetários.

DIRETRIZES ESPECÍFICAS POR TIPO DE DOCUMENTO:

--- TIPO 1 & 2: BALANÇO PATRIMONIAL E BALANCETE ---
1. **Validação Fundamental**: Verifique se Total Ativo = Total Passivo + Patrimônio Líquido (ou se a soma de Débitos = soma de Créditos no Balancete).
2. **Naturezas Padrão**: Ativo/Despesa = Natureza Devedora (Debit). Passivo/PL/Receita = Natureza Credora (Credit).
3. **Inversões**: Marque \`possible_inversion: true\` para contas com saldo contrário à sua natureza (ex: "Fornecedores" com saldo Devedor sem ser adiantamento). Ignore contas redutoras legítimas (ex: Depreciação Acumulada).

--- TIPO 3: DRE (DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO) ---
1. **NORMA DE REFERÊNCIA: IFRS 18**:
   - Utilize a **IFRS 18** como base mandatória para análise da estrutura da DRE.
   - Verifique a correta classificação dos itens nas categorias exigidas pela IFRS 18: **Operacional**, **Investimento** e **Financiamento**.
   - Valide se os subtotais (especialmente o **Resultado Operacional**) estão consistentes com os itens listados acima deles.
   - Use o campo \`observations\` para apontar desvios significativos da estrutura IFRS 18 (ex: itens operacionais classificados incorretamente como financeiros).
2. **Mapeamento para JSON (Importante)**:
   - Como DREs muitas vezes têm apenas uma coluna de valores:
   - Mapeie **Despesas, Custos e Perdas** como \`debit_value\` (Natureza 'Debit').
   - Mapeie **Receitas e Ganhos** como \`credit_value\` (Natureza 'Credit').
   - O Resultado Líquido deve ser verificado matematicamente.

SE O DOCUMENTO NÃO FOR NENHUM DESSES TRÊS:
Classifique como 'Outro' e tente extrair o máximo de informações financeiras estruturadas possível.
`;

  try {
    // Using gemini-2.5-pro for complex OCR and accounting standard reasoning
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: fileBase64
            }
          },
          {
            text: "Analise este documento contábil. Identifique se é Balanço, Balancete ou DRE. Se for DRE, aplique rigorosamente as diretrizes da IFRS 18. Extraia os dados para o formato JSON solicitado."
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
        // Temperature 0 for maximum determinism in data extraction
        temperature: 0.0,
      }
    });

    let text = response.text;
    if (!text) {
      throw new Error("O modelo não retornou dados. O documento pode estar ilegível, em branco, ou foi bloqueado por políticas de segurança.");
    }

    // Robust sanitization: Find the first '{' and last '}' to extract generic JSON if wrapped in other text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        text = jsonMatch[0];
    } else {
        text = text.trim();
    }

    return JSON.parse(text) as AnalysisResult;
  } catch (error) {
    console.error("Error analyzing document:", error);
    if (error instanceof SyntaxError && error.message.toLowerCase().includes('json')) {
        throw new Error("A resposta da IA foi interrompida ou é inválida. O documento pode ser muito extenso. Tente novamente.");
    }
    throw error;
  }
};
