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

// --- ROBUST FINANCIAL NUMBER PARSER ---
function parseFinancialNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  
  if (typeof val === 'string') {
    let clean = val.trim();
    if (clean === '-' || clean === '–' || clean === '' || clean === '.') return 0; // Handle dashes/dots as zero

    // OCR Correction: common mixups
    // 'O' or 'o' instead of '0' in a numeric context
    if (/^[\d.,O]+$/.test(clean)) {
        clean = clean.replace(/O/gi, '0');
    }

    // Remove currency symbols
    clean = clean.replace(/[R$]/gi, '').trim();
    
    // Handle specific OCR artifacts like spaces inside numbers (e.g., "1 200,00")
    // Use lookahead to ensure we only remove spaces between digits
    clean = clean.replace(/(?<=\d)\s+(?=\d)/g, '');
    
    // Handle negative numbers with parenthesis: (1.000,00) -> -1.000,00
    const isNegativeParens = /^\(.*\)$/.test(clean);
    clean = clean.replace(/[()]/g, '');

    // Handle "D" or "C" suffix
    if (clean.toUpperCase().endsWith('D') || clean.toUpperCase().endsWith('C')) {
        clean = clean.slice(0, -1).trim();
    }

    // BR Format: 1.000,00 -> Remove dots, replace comma with dot
    // US Format: 1,000.00 -> Remove commas
    // Heuristic: Last separator determines format
    const lastDot = clean.lastIndexOf('.');
    const lastComma = clean.lastIndexOf(',');

    if (lastComma > lastDot) {
        // Likely BR format (decimals after comma)
        clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
        // Likely US format
        clean = clean.replace(/,/g, '');
    } else {
        // No separators or just one type. Assume BR if comma exists
        if (clean.includes(',')) clean = clean.replace(',', '.');
    }

    // Clean anything that isn't a digit, minus, or dot
    clean = clean.replace(/[^0-9.-]/g, '');

    let num = parseFloat(clean);
    if (isNaN(num)) return 0;
    
    if (isNegativeParens) num = -Math.abs(num);
    
    return num;
  }
  return 0;
}

// --- ADVANCED INVERSION LOGIC ---
function checkInversion(name: string, type: 'Debit' | 'Credit', finalBalance: number, indicator: string | null, code: string): boolean {
    const lowerName = name.toLowerCase();
    
    let expectedNature: 'Debit' | 'Credit' | 'Unknown' = 'Unknown';
    if (code.startsWith('1')) expectedNature = 'Debit';
    else if (code.startsWith('2')) expectedNature = 'Credit';
    else if (code.startsWith('3') || lowerName.includes('receita') || lowerName.includes('faturamento')) expectedNature = 'Credit';
    else if (code.startsWith('4') || lowerName.includes('despesa') || lowerName.includes('custo')) expectedNature = 'Debit';

    const contraKeywords = [
        'deprecia', 'amortiza', 'exaust',
        'pdd', 'perdas estimadas', 'crédito de liquidação duvidosa',
        'ajuste a valor presente',
        'ações em tesouraria',
        'prejuízos acumulados',
        'capital a integralizar',
        'redutora',
        'devolução de vendas',
        'impostos sobre vendas',
        'cancelamento de vendas',
        'abatimentos'
    ];

    const isContraAccount = contraKeywords.some(k => lowerName.includes(k));
    
    if (isContraAccount && expectedNature !== 'Unknown') {
        expectedNature = expectedNature === 'Debit' ? 'Credit' : 'Debit';
    }

    let actualNature: 'Debit' | 'Credit' = type;
    
    if (indicator) {
        if (indicator.toUpperCase() === 'D') actualNature = 'Debit';
        if (indicator.toUpperCase() === 'C') actualNature = 'Credit';
    } else {
        if (finalBalance < 0) {
             actualNature = 'Credit'; 
        }
    }

    if (expectedNature !== 'Unknown') {
        if (expectedNature !== actualNature) {
            return true;
        }
    }

    if (expectedNature === 'Unknown') {
        if ((lowerName.includes('banco') || lowerName.includes('caixa')) && !lowerName.includes('passivo') && actualNature === 'Credit' && finalBalance > 0) {
            return true;
        }
    }

    return false;
}

// --- SMART COLUMN MAPPER ---
function mapValuesToColumns(numbers: number[], docType: string): { initial: number, debit: number, credit: number, final: number } {
    const count = numbers.length;
    let initial = 0, debit = 0, credit = 0, final = 0;

    if (docType === 'Balancete') {
        // Balancete STRICT: We expect 4 numbers (Init, Deb, Cred, Final)
        if (count >= 4) {
            [initial, debit, credit, final] = numbers.slice(-4);
        } 
        // Sometimes only 3 cols if initial is zero? No, user wants strictness.
        // Fallback for weird extractions
        else if (count === 3) {
            // Ambiguous. Usually: Debit, Credit, Final
            [debit, credit, final] = numbers;
        } 
        else if (count === 2) {
             // Maybe just Initial / Final? Or Debit / Credit?
             // Safest bet for Balancete is Initial/Final if it's a summary, but usually Deb/Cred
             [debit, credit] = numbers; 
             final = debit - credit; 
        }
        else if (count === 1) {
            final = numbers[0];
        }
    } else {
        // DRE or Balanço (usually 2 cols: Year N, Year N-1 or just Value)
        if (count >= 2) {
            // Often Year 1, Year 2. We take the first one as current usually, or logic needs detection.
            // Assuming simplified DRE extraction:
            final = numbers[0]; 
            initial = numbers[1];
        } else if (count === 1) {
            final = numbers[0];
        }
    }

    return { initial, debit, credit, final };
}

// --- DATA NORMALIZATION & ANALYSIS ---
function normalizeFinancialData(rawLines: string[], docType: string): AnalysisResult {
  const accounts: ExtractedAccount[] = [];
  
  // Regex designed to capture pipe-separated values provided by the new Prompt
  const lineRegex = /^([\d.-]+)?\s*\|?\s*([a-zA-ZÀ-ÿ0-9\s.,&/()\-–]+?)\s*[|]\s*(.+)$/i;

  let explicitResultValue: number | undefined = undefined;
  let explicitResultLabel: string | undefined = undefined;

  rawLines.forEach(line => {
      let cleanLine = line.trim();
      if (!cleanLine || cleanLine.length < 5) return;
      if (/^(data|conta|descri|saldo|débito|crédito|página|page|cod|cód)/i.test(cleanLine)) return;

      const match = cleanLine.match(lineRegex);
      if (!match) return;

      const code = match[1] ? match[1].trim() : '';
      const name = match[2].trim();
      const valuesPart = match[3].trim();

      if (name.length < 3) return;

      // Split by pipe to respect the strict columns requested in prompt
      const rawValues = valuesPart.split('|').map(v => v.trim());
      
      const numbers = rawValues.map(v => parseFinancialNumber(v));
      
      // Filter out lines that have NO valid numbers (unless it's a header group)
      const validNumbersCount = numbers.filter(n => !isNaN(n)).length;
      if (validNumbersCount === 0 && !name.toLowerCase().includes('total')) {
          // It might be a synthetic group header without values
      }

      let type: 'Debit' | 'Credit' = 'Debit';
      const lowerName = name.toLowerCase();
      
      if (code.startsWith('2') || code.startsWith('3') || code.startsWith('6') || 
          lowerName.includes('passivo') || lowerName.includes('fornecedor') || 
          lowerName.includes('receita') || lowerName.includes('patrimônio') || lowerName.includes('capital')) {
          type = 'Credit';
      }

      const values = mapValuesToColumns(numbers, docType);

      if (lowerName.includes('lucro') || lowerName.includes('prejuízo') || lowerName.includes('resultado do') || lowerName.includes('superávit') || lowerName.includes('déficit')) {
          if (lowerName.includes('líquido') || lowerName.includes('exercício') || lowerName.includes('período')) {
             explicitResultValue = values.final;
             explicitResultLabel = name;
          }
      }

      const cleanCode = code.endsWith('.') ? code.slice(0, -1) : code;

      let category = null;
      if (docType === 'DRE') {
           if (lowerName.includes('receita') || lowerName.includes('custo') || lowerName.includes('despesa') || code.startsWith('3') || code.startsWith('4')) category = 'Operacional';
           else if (lowerName.includes('invest') || lowerName.includes('imobiliz')) category = 'Investimento';
           else if (lowerName.includes('juro') || lowerName.includes('financ')) category = 'Financiamento';
           else category = 'Operacional';
      }

      const possibleInversion = checkInversion(name, type, values.final, null, cleanCode);

      accounts.push({
          account_code: cleanCode,
          account_name: name,
          initial_balance: values.initial,
          debit_value: values.debit,
          credit_value: values.credit,
          final_balance: values.final,
          total_value: values.final,
          type,
          possible_inversion: possibleInversion,
          ifrs18_category: category as any,
          level: 1, 
          is_synthetic: false
      });
  });

  // --- PASS 2: HIERARCHY ---
  accounts.sort((a, b) => {
      if (!a.account_code) return 1;
      if (!b.account_code) return -1;
      return a.account_code.localeCompare(b.account_code, undefined, { numeric: true, sensitivity: 'base' });
  });

  accounts.forEach((acc, idx) => {
      if (acc.account_code) {
          acc.level = acc.account_code.split(/[.-]/).filter(x => x.length > 0).length;
          const myCode = acc.account_code;
          let isParent = false;
          const nextAcc = accounts[idx + 1];
          if (nextAcc && nextAcc.account_code && nextAcc.account_code.startsWith(myCode)) {
               const charAfter = nextAcc.account_code[myCode.length];
               if (charAfter === '.' || charAfter === '-' || charAfter === undefined) {
                   isParent = true;
               }
          }
          acc.is_synthetic = isParent;
      } else {
          if (acc.account_name.toLowerCase().startsWith('total') || acc.account_name.toLowerCase().startsWith('grupo')) {
              acc.is_synthetic = true;
          }
      }
  });

  const analyticalAccounts = accounts.filter(a => !a.is_synthetic);
  const calcAccounts = analyticalAccounts.length > 0 ? analyticalAccounts : accounts.filter(a => !a.account_name.toLowerCase().includes('total'));

  const total_debits = calcAccounts.reduce((sum, a) => sum + Math.abs(a.debit_value), 0);
  const total_credits = calcAccounts.reduce((sum, a) => sum + Math.abs(a.credit_value), 0);
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
          specific_result_label: explicitResultLabel || (explicitResultValue >= 0 ? 'Lucro/Superávit Estimado' : 'Prejuízo/Déficit Estimado')
      },
      accounts,
      spell_check: []
  };
}

// --- STEP 1: RAW EXTRACTION WITH CHUNKING ---
async function extractRawData(ai: GoogleGenAI, fileBase64: string, mimeType: string): Promise<{lines: string[], docType: string}> {
    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    const basePrompt = `
    ROLE: Senior Accounting Auditor / Data Entry Specialist with OCR expertise.
    TASK: Extract financial data from the provided document.
    
    COMPLEX TABLE HANDLING (OCR):
    1. VISUAL ALIGNMENT: Trust the visual column alignment. Even if text is crowded, use the headers to align values.
    2. MULTI-LINE ROWS: If an account name wraps to a second line, JOIN IT into a single line. Do not create a separate row for the wrapped text.
    3. MISSING COLUMNS: If a row has empty cells (visually), output them as "0.00" or empty space between pipes. Maintain the column count!
    4. NOISE: Ignore leader dots (....) and vertical separators (|) that are part of the page design.
    5. HEADERS: Ignore repeated page headers.
    
    CRITICAL RULES FOR COLUMNS:
    1. If this is a Trial Balance (Balancete), you MUST extract 4 numeric columns:
       Col 1: Initial Balance (Saldo Anterior)
       Col 2: Debit (Débito)
       Col 3: Credit (Crédito)
       Col 4: Final Balance (Saldo Atual)
    2. IMPORTANT: If a column has a dash '-', empty space, or '0,00', YOU MUST WRITE "0.00".
       DO NOT SKIP COLUMNS. The output MUST have the correct number of pipes.
    
    OUTPUT FORMAT:
    CODE | ACCOUNT NAME | VALUE_1 | VALUE_2 | VALUE_3 | VALUE_4 ...
    
    Example Output Line:
    1.1.01 | Caixa Geral | 1000.00 | 500.00 | 200.00 | 1300.00
    
    GENERAL RULES:
    - Extract ALL rows (synthetic and analytical).
    - Do not summarize.
    - Return ONLY the raw data rows.
    `;

    try {
        console.log(`Starting Extraction for ${mimeType}...`);
        
        let extractedText = "";
        let docType = 'Balancete'; // Default to Balancete for safety, unless proven DRE

        if (mimeType === 'text/csv' || mimeType === 'text/plain' || mimeType === 'application/csv') {
            const decodedText = safeDecodeBase64(fileBase64);
            const allLines = decodedText.split('\n');
            const totalLines = allLines.length;
            const CHUNK_SIZE = 1500; 
            
            console.log(`Processing ${totalLines} lines in chunks of ${CHUNK_SIZE}...`);

            const chunks: string[] = [];
            for (let i = 0; i < totalLines; i += CHUNK_SIZE) {
                chunks.push(allLines.slice(i, i + CHUNK_SIZE).join('\n'));
            }

            for (let i = 0; i < chunks.length; i++) {
                console.log(`Processing chunk ${i + 1}/${chunks.length}`);
                const chunkContent = chunks[i];
                
                const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [
                        { text: basePrompt + `\n\n--- DATA SEGMENT ${i+1}/${chunks.length} ---\n${chunkContent}\n--- END SEGMENT ---` }
                    ]},
                    config: { temperature: 0.0, maxOutputTokens: 8192, safetySettings }
                }));
                
                if (response.text) {
                    extractedText += response.text + "\n";
                }
            }

        } else {
            // PDF STRATEGY
            const pdfPrompt = `
            ${basePrompt}
            IMPORTANT: This is a multi-page PDF document. 
            
            VISUAL EXTRACTION RULES:
            - Scan the entire width of the page.
            - Reconstruct rows that are split across lines.
            - If a value seems attached to a vertical line (e.g., "|1000"), separate it.
            - If the document is "Balancete", FORCE the extraction of 4 numeric columns. If a column is visually missing, assume 0.00.
            
            Verify if the document is a "Balancete" (Trial Balance) or "DRE".
            `;

            const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [
                    { inlineData: { mimeType: mimeType, data: fileBase64 } },
                    { text: pdfPrompt }
                ]},
                config: { 
                    temperature: 0.0, // Zero temperature for maximum determinism
                    maxOutputTokens: 65000,
                    safetySettings 
                }
            }));
            extractedText = response.text || "";
        }

        if (extractedText.length < 50) {
             throw new Error("Resposta da IA vazia ou insuficiente. Tente novamente.");
        }

        const lines = extractedText.split('\n').filter(l => l.trim().length > 0 && /\d/.test(l)); 

        const lowerText = extractedText.toLowerCase();
        
        // Improved Doc Type Detection
        // Explicitly look for "Balancete" or typical Balancete columns signatures first
        if (lowerText.includes('balancete') || lowerText.includes('razão') || lowerText.includes('trial balance') || (lowerText.includes('débito') && lowerText.includes('crédito') && lowerText.includes('anterior'))) {
            docType = 'Balancete';
        } 
        // Only classify as DRE if it explicitly says so AND doesn't look like a Balancete
        else if ((lowerText.includes('demonstração do resultado') || lowerText.includes('dre')) && !lowerText.includes('balancete')) {
            docType = 'DRE';
        } else {
            // Default Fallback: If it has Active/Passive, it's likely a Balance Sheet/Balancete
            if (lowerText.includes('ativo') && lowerText.includes('passivo')) {
                docType = 'Balancete'; // Prefer Balancete structure (4 cols) over Balance Sheet (2 cols) for imported data richness
            }
        }

        console.log("Detected Doc Type:", docType);

        return { lines, docType };

    } catch (e: any) {
        console.error("Extraction Error Detail:", e);
        throw new Error(`Erro na extração: ${e.message}`);
    }
}

// --- STEP 2: NARRATIVE ANALYSIS & SPELL CHECK ---
async function generateNarrativeAnalysis(ai: GoogleGenAI, summaryData: any, sampleAccounts: string[]): Promise<{observations: string[], spellcheck: any[], period: string}> {
    const prompt = `
    ATUE COMO: Auditor Contábil.
    DADOS: Doc: ${summaryData.document_type}, Resultado: ${summaryData.specific_result_value}.
    CONTAS: ${sampleAccounts.join('; ')}
    
    SAÍDA JSON:
    {
      "period": "dd/mm/aaaa a dd/mm/aaaa",
      "observations": ["Obs 1"],
      "spell_check": [{"original_term": "Errado", "suggested_correction": "Certo", "confidence": "High"}]
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

  const { lines, docType } = await extractRawData(ai, fileBase64, mimeType);
  if (lines.length === 0) throw new Error("Nenhum dado encontrado.");

  const result = normalizeFinancialData(lines, docType);
  if (result.accounts.length === 0) throw new Error("Falha ao normalizar contas.");

  const sample = result.accounts.slice(0, 100).map(a => a.account_name);
  const narrative = await generateNarrativeAnalysis(ai, result.summary, sample);

  result.summary.period = narrative.period || 'Período não identificado';
  result.summary.observations = narrative.observations || [];
  result.spell_check = narrative.spellcheck || [];

  return result;
};

// ... keep other export functions (generateFinancialInsight, etc.) same as before but ensure they use robust error handling ...
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
  
  const systemInstruction = `Especialista em Valuation. Norma: ${accountingStandard}. Múltiplo: ${multiple}x EBITDA.`;

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
        .slice(0, 250)
        .map(a => `${a.account_code || '?'} | ${a.account_name} | ${a.final_balance} (${a.type})`)
        .join('\n');

    const systemInstruction = `ATUE COMO: Especialista em SPED Contábil (ECD) e ECF.`;

    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{ text: `Realize auditoria SPED nestes saldos:\n\n${accounts}` }] },
        config: { systemInstruction: systemInstruction, temperature: 0.2 }
    }));
    return response.text || "Análise de conformidade não gerada.";
};

export const generateComparisonAnalysis = async (rows: ComparisonRow[], period1: string, period2: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const significantChanges = rows
        .filter(r => !r.is_synthetic && Math.abs(r.varPct) > 10)
        .slice(0, 20)
        .map(r => `- ${r.code} ${r.name}: ${r.val1} -> ${r.val2}`)
        .join('\n');

    const systemInstruction = `Analista Financeiro Sênior (FP&A). Comparação ${period1} vs ${period2}.`;

    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts: [{ text: `Analise variações:\n\n${significantChanges}` }] },
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