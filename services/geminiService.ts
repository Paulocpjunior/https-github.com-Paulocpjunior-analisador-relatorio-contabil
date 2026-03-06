import { GoogleGenerativeAI } from "@google/generative-ai";
import { AnalysisResult, ExtractedAccount, ComparisonRow } from "../types";

// COLOQUE A CHAVE DIRETAMENTE AQUI PARA TESTE REAL
const API_KEY = "AIzaSyC2GL-BPbkMuCKNAFEHDaKgRvZkKYUjKAY";
const genAI = new GoogleGenerativeAI(API_KEY);

// A partir daqui, remova a linha "const apiKey = import.meta.env..." de dentro das funções
// e use diretamente o "genAI" que definimos aqui no topo.        const base64Data = fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64;

        const result = await model.generateContent([
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                }
            },
            { text: "Extraia os dados deste balancete contábil. Retorne uma lista de contas com Código, Nome e Saldo Final." }
        ]);

        const response = await result.response;
        console.log(response.text());
        
        // Retorno básico para teste
        return {
            summary: { document_type: 'Balancete', period: 'Identificado', total_debits: 0, total_credits: 0, is_balanced: true, discrepancy_amount: 0, observations: [], specific_result_value: 0, specific_result_label: 'Resultado' },
            accounts: [],
            spell_check: []
        };
    } catch (error: any) {
        console.error(error);
        throw new Error("Erro na extração: " + error.message);
    }
};

// Mantenha as outras funções vazias apenas para não dar erro de compilação por enquanto
export const generateFinancialInsight = async () => "";
export const generateCMVAnalysis = async () => "";
export const generateSpedComplianceCheck = async () => "";
export const chatWithFinancialAgent = async () => "";
export const generateComparisonAnalysis = async () => "";
