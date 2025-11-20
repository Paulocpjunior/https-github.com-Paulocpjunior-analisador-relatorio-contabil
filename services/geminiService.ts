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
          possible_inversion: { type: Type.BOOLEAN, description: "True if the nature contradicts standard rules (e.g., Asset with Credit balance, or DRE misclassification under IFRS 18)" },
          ifrs18_category: { type: Type.STRING, enum: ['Operacional', 'Investimento', 'Financiamento'], nullable: true, description: "Only for DRE: Classify according to IFRS 18." }
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
   - **CLASSIFICAÇÃO OBRIGATÓRIA**: Para cada conta da DRE, preencha o campo \`ifrs18_category\` com:
     - **Operacional**: Receitas e despesas da atividade principal, custos, despesas administrativas/vendas. (Categoria Padrão).
     - **Investimento**: Receitas/despesas de coligadas, dividendos recebidos, ganhos/perdas na baixa de ativos não correntes.
     - **Financiamento**: Despesas de juros bancários, variações cambiais de dívidas, receitas de aplicações financeiras.
   - Valide se os subtotais (especialmente o **Resultado Operacional**) estão consistentes com os itens listados acima deles.
   - Use o campo \`observations\` para apontar desvios significativos da estrutura IFRS 18.
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
            text: "Analise este documento contábil. Identifique se é Balanço, Balancete ou DRE. Se for DRE, classifique cada linha obrigatoriamente conforme categorias IFRS 18 (Operacional, Investimento, Financiamento). Extraia os dados para o formato JSON solicitado."
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

export const generateFinancialInsight = async (
  analysisData: AnalysisResult,
  userPrompt: string,
  multiple: number
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not found.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Prepare a summarized version of accounts to save tokens but provide enough context
  const accountsContext = analysisData.accounts
    .map(a => `${a.account_name}: ${a.total_value} (${a.type}) [IFRS18: ${a.ifrs18_category || 'N/A'}]`)
    .join('\n');

  const systemInstruction = `
    Você é um Consultor Financeiro especializado em Valuation e Análise de Balanços.
    Você receberá uma lista de contas contábeis extraídas de um documento (${analysisData.summary.document_type}).
    
    SUA TAREFA:
    1. Identificar as contas necessárias para calcular o **EBITDA** (Lucro Antes de Juros, Impostos, Depreciação e Amortização).
       - Tente identificar explicitamente ou estimar: Resultado Líquido, Juros (Despesas Financeiras), Impostos (IR/CSLL) e Depreciação/Amortização.
    2. Calcular o EBITDA estimado.
    3. Calcular o **Valuation** da empresa utilizando o método de Múltiplos de EBITDA.
    4. O Múltiplo a ser utilizado é: **${multiple}x**.
    5. Responder à solicitação específica do usuário: "${userPrompt}".
    
    FORMATO DA RESPOSTA:
    - Retorne um texto claro, formatado e profissional.
    - Destaque o valor do EBITDA encontrado e **quais contas foram somadas/subtraídas** para chegar nele.
    - Destaque o valor do Valuation Final (EBITDA * ${multiple}).
    - Se não for possível calcular (ex: dados insuficientes), explique o motivo.
    - Use Markdown para titulos e negrito.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [{ text: `Dados Contábeis:\n${accountsContext}\n\nPergunta do Usuário: ${userPrompt}` }]
    },
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.4,
    }
  });

  return response.text || "Não foi possível gerar a análise financeira.";
};

export const generateCMVAnalysis = async (
  analysisData: AnalysisResult
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not found.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const accountsContext = analysisData.accounts
    .map(a => `${a.account_code || ''} ${a.account_name}: ${a.total_value} (${a.type})`)
    .join('\n');

  const systemInstruction = `
    Você é um Perito Contábil e Auditor Fiscal Brasileiro, especialista em **Custos (CPC 16)** e **Legislação Tributária Vigente (RIR/2018)**.
    
    SUA TAREFA:
    Realizar uma análise profunda e técnica do **CMV (Custo das Mercadorias Vendidas)** ou CPV/CSP, com base nas contas fornecidas.

    DIRETRIZES ESTRITAS DE LEGISLAÇÃO:
    1. **Identificação dos Componentes**:
       - Localize contas de Estoque Inicial, Compras de Mercadorias/Insumos e Estoque Final.
       - Identifique contas redutoras de custo (Devoluções de Compras, Abatimentos).
       - Identifique contas de impostos recuperáveis (ICMS, PIS, COFINS sobre compras) que devem ser deduzidos do custo conforme o Princípio da Não-Cumulatividade (se aplicável ao regime tributário implícito).
       - Se houver uma conta direta de "CMV" ou "Custo dos Produtos Vendidos", utilize-a como base, mas audite sua composição se possível.

    2. **Cálculo e Validação**:
       - Aplique a fórmula: **CMV = EI + C - EF** (Estoque Inicial + Compras Líquidas - Estoque Final).
       - Se os dados forem parciais (ex: apenas DRE sem movimentação de estoque), analise a representatividade do CMV sobre a Receita Líquida (Margem Bruta).

    3. **Análise Crítica (Gemini 3)**:
       - Compare o CMV encontrado com benchmarks típicos de mercado (indique se parece alto ou baixo).
       - Aponte possíveis riscos fiscais (ex: falta de crédito de PIS/COFINS, subavaliação de estoque final).
       - Cite normas do CPC 16 (Estoques) relevantes para o caso.

    FORMATO DE SAÍDA (MARKDOWN):
    - **Título**: Análise Técnica de CMV (Legislação Vigente).
    - **Composição do Cálculo**: Mostre os valores usados.
    - **Indicadores**: Margem Bruta (%) e Markup implícito.
    - **Parecer Técnico**: Conformidade com normas, pontos de atenção e sugestões de melhoria.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview', // Using Gemini 3 as requested for high-level reasoning
    contents: {
      parts: [{ text: `Analise as seguintes contas contábeis extraídas e gere um relatório detalhado de CMV:\n\n${accountsContext}` }]
    },
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.3, // Low temperature for factual/legislative accuracy
    }
  });

  return response.text || "Não foi possível gerar a análise de CMV.";
};