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
        total_debits: { type: Type.NUMBER, description: "Sum of all extracted debit values" },
        total_credits: { type: Type.NUMBER, description: "Sum of all extracted credit values" },
        is_balanced: { type: Type.BOOLEAN, description: "True if total debits equal total credits (within small rounding margin)" },
        discrepancy_amount: { type: Type.NUMBER, description: "Absolute difference between debits and credits" },
        observations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of key findings, anomalies, or missing information" }
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
          total_value: { type: Type.NUMBER, description: "Net value of the account if debits/credits aren't separate, or the primary value listed" },
          type: { type: Type.STRING, enum: ['Debit', 'Credit', 'Unknown'] },
          possible_inversion: { type: Type.BOOLEAN, description: "True if the account balance nature (Debit/Credit) contradicts standard accounting rules for this account type (excluding standard redactor accounts)." }
        },
        required: ["account_name", "debit_value", "credit_value", "total_value", "type", "possible_inversion"]
      }
    },
    spell_check: {
      type: Type.ARRAY,
      description: "List of potential misspellings in account names based on standard Portuguese accounting terminology",
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
Você é um auditor contábil experiente e especialista em análise de documentos financeiros brasileiros (Balanço Patrimonial, DRE, Balancetes).
Sua tarefa é realizar OCR e analisar a imagem ou PDF fornecido.

DIRETRIZES DE OCR E EXTRAÇÃO:
1. **Layouts Complexos**: Esteja atento a layouts onde o nome da conta está muito distante do valor.
2. **Códigos vs Valores**: Diferencie claramente códigos de conta (ex: "1.1.01") de valores monetários.
3. **Colunas**: Identifique corretamente as colunas de Débito e Crédito se existirem separadamente.
4. **Extração Completa**: Extraia TODAS as linhas que representam contas com saldos.

DIRETRIZES DE ANÁLISE CONTÁBIL:
1. **Balanço Matemático**: Realize a soma independente dos débitos e créditos para verificar se o documento fecha.
2. **Verificação Ortográfica**: Identifique erros de grafia nos nomes das contas.
3. **ANÁLISE DE INVERSÃO DE NATUREZA (CRÍTICO)**:
   - Para cada conta, determine se seu saldo (Devedor/Debit ou Credor/Credit) está invertido em relação à sua natureza padrão no Plano de Contas Brasileiro.
   - Regra Geral: Ativo/Despesa = Natureza Devedora. Passivo/PL/Receita = Natureza Credora.
   - **ATENÇÃO ÀS EXCEÇÕES (CONTAS REDUTORAS)**: Não marque como inversão contas que são naturalmente contrárias ao seu grupo (ex: "Depreciação Acumulada" no Ativo é legitimamente Credora; "Prejuízos Acumulados" no PL é legitimamente Devedora).
   - Marque \`possible_inversion: true\` APENAS se for uma anomalia real (ex: "Caixa" ou "Bancos" com saldo Credor, "Fornecedores" com saldo Devedor sem indicativo de adiantamento).
`;

  try {
    // Using gemini-2.5-pro for complex OCR tasks as recommended
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
            text: "Analise este documento contábil e extraia os dados estruturados conforme o esquema JSON especificado, com atenção especial para possíveis inversões de natureza das contas."
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
        // Lower temperature for precise data extraction
        temperature: 0.1,
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
        // Fallback basic trim if regex fails (unlikely if it's valid JSON)
        text = text.trim();
    }

    return JSON.parse(text) as AnalysisResult;
  } catch (error) {
    console.error("Error analyzing document:", error);
    // Provide a more user-friendly error for JSON parse issues (often due to cutoff)
    if (error instanceof SyntaxError && error.message.toLowerCase().includes('json')) {
        throw new Error("A resposta da IA foi interrompida ou é inválida. O documento pode ser muito extenso. Tente novamente.");
    }
    throw error;
  }
};