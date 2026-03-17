import { GoogleGenAI, GenerateContentResponse, HarmCategory, HarmBlockThreshold, Chat } from "@google/genai";
import { AnalysisResult, ExtractedAccount, ComparisonRow } from "../types";

// Helper for Exponential Backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, baseDelay = 3000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        const message = error?.message || '';
        const status = error?.status || error?.code;

        // Do NOT retry on client errors: invalid API key, bad request, not found, auth errors
        const isClientError =
            status === 400 || status === 401 || status === 403 || status === 404 ||
            message.includes('400') || message.includes('401') || message.includes('403') ||
            message.includes('404') || message.includes('not found') ||
            message.includes('API_KEY_INVALID') || message.includes('API key not valid');

        if (isClientError) {
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

/**
 * Sanitizes a base64 string for safe use with Safari's atob() and Gemini SDK.
 * Safari's atob() implementation is extremely strict and throws "The string did not match the expected pattern"
 * if it encounters whitespace, newlines, or invalid characters.
 */
function sanitizeBase64(base64: string): string {
    if (!base64) return "";

    // 1. Remove data URL prefix if present (e.g., "data:application/pdf;base64,")
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;

    // 2. Remove all whitespace, newlines, and characters NOT in the base64 alphabet
    // Safari's atob() is extremely strict. It throws on ANY non-base64 character.
    // FIX: escapado \/ para evitar SyntaxError no Safari (Unexpected token ')')
    const cleaned = raw.replace(/[^A-Za-z0-9+\/=]/g, '');

    // 3. Ensure correct padding (length must be multiple of 4)
    // Valid base64 strings can only have 0, 1, or 2 '=' signs.
    // If length % 4 == 1, adding '===' is invalid. We fallback to 0 padding or truncation if needed.
    const contentWithoutPadding = cleaned.replace(/=/g, '');
    const remainder = contentWithoutPadding.length % 4;

    if (remainder === 0) return contentWithoutPadding;
    if (remainder === 2) return contentWithoutPadding + '==';
    if (remainder === 3) return contentWithoutPadding + '=';

    // remainder === 1 is invalid/corrupt data. Safari will fail anyway if we add ===.
    // We return it as is or try to "fix" it by removing the dangling char.
    return contentWithoutPadding.substring(0, contentWithoutPadding.length - 1);
}

function customBase64ToUint8Array(base64: string): Uint8Array {
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;
    // FIX: escapado \/ para evitar SyntaxError no Safari (Unexpected token ')')
    const cleaned = raw.replace(/[^A-Za-z0-9+\/]/g, '');
    const len = cleaned.length;
    let bufferLength = Math.floor((len * 3) / 4);
    if (cleaned[len - 1] === '=') bufferLength--;
    if (cleaned[len - 2] === '=') bufferLength--;

    const bytes = new Uint8Array(bufferLength);
    const lookup = new Uint8Array(256);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;

    let p = 0;
    for (let i = 0; i < len; i += 4) {
        const encoded1 = lookup[cleaned.charCodeAt(i)];
        const encoded2 = lookup[cleaned.charCodeAt(i + 1)];
        const encoded3 = lookup[cleaned.charCodeAt(i + 2)];
        const encoded4 = lookup[cleaned.charCodeAt(i + 3)];

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
    return bytes;
}

function safeDecodeBase64(str: string): string {
    try {
        const bytes = customBase64ToUint8Array(str);
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (e) {
        return '';
    }
}

function parseFinancialNumber(val: any): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;

    let clean = String(val).trim();

    // Quick return for empty or non-numeric looking strings
    if (!clean || clean === '-' || clean === '–') return 0;

    // Remove currency symbols and common noise
    clean = clean.replace(/^R\$\s?/, '').replace(/\s/g, '');

    // Fix common OCR errors
    clean = clean.replace(/O/gi, '0')
        .replace(/l/g, '1')
        .replace(/[^0-9.,\-()]/g, '');

    // Handle Parentheses as Negative
    const isNegativeParens = /^\(.*\)$/.test(clean);
    if (isNegativeParens) {
        clean = clean.replace(/[()]/g, '');
    }

    // IMPORTANT: Brazilian Format Detection (1.000,00) vs US (1,000.00)
    const lastDotIndex = clean.lastIndexOf('.');
    const lastCommaIndex = clean.lastIndexOf(',');

    if (lastCommaIndex > lastDotIndex) {
        // Brazilian format: remove dots, replace comma with dot
        clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (lastDotIndex > lastCommaIndex) {
        // US format: remove commas
        clean = clean.replace(/,/g, '');
    } else {
        // No separator or only one type. 
        // If it has a comma, treat as decimal separator (common in BR)
        if (clean.includes(',')) clean = clean.replace(',', '.');
    }

    let num = parseFloat(clean);

    if (isNaN(num)) return 0;
    if (isNegativeParens) num = -Math.abs(num);

    return num;
}

function checkInversion(name: string, type: 'Debit' | 'Credit', finalBalance: number, indicator: string | null, code: string): boolean {
    const lowerName = name.toLowerCase();
    let expectedNature: 'Debit' | 'Credit' | 'Unknown' = 'Unknown';

    // Standard Accounting Logic (Brazil/IFRS)
    if (code.startsWith('1')) expectedNature = 'Debit'; // Ativo
    else if (code.startsWith('2')) expectedNature = 'Credit'; // Passivo / PL
    else if (code.startsWith('3') || code.startsWith('4')) {
        // Depends on chart of accounts, but usually 3 is Revenue and 4 is Expense
        if (lowerName.includes('receita') || lowerName.includes('faturamento') || lowerName.includes('venda')) expectedNature = 'Credit';
        else if (lowerName.includes('despesa') || lowerName.includes('custo') || lowerName.includes('gastos')) expectedNature = 'Debit';
    }

    // Deductions usually have reversed nature
    const deductionKeywords = [
        'devolu', 'cancelamento', 'abatimento', 'imposto sobre', 'tributo sobre'
    ];
    if (deductionKeywords.some(k => lowerName.includes(k))) {
        expectedNature = (expectedNature === 'Debit') ? 'Credit' : 'Debit';
    }

    // Accummlated Depreciation / Amortization (Asset Deductions)
    if (lowerName.includes('depreciação acumulada') || lowerName.includes('amortização acumulada')) {
        expectedNature = 'Credit';
    }

    let actualNature: 'Debit' | 'Credit' = type;
    if (indicator) {
        if (indicator.toUpperCase() === 'D') actualNature = 'Debit';
        if (indicator.toUpperCase() === 'C') actualNature = 'Credit';
    } else {
        // If no indicator, we assume positive (for the account type) or look at sign
        if (finalBalance < 0) actualNature = (type === 'Debit') ? 'Credit' : 'Debit';
    }

    if (expectedNature !== 'Unknown' && expectedNature !== actualNature) {
        // Special Case: Profit/Loss can be either
        if (lowerName.includes('lucro') || lowerName.includes('prejuízo') || lowerName.includes('resultado')) return false;
        return true;
    }

    return false;
}

function mapValuesToColumns(numbers: number[], docType: string): { initial: number, debit: number, credit: number, final: number } {
    const count = numbers.length;
    let initial = 0, debit = 0, credit = 0, final = 0;

    // --- DRE SPECIFIC LOGIC ---
    if (docType === 'DRE') {
        if (count > 0) {
            // For DRE, usually the last valid number is the accumulated or relevant period result in single-column extractions.
            // However, our prompt asks to prioritize current period.
            // Let's take the LAST number found if multiple exist, assuming column order [Period 1] [Period 2] ...
            // Or if pipe extraction is clean, index 0 is what we want.
            // Safe bet: The number with the highest absolute value is likely the Total.
            // Actually, strict index 0 is safer if the prompt is obeyed.
            final = numbers[0];
        }
        return { initial, debit, credit, final };
    }

    // --- STANDARD BALANCETE LOGIC ---
    if (count === 1) {
        final = numbers[0];
    } else if (count === 2) {
        initial = numbers[0];
        final = numbers[1];
    } else if (count === 3) {
        debit = numbers[0];
        credit = numbers[1];
        final = numbers[2];
    } else if (count >= 4) {
        initial = numbers[0];
        debit = numbers[1];
        credit = numbers[2];
        final = numbers[3];
    }

    return { initial, debit, credit, final };
}

function normalizeFinancialData(rawLines: string[], docType: string): AnalysisResult {
    const accounts: ExtractedAccount[] = [];

    rawLines.forEach(line => {
        let cleanLine = line.trim();
        if (!cleanLine || cleanLine.length < 5) return;

        // Filter out likely headers
        if (/^(doctype|data|conta|descri|saldo|débito|crédito|página|page|cod|cód|movimento|transporte|historico|empresa|cnpj)/i.test(cleanLine)) return;
        // Filter markdown table separators
        if (/^\|?[\s-]+\|?$/.test(cleanLine)) return;

        let code = '';
        let name = '';
        let valuesPart: number[] = [];
        let type: 'Debit' | 'Credit' = 'Debit'; // Default

        // --- STRATEGY 1: PIPE SEPARATOR (Preferred) ---
        if (cleanLine.includes('|')) {
            // Robust split: trim and remove empty parts (common in markdown "| val |" -> ["", "val", ""])
            const parts = cleanLine.split('|').map(p => p.trim()).filter(p => p.length > 0);

            if (parts.length >= 2) {
                const firstLooksLikeCode = /^[\d.-]+$/.test(parts[0]) && parts[0].length < 20;

                if (firstLooksLikeCode) {
                    code = parts[0];
                    name = parts[1];
                    for (let i = 2; i < parts.length; i++) {
                        // Filter out known non-value columns like "D", "C", "%"
                        if (/^[DC%]$/i.test(parts[i])) continue;
                        const val = parseFinancialNumber(parts[i]);
                        valuesPart.push(val);
                    }
                } else {
                    // No Code, just Name | Value
                    name = parts[0];
                    for (let i = 1; i < parts.length; i++) {
                        if (/^[DC%]$/i.test(parts[i])) continue;
                        valuesPart.push(parseFinancialNumber(parts[i]));
                    }
                }
            }
        }

        // --- STRATEGY 2: REVERSE PARSING (Fallback) ---
        if (valuesPart.length === 0) {
            // Clean common separator noise
            cleanLine = cleanLine.replace(/\.{3,}/g, ' '); // Replace .... with space

            const tokens = cleanLine.split(/\s+/);
            const foundNumbers: number[] = [];
            let lastTokenIndex = tokens.length - 1;
            let numbersFoundCount = 0;

            while (lastTokenIndex >= 0 && numbersFoundCount < 4) {
                const token = tokens[lastTokenIndex];

                // Skip indicators
                if (/^[DC%]$/i.test(token)) {
                    lastTokenIndex--;
                    continue;
                }

                // Check if it looks strictly like a financial number
                if (/^[\d.,\-()]+$/.test(token) && /\d/.test(token)) {
                    const val = parseFinancialNumber(token);
                    foundNumbers.unshift(val);
                    numbersFoundCount++;
                    lastTokenIndex--;
                } else {
                    // If we hit a word, stop (unless it's R$)
                    if (token.toUpperCase() === 'R$') {
                        lastTokenIndex--;
                    } else {
                        break;
                    }
                }
            }

            if (foundNumbers.length > 0) {
                valuesPart = foundNumbers;
                const nameTokens = tokens.slice(0, lastTokenIndex + 1);
                if (nameTokens.length > 0) {
                    if (/^[\d.-]+$/.test(nameTokens[0])) {
                        code = nameTokens[0];
                        name = nameTokens.slice(1).join(' ');
                    } else {
                        name = nameTokens.join(' ');
                    }
                }
            }
        }

        // Cleanup Name
        name = name.replace(/[.|]{2,}/g, '').trim();
        if (!name || name.length < 2 || valuesPart.length === 0) return;

        // Determine Type (Debit/Credit) mainly for DRE logic
        const lowerName = name.toLowerCase();

        if (code.startsWith('2') || code.startsWith('3') || code.startsWith('6') ||
            lowerName.includes('passivo') || lowerName.includes('fornecedor') ||
            lowerName.includes('receita') || lowerName.includes('patrimônio') || lowerName.includes('capital') ||
            lowerName.includes('lucro') || lowerName.includes('vendas')) {
            type = 'Credit';
        }

        if (docType === 'DRE') {
            if (lowerName.includes('custo') || lowerName.includes('despesa') || lowerName.includes('imposto') || lowerName.includes('cmv')) {
                type = 'Debit';
            }
        }

        const values = mapValuesToColumns(valuesPart, docType);
        const cleanCode = code.endsWith('.') ? code.slice(0, -1) : code;

        let category = null;
        if (docType === 'DRE' || code.startsWith('3') || code.startsWith('4') || code.startsWith('5')) {
            if (lowerName.includes('receita') || lowerName.includes('custo') || lowerName.includes('despesa') || code.startsWith('3') || code.startsWith('4')) category = 'Operacional';
            else if (lowerName.includes('invest') || lowerName.includes('imobiliz')) category = 'Investimento';
            else if (lowerName.includes('juro') || lowerName.includes('financ')) category = 'Financiamento';
            else category = 'Operacional';
        }

        let finalBal = values.final;

        if (docType === 'DRE') {
            if (values.debit === 0 && values.credit === 0) {
                if (type === 'Debit') values.debit = Math.abs(finalBal);
                else values.credit = Math.abs(finalBal);
            }
            if (type === 'Debit') finalBal = -Math.abs(finalBal);
            else finalBal = Math.abs(finalBal);
        } else {
            if (finalBal === 0 && (values.debit !== 0 || values.credit !== 0)) {
                finalBal = values.debit - values.credit;
            }
        }

        const possibleInversion = checkInversion(name, type, finalBal, null, cleanCode);

        accounts.push({
            account_code: cleanCode,
            account_name: name,
            initial_balance: values.initial,
            debit_value: values.debit,
            credit_value: values.credit,
            final_balance: finalBal,
            total_value: Math.abs(finalBal),
            type,
            possible_inversion: possibleInversion,
            ifrs18_category: category as any,
            level: 1,
            is_synthetic: false
        });
    });

    // Post-processing hierarchy
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
                if (charAfter === '.' || charAfter === '-' || charAfter === undefined) isParent = true;
            }
            acc.is_synthetic = isParent;
        } else if (acc.account_name.toLowerCase().startsWith('total') || acc.account_name.toLowerCase().startsWith('grupo') || acc.account_name.toLowerCase().startsWith('resultado')) {
            acc.is_synthetic = true;
        }
    });

    const analyticalAccounts = accounts.filter(a => !a.is_synthetic);
    const calcAccounts = analyticalAccounts.length > 0 ? analyticalAccounts : accounts.filter(a => !a.account_name.toLowerCase().includes('total'));

    const total_debits = calcAccounts.reduce((sum, a) => sum + Math.abs(a.debit_value), 0);
    const total_credits = calcAccounts.reduce((sum, a) => sum + Math.abs(a.credit_value), 0);
    const discrepancy = Math.abs(total_debits - total_credits);

    let calculatedResult = 0;
    let resultLabel = 'Resultado do Período';

    if (docType === 'DRE') {
        const revenue = analyticalAccounts.filter(a => a.type === 'Credit').reduce((sum, a) => sum + Math.abs(a.final_balance), 0);
        const expenses = analyticalAccounts.filter(a => a.type === 'Debit').reduce((sum, a) => sum + Math.abs(a.final_balance), 0);
        calculatedResult = revenue - expenses;
        resultLabel = calculatedResult >= 0 ? 'Lucro Líquido Apurado' : 'Prejuízo Líquido Apurado';
    } else {
        let revenueSum = 0, expenseSum = 0;
        analyticalAccounts.forEach(acc => {
            if (acc.account_code) {
                const firstChar = acc.account_code.charAt(0);
                if (['3', '4', '5', '6', '7'].includes(firstChar)) {
                    if (acc.type === 'Credit') revenueSum += Math.abs(acc.final_balance);
                    if (acc.type === 'Debit') expenseSum += Math.abs(acc.final_balance);
                }
            } else {
                const lower = acc.account_name.toLowerCase();
                if ((lower.includes('receita') || lower.includes('faturamento')) && acc.type === 'Credit') { revenueSum += Math.abs(acc.final_balance); }
                if ((lower.includes('despesa') || lower.includes('custo')) && acc.type === 'Debit') { expenseSum += Math.abs(acc.final_balance); }
            }
        });
        calculatedResult = revenueSum - expenseSum;

        if (Math.abs(calculatedResult) < 0.01) {
            const resultAccount = analyticalAccounts.find(a => /lucro\s+l[ií]quido|preju[ií]zo\s+l[ií]quido/i.test(a.account_name));
            if (resultAccount) {
                calculatedResult = resultAccount.final_balance;
                resultLabel = resultAccount.account_name;
            }
        }
    }

    return {
        summary: {
            document_type: docType as any,
            period: 'A definir',
            total_debits,
            total_credits,
            is_balanced: docType === 'DRE' ? true : discrepancy < 1.0,
            discrepancy_amount: discrepancy,
            observations: [],
            specific_result_value: calculatedResult,
            specific_result_label: resultLabel
        },
        accounts,
        spell_check: []
    };
}

// --- NEW PDF CHUNKING LOGIC ---
async function extractRawData(ai: GoogleGenAI, fileBase64: string, mimeType: string): Promise<{ lines: string[], docType: string }> {
    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    const basePrompt = `
    TASK: Financial Data Extraction.
    OUTPUT FORMAT: "CODE | ACCOUNT NAME | VALUE"
    
    CRITICAL RULES:
    1. EXTRACT LINE BY LINE FROM ALL PROVIDED IMAGES/PAGES.
    2. FORCE PIPE SEPARATOR (|) between Code, Name, and Value.
    3. IGNORE NON-MONETARY COLUMNS (e.g., %, AV, AH, Indicators D/C).
    4. IF MULTIPLE VALUE COLUMNS (e.g., Period 1 | Period 2): EXTRACT ONLY CURRENT PERIOD.
    5. KEEP ORIGINAL NUMBER FORMAT (e.g. 1.000,00).
    6. NO MARKDOWN TABLES, JUST RAW TEXT LINES.
    7. IGNORE HEADERS/FOOTERS. DO NOT SUMMARIZE.
    
    Example:
    3.01 | Receita Vendas | 100.000,00
    3.02 | (-) Devoluções | (10.000,00)
    | Total Receita | 90.000,00
    `;

    try {
        let extractedText = "";
        let docType = 'Balancete';

        if (mimeType === 'text/csv' || mimeType === 'text/plain' || mimeType === 'application/csv') {
            // ... (CSV logic remains the same) ...
            const decodedText = safeDecodeBase64(fileBase64);
            const allLines = decodedText.split('\n');
            const CHUNK_SIZE = 600;
            const chunks: string[] = [];
            for (let i = 0; i < allLines.length; i += CHUNK_SIZE) chunks.push(allLines.slice(i, i + CHUNK_SIZE).join('\n'));

            for (let i = 0; i < chunks.length; i++) {
                const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                    model: 'gemini-2.0-flash',
                    contents: { parts: [{ text: basePrompt + `\n\n--- SEGMENT ${i + 1} OF ${chunks.length} ---\n${chunks[i]}\n--- END SEGMENT ---` }] },
                    config: { temperature: 0.0, maxOutputTokens: 8192, safetySettings }
                }));
                if (response.text) extractedText += response.text + "\n";
            }
        }
        else if (mimeType === 'application/pdf') {
            // === DIRECT GEMINI PDF PROCESSING ===
            // Gemini's vision model natively handles multi-page PDFs.
            // This approach is more robust than pdf-lib chunking.
            console.log("Sending PDF directly to Gemini for extraction...");
            const sanitizedPdf = sanitizeBase64(fileBase64);
            const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: {
                    parts: [
                        { inlineData: { mimeType: 'application/pdf', data: sanitizedPdf } },
                        { text: basePrompt + "\n\nEXTRACT EVERY SINGLE ROW FROM ALL PAGES." }
                    ]
                },
                config: { temperature: 0.0, maxOutputTokens: 65000, safetySettings }
            }));
            if (response.text) extractedText = response.text;

        } else {
            // Excel/Image Fallback (No chunking for Images usually needed)
            const sanitizedData = sanitizeBase64(fileBase64);
            const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: {
                    parts: [
                        { inlineData: { mimeType: mimeType, data: sanitizedData } },
                        { text: basePrompt + "\n\nEXTRACT EVERYTHING." }
                    ]
                },
                config: { temperature: 0.1, maxOutputTokens: 65000, safetySettings }
            }));
            extractedText = response.text || "";
        }

        let lines = extractedText.split('\n').filter(l => l.trim().length > 0);

        // Detect DocType from Text
        const docTypeLine = lines.find(l => /Balanço|Balancete|Demonstração|Resultado/i.test(l));
        if (docTypeLine) {
            if (/Resultado|DRE/i.test(docTypeLine)) docType = 'DRE';
            else if (/Balanço/i.test(docTypeLine)) docType = 'Balanço Patrimonial';
        }

        // Remove known garbage lines
        lines = lines.filter(l => !l.startsWith('DOCTYPE') && /\d/.test(l));

        return { lines, docType };

    } catch (e: any) {
        console.error("Extraction Error:", e);
        throw new Error(`Erro na extração: ${e.message}`);
    }
}

async function generateNarrativeAnalysis(ai: GoogleGenAI, summaryData: any, sampleAccounts: { code: string, name: string }[]): Promise<{
    observations: string[],
    spellcheck: any[],
    period: string,
    account_audits?: any[]
}> {
    const prompt = `
    ATUE COMO: Auditor Contábil Senior SP Assessoria.
    DADOS: Doc: ${summaryData.document_type}, Resultado: ${summaryData.specific_result_value}.
    AMOSTRA CONTAS (Código | Nome): ${sampleAccounts.map(a => `${a.code} | ${a.name}`).join('; ')}
    
    TAREFA: 
    1. Identifique o período (ex: 01/2025 ou 2024 completo).
    2. Identifique erros ortográficos ou nomenclaturas contábeis fora do padrão (ex: "Despessa" -> "Despesa", "Adiant. Clie" -> "Adiantamento de Clientes").
    3. Sinalize contas com nomes genéricos ou confusos e sugira a melhor opção técnica e o tipo de lançamento correto.
    
    SAÍDA JSON RIGOROSA:
    {
      "period": "string",
      "observations": ["Destaque de auditoria 1", "Destaque 2"],
      "spellcheck": [{"original_term": "string", "suggested_correction": "string", "confidence": "High"}],
      "account_audits": [
        {
          "code": "string",
          "name": "string",
          "name_suggestion": "string",
          "posting_suggestion": "string (ex: Lançar como despesa administrativa)",
          "audit_notes": "string (ex: Conta com nome incompleto prejudica a clareza)"
        }
      ]
    }
    `;
    try {
        const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: { parts: [{ text: prompt }] },
            config: { responseMimeType: "application/json", temperature: 0.2 }
        }));
        const parsed = JSON.parse(response.text || '{}');
        return {
            period: parsed.period || "A definir",
            observations: parsed.observations || [],
            spellcheck: parsed.spellcheck || [],
            account_audits: parsed.account_audits || []
        };
    } catch (e) { return { observations: [], spellcheck: [], period: "Indefinido", account_audits: [] }; }
}

export const analyzeDocument = async (fileBase64: string, mimeType: string): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const sanitizedInput = sanitizeBase64(fileBase64);
    const { lines, docType } = await extractRawData(ai, sanitizedInput, mimeType);

    // Debug Log to see what Gemini is actually returning in Console
    console.log("Raw Extracted Lines Preview:", lines.slice(0, 10));

    if (lines.length === 0) throw new Error("Nenhum dado contábil identificado.");
    const result = normalizeFinancialData(lines, docType);

    if (result.accounts.length === 0) throw new Error("Falha na interpretação das linhas. Tente outro formato.");

    // Sample formatting for AI Audit
    const sample = result.accounts.slice(0, 150).map(a => ({
        code: a.account_code || '',
        name: a.account_name
    }));

    const narrative = await generateNarrativeAnalysis(ai, result.summary, sample);
    result.summary.period = narrative.period || 'Período não identificado';
    result.summary.observations = narrative.observations || [];
    result.spell_check = narrative.spellcheck || [];

    // Map audit suggestions back to accounts
    if (narrative.account_audits) {
        narrative.account_audits.forEach((audit: any) => {
            const acc = result.accounts.find(a =>
                (audit.code && a.account_code === audit.code) ||
                (a.account_name.toLowerCase().includes(audit.name.toLowerCase()))
            );
            if (acc) {
                acc.name_suggestion = audit.name_suggestion;
                acc.posting_suggestion = audit.posting_suggestion;
                acc.audit_notes = audit.audit_notes;
            }
        });
    }

    return result;
};

export const generateFinancialInsight = async (analysisData: AnalysisResult, userPrompt: string, multiple: number): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Pegar amostra maior e mais estruturada para a Saúde Financeira
    const accounts = (analysisData.accounts || [])
        .filter(a => !a.is_synthetic)
        .sort((a, b) => Math.abs(b.final_balance) - Math.abs(a.final_balance))
        .slice(0, 200)
        .map(a => `${a.account_code || ''} ${a.account_name}: ${a.final_balance}`)
        .join('\n');

    const prompt = `
    DADOS DO RELATÓRIO:
    ${accounts}
    
    PEDIDO ESPECÍFICO:
    ${userPrompt}
    
    INSTRUÇÕES DE AUDITORIA:
    1. Analise a LIQUIDEZ, SOLVÊNCIA e ESTRUTURA DE CAPITAL.
    2. Comente sobre o Resultado do Período (Lucro/Prejuízo) em relação ao faturamento.
    3. Destaque pontos de atenção na Saúde Financeira (ex: excesso de endividamento, falta de capital de giro).
    4. Seja técnico, direto e use o tom da SP Assessoria Contábil.
    `;

    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: { parts: [{ text: prompt }] },
        config: {
            systemInstruction: "Você é o Diretor de Auditoria e Estratégia da SP Assessoria. Sua missão é fornecer um parecer técnico impecável sobre a Saúde Financeira da empresa com base nos dados fornecidos.",
            temperature: 0.3
        }
    }));
    return response.text || "Análise de saúde financeira não disponível no momento.";
};

export const generateCMVAnalysis = async (analysisData: AnalysisResult, accountingStandard: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const accounts = (analysisData.accounts || []).slice(0, 300).map(a => `${a.account_code} ${a.account_name}: ${a.total_value}`).join('\n');
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: { parts: [{ text: `Analise CMV:\n${accounts}` }] },
        config: { systemInstruction: `Auditor de Custos SP Assessoria.`, temperature: 0.3 }
    }));
    return response.text || "Sem resposta.";
};

export const generateSpedComplianceCheck = async (analysisData: AnalysisResult): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const accounts = (analysisData.accounts || []).slice(0, 250).map(a => `${a.account_code || '?'} | ${a.account_name} | ${a.final_balance}`).join('\n');
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: { parts: [{ text: `Auditoria SPED:\n\n${accounts}` }] },
        config: { systemInstruction: "Especialista em SPED ECD/ECF SP Assessoria.", temperature: 0.2 }
    }));
    return response.text || "Análise não gerada.";
};

export const chatWithFinancialAgent = async (history: { role: 'user' | 'model', parts: { text: string }[] }[], message: string) => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const chat: Chat = ai.chats.create({
        model: 'gemini-2.0-flash',
        history: history,
        config: { systemInstruction: "Assistente contábil sênior SP Assessoria.", tools: [{ googleSearch: {} }] }
    });
    const result: GenerateContentResponse = await chat.sendMessage({ message });
    return result.text;
}

export const generateComparisonAnalysis = async (rows: ComparisonRow[], period1: string, period2: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const topVariations = rows
        .filter(r => !r.is_synthetic)
        .sort((a, b) => Math.abs(b.varAbs) - Math.abs(a.varAbs))
        .slice(0, 100)
        .map(r => `${r.code} ${r.name}: De ${r.val1} para ${r.val2} (Var Abs: ${r.varAbs}, Var Pct: ${r.varPct.toFixed(2)}%)`)
        .join('\n');

    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: { parts: [{ text: `Analise as variações financeiras entre os períodos ${period1} e ${period2}. Foque nas contas com maiores variações absolutas e percentuais:\n\n${topVariations}` }] },
        config: {
            systemInstruction: "Você é um Auditor Contábil Senior da SP Assessoria especializado em análise horizontal. Forneça insights detalhados sobre os motivos prováveis das variações e destaque riscos ou anomalias.",
            temperature: 0.3
        }
    }));
    return response.text || "Análise não gerada.";
};
