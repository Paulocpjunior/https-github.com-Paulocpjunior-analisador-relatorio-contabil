import { GoogleGenerativeAI } from "@google/generative-ai";

// CHAVE CONFIGURADA DIRETAMENTE - TESTE FINAL
const API_KEY = "AIzaSyC2GL-BPbkMuCKNAFEHDaKgRvZkKYUjKAY";
const genAI = new GoogleGenerativeAI(API_KEY);

export const analyzeDocument = async (fileBase64: string, mimeType: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // Limpa o base64 removendo o prefixo se existir
    const base64Data = fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      },
      { text: "Extraia os dados deste balancete contábil: Código, Nome da Conta e Saldo Final." }
    ]);

    const response = await result.response;
    const text = response.text();

    return {
      summary: { 
        document_type: 'Balancete', 
        period: 'Análise Realizada', 
        total_debits: 0, 
        total_credits: 0, 
        is_balanced: true, 
        discrepancy_amount: 0, 
        observations: [text], 
        specific_result_value: 0, 
        specific_result_label: 'Resultado' 
      },
      accounts: [],
      spell_check: []
    };
  } catch (error: any) {
    console.error("ERRO GEMINI:", error);
    throw new Error("Erro na extração: " + (error.message || "Erro de API"));
  }
};

export const generateFinancialInsight = async () => "";
export const generateCMVAnalysis = async () => "";
export const generateSpedComplianceCheck = async () => "";
export const chatWithFinancialAgent = async () => "";
export const generateComparisonAnalysis = async () => "";
