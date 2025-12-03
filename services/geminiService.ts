import { GoogleGenAI, GenerateContentResponse, HarmCategory, HarmBlockThreshold, Chat } from "@google/genai";
import { AnalysisResult, ExtractedAccount, ComparisonRow } from "../types";

// Helper for Exponential Backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, baseDelay = 3000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const message = error?.message || '';
    const status = error?.status || error?.code;
    
    // 404 Model Not Found - Do not retry specific model errors
    if (message.includes('404') || message.includes('not found')) {
        throw error;
    }

    if (retries > 0) {
      console.warn(`API Error (${status}). Retrying in ${baseDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, baseDelay));
      return retryWithBackoff(fn, retries - 1, baseDelay * 2);
    }
    throw error;
  }
}

// Helper to safely decode Base64 (handling UTF-8)
function safeDecodeBase64(str: string): string {
    try {
        return decodeURIComponent(escape(window.atob(str)));
    } catch (e) {
        return window.atob(str);
    }
}

// --- ROBUST FINANCIAL NUMBER PARSER (MULTI-FORMAT) ---
function parseFinancialNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  
  if (typeof val === 'string') {
    let clean = val.trim();
    clean = clean.replace(/[R$]/gi, '').trim();
    clean = clean.replace(/[OolI]/g, (m) => m === 'I' || m === 'l' ? '1' : '0'); 
    clean = clean.replace(/[\s\d][DC]$/i, (m) => m.slice(0, -1));

    const isNegativeParens = /^\(.*\)$/.test(clean);
    clean = clean.replace(/[()]/g, '');
    clean = clean.replace(/\s+/g, '');

    // HEURISTIC: Detect Format (Comma vs Dot Decimal)
    const lastCommaIndex = clean.lastIndexOf(',');
    const lastDotIndex = clean.lastIndexOf('.');
    let isBRFormat = true; 

    if (lastCommaIndex > -1 && lastDotIndex > -1) {
        if (lastDotIndex > lastCommaIndex) isBRFormat = false; // US: 1,000.00
    } else if (lastCommaIndex > -1 && lastDotIndex === -1) {
        isBRFormat = true; 
    } else if (lastDotIndex > -1 && lastCommaIndex === -1) {
        if (clean.match(/^\d{1,3}(\.\d{3})+$/)) {
            clean = clean.replace(/\./g, '');
            isBRFormat = false; // It's now clean int
        } else {
             isBRFormat = false; // It's 100.50
        }
    }

    if (isBRFormat) {
        clean = clean.replace(/\./g, '');
        clean = clean.replace(',', '.'); 
    } else {
        clean = clean.replace(/,/g, '');
    }

    clean = clean.replace(/[^0-9.-]/g, '');
    let num = parseFloat(clean);
    if (isNegativeParens) num = -Math.abs(num);
    
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// --- LOGIC TO DETECT INVERSIONS ---
function checkInversion(name: string, type: 'Debit' | 'Credit', finalBalance: number, indicator?: string | null): boolean {
    const lower = name.toLowerCase();
    
    if (indicator) {
        if (type === 'Debit' && indicator === 'C') return true;
        if (type === 'Credit' && indicator === 'D') return true;
    }

    if (lower.includes('caixa') || lower.includes('banco') || lower.includes('cliente') || lower.includes('ativo') || lower.includes('estoque') || lower.includes('despesa') || lower.includes('custo') || lower.includes('imobilizado')) {
        if (finalBalance < -0.01) return true;
    }

    if (lower.includes('fornecedor') || lower.includes('pagar') || lower.includes('imposto') || lower.includes('capital') || lower.includes('receita') || lower.includes('passivo') || lower.includes('patrimonio') || lower.includes('reserva')) {
        if (finalBalance < -0.01) return true;
    }

    return false;
}

// --- SMART COLUMN MAPPER ---
function mapValuesToColumns(numbers: number[], type: 'Debit' | 'Credit'): { initial: number, debit: number, credit: number, final: number } {
    const count = numbers.length;
    let initial = 0, debit = 0, credit = 0, final = 0;

    // Standard Balancete: Initial | Debit | Credit | Final
    if (count >= 4) {
        [initial, debit, credit, final] = numbers.slice(-4);
    } 
    // Standard DRE or Simple Balancete: Debit | Credit | Final
    else if (count === 3) {
        [debit, credit, final] = numbers;
    } 
    // Just movement: Debit | Credit
    else if (count === 2) {
        [debit, credit] = numbers;
        // Calc final just for reference
        final = type === 'Debit' ? debit - credit : credit - debit;
    } 
    // Just final balance
    else if (count === 1) {
        final = numbers[0];
    }

    return { initial, debit, credit, final };
}

// --- DATA NORMALIZATION & ANALYSIS ---
function normalizeFinancialData(rawLines: string[], docType: string): AnalysisResult {
  const accounts: ExtractedAccount[] = [];
  const numberPattern = /-?\(?[\d]+(?:[.,]\d{3})*(?:[.,]\d+)?\)?/g;

  let explicitResultValue: number | undefined = undefined;
  let explicitResultLabel: string | undefined = undefined;

  // --- PASS 1: PARSING ---
  rawLines.forEach(line => {
      let cleanLine = line.replace(/;/g, ' ').trim();
      const isPipe = line.includes('|');
      if (isPipe) cleanLine = line.replace(/\|/g, '   '); 
      
      if (cleanLine.length < 3) return;

      let natureIndicator: string | null = null;
      const dcMatch = cleanLine.match(/[\s\d]([DC])\s*$/i) || cleanLine.match(/\(([DC])\)\s*$/i);
      if (dcMatch) natureIndicator = dcMatch[1].toUpperCase();

      const allNumbersMatch = cleanLine.match(numberPattern) || [];
      const parsedNumbers = allNumbersMatch.map(n => parseFinancialNumber(n)).filter(n => !isNaN(n));
      
      let textPart = cleanLine;
      for (const numStr of allNumbersMatch) {
          const lastIndex = textPart.lastIndexOf(numStr);
          if (lastIndex > 5) { 
             textPart = textPart.substring(0, lastIndex) + textPart.substring(lastIndex + numStr.length);
          }
      }
      textPart = textPart.replace(/[\s]([DC])\s*$/i, '');
      textPart = textPart.trim().replace(/\s{2,}/g, ' ');

      const parts = textPart.split(' ');
      let code = '';
      let name = '';

      if (parts.length > 0 && /^[\d.-]+$/.test(parts[0]) && parts[0].length > 1) {
          code = parts[0];
          name = parts.slice(1).join(' ');
      } else {
           if (textPart.toLowerCase().includes('resultado') || textPart.toLowerCase().includes('lucro') || textPart.toLowerCase().includes('prejuízo')) {
               name = textPart;
           } else {
               name = textPart;
           }
      }
      
      if (name.length < 2) return;

      let type: 'Debit' | 'Credit' = 'Debit';
      const lowerName = name.toLowerCase();
      if (lowerName.includes('passivo') || lowerName.includes('receita') || lowerName.includes('fornecedor') || lowerName.includes('patrimonio') || lowerName.includes('obriga') || lowerName.includes('capital') || lowerName.includes('a pagar')) {
          type = 'Credit';
      }

      if (code && parsedNumbers.length > 0) {
           const codeNum = parseFloat(code.replace(/[.-]/g, ''));
           if (Math.abs(parsedNumbers[0] - codeNum) < 0.001) parsedNumbers.shift();
      }

      const values = mapValuesToColumns(parsedNumbers, type);

      // Temporary synthetic flag, will be recalculated in Pass 2
      let isSynthetic = false; 
      if (lowerName.includes('lucro') || lowerName.includes('prejuízo') || lowerName.includes('resultado do')) {
          if (lowerName.includes('líquido') || lowerName.includes('exercício')) {
             explicitResultValue = values.final;
             explicitResultLabel = name;
          }
      }
      
      // Categorization for IFRS
      let category = null;
      if (docType === 'DRE') {
           if (lowerName.includes('receita') || lowerName.includes('custo') || lowerName.includes('despesa')) category = 'Operacional';
           else if (lowerName.includes('invest') || lowerName.includes('imobiliz')) category = 'Investimento';
           else if (lowerName.includes('juro') || lowerName.includes('financ')) category = 'Financiamento';
           else category = 'Operacional';
      }

      const possibleInversion = checkInversion(name, type, values.final, natureIndicator);

      accounts.push({
          account_code: code,
          account_name: name,
          initial_balance: values.initial,
          debit_value: values.debit,
          credit_value: values.credit,
          final_balance: values.final,
          total_value: values.final,
          type,
          possible_inversion: possibleInversion,
          ifrs18_category: category as any,
          level: 1, // Will calc later
          is_synthetic: isSynthetic
      });
  });

  // --- PASS 2: TREE HIERARCHY & TOTALS ---
  // To get correct sums, we must ONLY sum "Leaf Nodes" (Analytical Accounts).
  // A Leaf Node is an account that is NOT a parent of any other account.

  // 1. Sort by code length to handle hierarchy correctly
  accounts.sort((a, b) => (a.account_code || '').localeCompare(b.account_code || ''));

  const codeSet = new Set(accounts.map(a => a.account_code).filter(c => c));

  accounts.forEach(acc => {
      // Determine Synthetic Status
      let isParent = false;
      if (acc.account_code) {
          // It is a parent if any other account starts with this code + separator
          // Example: '1' is parent if '1.' or '1-' exists in another code
          // Optimization: Check the sorted list or Set
          // Simple check: iterate all (O(N^2) but N is small < 1000 usually)
          isParent = accounts.some(other => 
              other !== acc && 
              other.account_code && 
              other.account_code.startsWith(acc.account_code!) && 
              other.account_code.length > acc.account_code!.length
          );
      }
      
      // Fallback if no codes: Check keywords
      if (!acc.account_code || acc.account_code.length === 0) {
          const lower = acc.account_name.toLowerCase();
          if (lower.startsWith('total') || lower.startsWith('soma') || lower.startsWith('resultado')) {
              isParent = true; // Treated as synthetic for summation purposes (don't add to grand total)
          }
      }

      acc.is_synthetic = isParent;
      
      // Determine Level based on separators
      if (acc.account_code) {
          acc.level = acc.account_code.split(/[.-]/).length;
      }
  });

  // --- CALCULATION ---
  // Sum ONLY analytical accounts (Not Synthetic)
  let total_debits = 0;
  let total_credits = 0;

  const analyticalAccounts = accounts.filter(a => !a.is_synthetic);

  // If hierarchy detection failed (e.g. no codes found), analyticalAccounts might be empty or wrong.
  // Fallback: If we have very few analytical accounts (< 10% of total), assume flat list and filter by name.
  if (analyticalAccounts.length < accounts.length * 0.1 && accounts.length > 5) {
      console.warn("Hierarchy detection weak. Using fallback summation.");
      total_debits = accounts.reduce((sum, a) => {
           if (a.account_name.toLowerCase().includes('total') || a.account_name.toLowerCase().includes('soma')) return sum;
           return sum + a.debit_value;
      }, 0);
      total_credits = accounts.reduce((sum, a) => {
           if (a.account_name.toLowerCase().includes('total') || a.account_name.toLowerCase().includes('soma')) return sum;
           return sum + a.credit_value;
      }, 0);
  } else {
      // Standard accurate summation
      total_debits = analyticalAccounts.reduce((sum, a) => sum + a.debit_value, 0);
      total_credits = analyticalAccounts.reduce((sum, a) => sum + a.credit_value, 0);
  }

  const discrepancy = Math.abs(total_debits - total_credits);

  if (explicitResultValue === undefined) {
      explicitResultValue = total_credits - total_debits;
  }

  return {
      summary: {
          document_type: docType as any,
          period: 'A definir',
          total_debits,
          total_credits,
          is_balanced: discrepancy < 1.0,
          discrepancy_amount: discrepancy,
          observations: [],
          specific_result_value: explicitResultValue,
          specific_result_label: explicitResultLabel
      },
      accounts,
      spell_check: []
  };
}

// --- STEP 1: RAW EXTRACTION ---
async function extractRawData(ai: GoogleGenAI, fileBase64: string, mimeType: string): Promise<{lines: string[], docType: string}> {
    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    let promptText = `
    ROLE: Expert Financial OCR & Data Extractor.
    TASK: Extract accounting data from complex, potentially messy financial reports (PDF/Image) into structured text.

    CRITICAL INSTRUCTIONS FOR COMPLEX TABLES:
    1. **Structure Detection**: Identify rows that represent accounting accounts. 
       - Look for columns: [Code] | [Account Name] | [Balance/Values].
    2. **Handle Merged/Misaligned Data**: 
       - If a row spans multiple lines visually (e.g. name wraps), merge it into a single logical line.
       - If columns are empty (e.g. no Initial Balance), assume 0,00 or keep blank but maintain alignment.
    3. **Ignore Layout Noise**: 
       - Disregard page headers, footers, page numbers ("Página X de Y"), dates printed at top/bottom, and separator lines.
    4. **Column Separation**: 
       - Use the pipe character '|' strictly to separate columns.
    5. **Number Integrity**: 
       - Extract ALL numeric columns found (Initial, Debit, Credit, Final). Do not skip columns.
       - Keep original formatting (e.g., "1.000,00"). 
       - PRESERVE negative signs or parenthesis '()'.
       - PRESERVE 'D' (Debit) or 'C' (Credit) indicators at the end of the line.

    OUTPUT FORMAT (Strict text lines):
    Code | Account Description | Value 1 | Value 2 | ... | Final Value (D/C)
    
    EXAMPLES:
    1.01.01 | Caixa Geral | 0,00 | 1.500,00 | 0,00 | 1.500,00 D
    2.01.03 | Fornecedores Nacionais | 200,00 C | 500,00 | 0,00 | 700,00 C
    3.01 | Receita Bruta de Vendas e Serviços | (10.000,00) | C
    
    NOTE: If the document contains multiple periods (e.g., 2024 and 2023), try to extract both if they are on the same row, or prioritize the most recent period.
    `;

    try {
        console.log(`Starting Extraction for ${mimeType}...`);
        
        let contents;
        let isBinary = false;
        
        // OPTIMIZATION: Handle Text/CSV as direct text to avoid 'inlineData' parsing issues with some models
        if (mimeType === 'text/csv' || mimeType === 'text/plain' || mimeType === 'application/csv') {
            const decodedText = safeDecodeBase64(fileBase64);
            
            // Check for SPED signature (lines starting with |)
            const isSped = decodedText.includes('|I050|') || decodedText.includes('|J100|') || decodedText.includes('|0000|');
            
            if (isSped) {
                promptText = `
                ROLE: SPED Parser.
                TASK: Extract relevant financial registers (I050, J100, etc) from SPED content.
                RULES:
                1. Focus on Account Plan (I050) and Balances/DRE.
                2. Return readable lines: Code | Name | Type | Balance.
                3. Keep the layout logic if possible.
                `;
            }

            contents = { parts: [
                { text: promptText },
                { text: `\n\n--- INPUT DOCUMENT CONTENT (${mimeType}) ---\n${decodedText.substring(0, 100000)}\n--- END INPUT ---` } // Truncate very large texts if needed, though tokens are generous
            ]};
        } else {
            // Binary formats (PDF, Image) use inlineData
            isBinary = true;
            contents = { parts: [
                { inlineData: { mimeType: mimeType, data: fileBase64 } },
                { text: promptText }
            ]};
        }

        const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: { temperature: 0.1, maxOutputTokens: 8192, safetySettings: safetySettings }
        }));

        let text = "";
        try {
            text = response.text || "";
        } catch (e) {
            console.warn("Could not read response text.");
        }
        
        // FALLBACK: If standard prompt fails (empty text), try a very simple one.
        // This handles cases where the model gets confused by complex instructions on complex PDFs.
        if (!text || text.length < 50) {
            console.warn("Short response received. Attempting fallback with simplified prompt...");
            
            const simplePrompt = "Extract all accounting table rows from this document. Format: Code | Account | Value.";
            let fallbackContents;
            
            if (isBinary) {
                fallbackContents = { parts: [
                    { inlineData: { mimeType: mimeType, data: fileBase64 } },
                    { text: simplePrompt }
                ]};
            } else {
                 fallbackContents = { parts: [
                    { text: simplePrompt },
                    contents.parts[1]
                ]};
            }
            
            const fallbackResponse = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: fallbackContents,
                config: { temperature: 0.1, maxOutputTokens: 8192, safetySettings: safetySettings }
            }));
            
            try {
                text = fallbackResponse.text || "";
            } catch(e) {}
        }

        if (text.length < 50) {
            console.error("Short response received:", text);
            throw new Error(`O modelo retornou dados insuficientes (${text.length} chars). O documento pode estar vazio ou ilegível.`);
        }

        const lines = text.split('\n').filter(l => l.trim().length > 0 && /\d/.test(l)); 

        let docType = 'Balancete';
        if (text.toLowerCase().includes('resultado') || text.toLowerCase().includes('receita operacional')) docType = 'DRE';
        if (text.toLowerCase().includes('ativo') && text.toLowerCase().includes('passivo')) docType = 'Balanço Patrimonial';

        return { lines, docType };

    } catch (e: any) {
        console.error("Extraction Error Detail:", e);
        throw new Error(`Erro na extração: ${e.message || "O modelo não retornou dados. O documento pode estar ilegível."}`);
    }
}

// --- STEP 2: NARRATIVE ANALYSIS & SPELL CHECK ---
async function generateNarrativeAnalysis(ai: GoogleGenAI, summaryData: any, sampleAccounts: string[]): Promise<{observations: string[], spellcheck: any[], period: string}> {
    const prompt = `
    ATUE COMO: Auditor Contábil Sênior.
    IDIOMA: PORTUGUÊS (BRASIL).
    
    DADOS:
    - Documento: ${summaryData.document_type}
    - Resultado: ${summaryData.specific_result_value}
    
    AMOSTRA DE CONTAS (Verifique erros de OCR e Ortografia):
    ${sampleAccounts.join('; ')}

    TAREFAS:
    1. Identifique o período contábil.
    2. Gere observações financeiras.
    3. VERIFICAÇÃO ORTOGRÁFICA: Identifique palavras com erros de digitação, acentuação ou OCR (ex: "Depreciacao", "Fornecadors", "Manutençao").
       - Liste TODAS as correções possíveis, mesmo com confiança média.
       - Se não houver erros óbvios, sugira melhorias de padronização (Ex: "Cx." -> "Caixa").

    SAÍDA JSON:
    {
      "period": "dd/mm/aaaa a dd/mm/aaaa",
      "observations": [ "Obs 1", "Obs 2" ],
      "spell_check": [ 
          { "original_term": "TermoErrado", "suggested_correction": "TermoCorreto", "confidence": "High" } 
      ]
    }
    `;

    try {
        const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: prompt }] },
            config: { responseMimeType: "application/json", temperature: 0.4 }
        }));
        
        return JSON.parse(response.text || '{}');
    } catch (e) {
        return { observations: [], spellcheck: [], period: "Indefinido" };
    }
}

export const analyzeDocument = async (fileBase64: string, mimeType: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) throw new Error("API Key not found.");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // 1. RAW EXTRACTION
  const { lines, docType } = await extractRawData(ai, fileBase64, mimeType);
  
  if (lines.length === 0) throw new Error("Nenhum dado encontrado no arquivo.");

  // 2. NORMALIZE & CALCULATE
  const result = normalizeFinancialData(lines, docType);

  if (result.accounts.length === 0) {
      throw new Error("O arquivo foi lido, mas nenhuma conta contábil válida foi identificada.");
  }

  // 3. NARRATIVE & SPELL CHECK
  const sample = result.accounts.slice(0, 150).map(a => a.account_name);
  const narrative = await generateNarrativeAnalysis(ai, result.summary, sample);

  result.summary.period = narrative.period || 'Período não identificado';
  result.summary.observations = narrative.observations || [];
  result.spell_check = narrative.spellcheck || [];

  return result;
};

export const generateFinancialInsight = async (
  analysisData: AnalysisResult,
  userPrompt: string,
  multiple: number,
  accountingStandard: string = 'IFRS 18 / CPC Brasil'
): Promise<string> => {
  if (!process.env.API_KEY) throw new Error("API Key not found.");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const topAccounts = (analysisData.accounts || [])
    .filter(a => !a.is_synthetic)
    .sort((a, b) => b.total_value - a.total_value)
    .slice(0, 150)
    .map(a => `${a.account_name}: ${a.final_balance}`)
    .join('\n');
  
  const systemInstruction = `
    Especialista em Valuation.
    Norma: ${accountingStandard}.
    Múltiplo: ${multiple}x EBITDA.
    Calculos Detalhados.
  `;

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [{ text: `DADOS:\n${topAccounts}\n\nPEDIDO:\n${userPrompt}` }] },
    config: { systemInstruction: systemInstruction, temperature: 0.4 }
  }));
  return response.text || "Sem resposta.";
};

export const generateCMVAnalysis = async (analysisData: AnalysisResult, accountingStandard: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const accounts = (analysisData.accounts || []).slice(0, 300).map(a => `${a.account_code} ${a.account_name}: ${a.total_value}`).join('\n');
    
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: { parts: [{ text: `Analise CMV com base nestas contas:\n${accounts}` }] },
      config: { systemInstruction: `Auditor de Custos (CMV). Norma: ${accountingStandard}.`, temperature: 0.3 }
    }));
    return response.text || "Sem resposta.";
};

export const generateSpedComplianceCheck = async (analysisData: AnalysisResult): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const accounts = (analysisData.accounts || [])
        .slice(0, 250) // Limit to avoid context overflow, focusing on main accounts
        .map(a => `${a.account_code || '?'} | ${a.account_name} | ${a.final_balance} (${a.type})`)
        .join('\n');

    const systemInstruction = `
    ATUE COMO: Especialista em SPED Contábil (ECD) e ECF.
    TAREFA: Analisar a lista de contas extraída e identificar potenciais problemas para validação no PVA (Programa Validador e Assinador).
    
    REGRAS DE ANÁLISE:
    1. **Estrutura de Contas:** Verifique se as contas analíticas/sintéticas parecem lógicas.
    2. **Natureza Invertida:** Aponte contas do Ativo/Despesa com saldo Credor ou Passivo/Receita com saldo Devedor (Erro grave no SPED).
    3. **Plano Referencial (Mapping):** Como os dados extraídos podem não ter o código referencial (I051), alerte sobre a necessidade de mapeamento para o plano do Banco Central/Receita Federal se houver contas ambíguas.
    4. **Bloco J vs I:** Verifique consistência lógica entre Balanço Patrimonial (J100) e DRE (J150).
    5. **Obrigações Acessórias:** Cite quais registros (ex: I050, I155, J100) seriam impactados por eventuais erros encontrados.

    FORMATO DE RESPOSTA: Markdown profissional, listando inconsistências e sugestões de correção.
    `;

    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{ text: `Realize uma auditoria prévia para ECD/ECF com base nestes saldos extraídos:\n\n${accounts}` }] },
        config: { systemInstruction: systemInstruction, temperature: 0.2 }
    }));
    return response.text || "Análise de conformidade não gerada.";
};

export const generateComparisonAnalysis = async (rows: ComparisonRow[], period1: string, period2: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const significantChanges = rows
        .filter(r => !r.is_synthetic && Math.abs(r.varPct) > 10 && Math.abs(r.val2) > 1000)
        .sort((a, b) => Math.abs(b.varAbs) - Math.abs(a.varAbs))
        .slice(0, 20)
        .map(r => `- ${r.code} ${r.name}: ${period1}=${r.val1}, ${period2}=${r.val2} (Var: ${r.varAbs.toFixed(2)}, ${r.varPct.toFixed(2)}%)`)
        .join('\n');

    const systemInstruction = `
    ATUE COMO: Analista Financeiro Sênior (FP&A).
    TAREFA: Realizar Análise Horizontal (Comparativo de Períodos).
    CONTEXTO: Comparação entre ${period1} e ${period2}.
    OBJETIVO: Explicar as variações mais significativas e apontar tendências ou anomalias.
    `;

    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{ text: `Analise estas variações contábeis significativas:\n\n${significantChanges}` }] },
        config: { systemInstruction: systemInstruction, temperature: 0.4 }
    }));
    return response.text || "Sem insights gerados.";
};

export const chatWithFinancialAgent = async (history: {role: 'user' | 'model', parts: {text: string}[]}[], message: string) => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const chat: Chat = ai.chats.create({
        model: 'gemini-3-pro-preview',
        history: history,
        config: { systemInstruction: "Assistente contábil sênior.", tools: [{ googleSearch: {} }] }
    });
    const result: GenerateContentResponse = await chat.sendMessage({ message });
    return result.text;
}