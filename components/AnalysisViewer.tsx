import { GoogleGenAI, GenerateContentResponse, HarmCategory, HarmBlockThreshold, Chat } from "@google/genai";
import { AnalysisResult, ExtractedAccount, ComparisonRow } from "../types";

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, baseDelay = 3000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        const message = error?.message || '';
        const status = error?.status || error?.code;
        const isClientError =
            status === 400 || status === 401 || status === 403 || status === 404 ||
            message.includes('400') || message.includes('401') || message.includes('403') ||
            message.includes('404') || message.includes('not found') ||
            message.includes('API_KEY_INVALID') || message.includes('API key not valid');
        if (isClientError) throw error;
        if (retries > 0) {
            console.warn(`API Error (${status}). Retrying in ${baseDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, baseDelay));
            return retryWithBackoff(fn, retries - 1, baseDelay * 2);
        }
        throw error;
    }
}

function sanitizeBase64(base64: string): string {
    if (!base64) return "";
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;
    // FIX: \/ escapado — evita SyntaxError no Safari
    const cleaned = raw.replace(/[^A-Za-z0-9+\/=]/g, '');
    const contentWithoutPadding = cleaned.replace(/=/g, '');
    const remainder = contentWithoutPadding.length % 4;
    if (remainder === 0) return contentWithoutPadding;
    if (remainder === 2) return contentWithoutPadding + '==';
    if (remainder === 3) return contentWithoutPadding + '=';
    return contentWithoutPadding.substring(0, contentWithoutPadding.length - 1);
}

function customBase64ToUint8Array(base64: string): Uint8Array {
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;
    // FIX: \/ escapado — evita SyntaxError no Safari
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
        const e1 = lookup[cleaned.charCodeAt(i)];
        const e2 = lookup[cleaned.charCodeAt(i + 1)];
        const e3 = lookup[cleaned.charCodeAt(i + 2)];
        const e4 = lookup[cleaned.charCodeAt(i + 3)];
        bytes[p++] = (e1 << 2) | (e2 >> 4);
        if (p < bufferLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
        if (p < bufferLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
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
    if (!clean || clean === '-' || clean === '–') return 0;
    clean = clean.replace(/^R\$\s?/, '').replace(/\s/g, '');
    clean = clean.replace(/O/gi, '0').replace(/l/g, '1').replace(/[^0-9.,\-()]/g, '');
    const isNegativeParens = /^\(.*\)$/.test(clean);
    if (isNegativeParens) clean = clean.replace(/[()]/g, '');
    const lastDotIndex = clean.lastIndexOf('.');
    const lastCommaIndex = clean.lastIndexOf(',');
    if (lastCommaIndex > lastDotIndex) {
        clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (lastDotIndex > lastCommaIndex) {
        clean = clean.replace(/,/g, '');
    } else {
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
    if (code.startsWith('1')) expectedNature = 'Debit';
    else if (code.startsWith('2')) expectedNature = 'Credit';
    else if (code.startsWith('3') || code.startsWith('4')) {
        if (lowerName.includes('receita') || lowerName.includes('faturamento') || lowerName.includes('venda')) expectedNature = 'Credit';
        else if (lowerName.includes('despesa') || lowerName.includes('custo') || lowerName.includes('gastos')) expectedNature = 'Debit';
    }
    const deductionKeywords = ['devolu', 'cancelamento', 'abatimento', 'imposto sobre', 'tributo sobre'];
    if (deductionKeywords.some(k => lowerName.includes(k))) {
        expectedNature = (expectedNature === 'Debit') ? 'Credit' : 'Debit';
    }
    if (lowerName.includes('depreciação acumulada') || lowerName.includes('amortização acumulada')) {
        expectedNature = 'Credit';
    }
    let actualNature: 'Debit' | 'Credit' = type;
    if (indicator) {
        if (indicator.toUpperCase() === 'D') actualNature = 'Debit';
        if (indicator.toUpperCase() === 'C') actualNature = 'Credit';
    } else {
        if (finalBalance < 0) actualNature = (type === 'Debit') ? 'Credit' : 'Debit';
    }
    if (expectedNature !== 'Unknown' && expectedNature !== actualNature) {
        if (lowerName.includes('lucro') || lowerName.includes('prejuízo') || lowerName.includes('resultado')) return false;
        return true;
    }
    return false;
}

function mapValuesToColumns(numbers: number[], docType: string): { initial: number, debit: number, credit: number, final: number } {
    const count = numbers.length;
    let initial = 0, debit = 0, credit = 0, final = 0;
    if (docType === 'DRE') {
        if (count > 0) final = numbers[0];
        return { initial, debit, credit, final };
    }
    // FIX: agora o prompt extrai 4 valores (SDO_ANT | DEB | CRED | SDO_ATUAL)
    // count >= 4 já existia — mas agora virá com dados reais de débito e crédito
    if (count === 1) { final = numbers[0]; }
    else if (count === 2) { initial = numbers[0]; final = numbers[1]; }
    else if (count === 3) { debit = numbers[0]; credit = numbers[1]; final = numbers[2]; }
    else if (count >= 4) { initial = numbers[0]; debit = numbers[1]; credit = numbers[2]; final = numbers[3]; }
    return { initial, debit, credit, final };
}

function normalizeFinancialData(rawLines: string[], docType: string): AnalysisResult {
    const accounts: ExtractedAccount[] = [];

    rawLines.forEach(line => {
        let cleanLine = line.trim();
        if (!cleanLine || cleanLine.length < 5) return;
        if (/^(doctype|data|conta|descri|saldo|débito|crédito|página|page|cod|cód|movimento|transporte|historico|empresa|cnpj)/i.test(cleanLine)) return;
        if (/^\|?[\s-]+\|?$/.test(cleanLine)) return;

        let code = '';
        let name = '';
        let valuesPart: number[] = [];
        let type: 'Debit' | 'Credit' = 'Debit';
        let rawIndicator: string | null = null;

        if (cleanLine.includes('|')) {
            const parts = cleanLine.split('|').map(p => p.trim()).filter(p => p.length > 0);
            if (parts.length >= 2) {
                const firstLooksLikeCode = /^[\d.]+$/.test(parts[0]) && parts[0].length < 20;
                // FIX: detectar código interno (0000000502) ou código com parênteses
                const firstIsInternal = /^\(?\d{6,}\)?$/.test(parts[0].trim());

                if (firstLooksLikeCode) {
                    code = parts[0];
                    name = parts[1];
                    for (let i = 2; i < parts.length; i++) {
                        // FIX: capturar indicador D/C que vem junto com o último valor
                        // Ex: "86.898.954,21 C" — separar número do indicador
                        const partClean = parts[i].replace(/\s+[DC]$/i, '').trim();
                        const indMatch = parts[i].match(/\s+([DC])$/i);
                        if (indMatch && i === parts.length - 1) rawIndicator = indMatch[1].toUpperCase();
                        if (/^[DC%]$/i.test(parts[i])) continue;
                        const val = parseFinancialNumber(partClean || parts[i]);
                        valuesPart.push(val);
                    }
                } else if (firstIsInternal) {
                    // Conta analítica com código interno: ignora código interno, usa próximo campo
                    code = parts[1] || '';
                    name = parts[2] || parts[1];
                    for (let i = 3; i < parts.length; i++) {
                        const partClean = parts[i].replace(/\s+[DC]$/i, '').trim();
                        const indMatch = parts[i].match(/\s+([DC])$/i);
                        if (indMatch && i === parts.length - 1) rawIndicator = indMatch[1].toUpperCase();
                        if (/^[DC%]$/i.test(parts[i])) continue;
                        const val = parseFinancialNumber(partClean || parts[i]);
                        valuesPart.push(val);
                    }
                } else {
                    name = parts[0];
                    for (let i = 1; i < parts.length; i++) {
                        const partClean = parts[i].replace(/\s+[DC]$/i, '').trim();
                        const indMatch = parts[i].match(/\s+([DC])$/i);
                        if (indMatch && i === parts.length - 1) rawIndicator = indMatch[1].toUpperCase();
                        if (/^[DC%]$/i.test(parts[i])) continue;
                        valuesPart.push(parseFinancialNumber(partClean || parts[i]));
                    }
                }
            }
        }

        // Fallback: reverse parsing
        if (valuesPart.length === 0) {
            cleanLine = cleanLine.replace(/\.{3,}/g, ' ');
            const tokens = cleanLine.split(/\s+/);
            const foundNumbers: number[] = [];
            let lastTokenIndex = tokens.length - 1;
            let numbersFoundCount = 0;
            while (lastTokenIndex >= 0 && numbersFoundCount < 4) {
                const token = tokens[lastTokenIndex];
                if (/^[DC%]$/i.test(token)) {
                    if (!rawIndicator && /^[DC]$/i.test(token)) rawIndicator = token.toUpperCase();
                    lastTokenIndex--;
                    continue;
                }
                if (/^[\d.,\-()]+$/.test(token) && /\d/.test(token)) {
                    foundNumbers.unshift(parseFinancialNumber(token));
                    numbersFoundCount++;
                    lastTokenIndex--;
                } else {
                    if (token.toUpperCase() === 'R$') { lastTokenIndex--; }
                    else { break; }
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

        name = name.replace(/[.|]{2,}/g, '').trim();
        if (!name || name.length < 2 || valuesPart.length === 0) return;

        const lowerName = name.toLowerCase();

        // FIX: detecção de tipo Credit ampliada
        if (code.startsWith('2') || code.startsWith('3') || code.startsWith('6') ||
            lowerName.includes('passivo') || lowerName.includes('fornecedor') ||
            lowerName.includes('receita') || lowerName.includes('patrimônio') ||
            lowerName.includes('capital') || lowerName.includes('lucro') ||
            lowerName.includes('venda') || lowerName.includes('faturamento') ||
            lowerName.includes('serviços prestados')) {
            type = 'Credit';
        }

        // FIX: indicador D/C do próprio balancete sobrescreve a detecção por nome
        if (rawIndicator === 'D') type = 'Debit';
        if (rawIndicator === 'C') type = 'Credit';

        // Devoluções são sempre Debit
        if (lowerName.includes('devoluc') || lowerName.includes('devolução') ||
            lowerName.includes('cancelamento') || lowerName.includes('abatimento')) {
            type = 'Debit';
        }

        if (docType === 'DRE') {
            if (lowerName.includes('custo') || lowerName.includes('despesa') ||
                lowerName.includes('imposto') || lowerName.includes('cmv')) {
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
            // FIX: se SDO_ATUAL for 0 mas CRÉDITO tiver valor (caso das contas de receita no balancete),
            // usa o crédito como valor final — isso resolve a Receita Bruta zerada
            if (finalBal === 0 && values.credit > 0 && type === 'Credit') {
                finalBal = values.credit;
            } else if (finalBal === 0 && (values.debit !== 0 || values.credit !== 0)) {
                finalBal = values.debit - values.credit;
            }
        }

        const possibleInversion = checkInversion(name, type, finalBal, rawIndicator, cleanCode);

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
            const nextAcc = accounts[idx + 1];
            let isParent = false;
            if (nextAcc && nextAcc.account_code && nextAcc.account_code.startsWith(myCode)) {
                const charAfter = nextAcc.account_code[myCode.length];
                if (charAfter === '.' || charAfter === '-' || charAfter === undefined) isParent = true;
            }
            acc.is_synthetic = isParent;
        } else if (
            acc.account_name.toLowerCase().startsWith('total') ||
            acc.account_name.toLowerCase().startsWith('grupo') ||
            acc.account_name.toLowerCase().startsWith('resultado')
        ) {
            acc.is_synthetic = true;
        }
    });

    const analyticalAccounts = accounts.filter(a => !a.is_synthetic);
    const calcAccounts = analyticalAccounts.length > 0
        ? analyticalAccounts
        : accounts.filter(a => !a.account_name.toLowerCase().includes('total'));

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
                if ((lower.includes('receita') || lower.includes('faturamento') || lower.includes('venda')) && acc.type === 'Credit') {
                    revenueSum += Math.abs(acc.final_balance);
                }
                if ((lower.includes('despesa') || lower.includes('custo')) && acc.type === 'Debit') {
                    expenseSum += Math.abs(acc.final_balance);
                }
            }
        });
        calculatedResult = revenueSum - expenseSum;
        if (Math.abs(calculatedResult) < 0.01) {
            const resultAccount = analyticalAccounts.find(a =>
                /lucro\s+l[ií]quido|preju[ií]zo\s+l[ií]quido/i.test(a.account_name)
            );
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

async function extractRawData(ai: GoogleGenAI, fileBase64: string, mimeType: string): Promise<{ lines: string[], docType: string }> {
    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ];

    // FIX PRINCIPAL: prompt reescrito para extrair TODAS as 4 colunas do balancete
    // ANTES: extraía só SDO_ATUAL → receitas com SDO_ATUAL=0 desapareciam
    // DEPOIS: extrai SDO_ANT | DÉBITO | CRÉDITO | SDO_ATUAL → captura receitas pelo CRÉDITO
    const basePrompt = `
    TASK: Extract ALL financial data from this Brazilian accounting document (Balancete/DRE/Balanço Patrimonial).

    OUTPUT FORMAT — one row per account:
    CODE | ACCOUNT NAME | SDO_ANTERIOR | DEBITO | CREDITO | SDO_ATUAL

    CRITICAL RULES:
    1. EXTRACT EVERY SINGLE ROW from ALL pages. Never skip any account, even if values are zero.
    2. USE PIPE (|) to separate all 6 fields exactly as shown above.
    3. FOR BALANCETE (4 numeric columns): map them in order → SDO_ANTERIOR | DEBITO | CREDITO | SDO_ATUAL.
       - IMPORTANT: accounts in groups 3, 4, 5 (Receitas/Custos/Despesas) often have SDO_ATUAL = 0,00
         but have large values in DEBITO or CREDITO columns. ALWAYS extract all 4 columns.
       - Example: "3.1.1 | RECEITA BRUTA | 0,00 | 0,00 | 86.898.954,21 | 86.898.954,21 C"
       - Example: "(0000000502) 0002 | VENDA DE MERCADORIAS A PRAZO | 0,00 | 0,00 | 86.650.198,27 | 86.650.198,27 C"
    4. FOR DRE (1-2 numeric columns): put 0,00 in missing fields.
    5. KEEP ORIGINAL NUMBER FORMAT exactly (e.g. 1.000,00 not 1000.00). Keep D/C suffix.
    6. INCLUDE synthetic/group accounts (e.g. "1 - ATIVO", "1.1 - ATIVO CIRCULANTE", "3.1.1 - RECEITA BRUTA").
    7. IGNORE only page headers, footers, column headers, and CNPJ/date lines.
    8. DO NOT summarize, skip, or merge rows.
    `;

    try {
        let extractedText = "";
        let docType = 'Balancete';

        if (mimeType === 'text/csv' || mimeType === 'text/plain' || mimeType === 'application/csv') {
            const decodedText = safeDecodeBase64(fileBase64);
            const allLines = decodedText.split('\n');
            const CHUNK_SIZE = 600;
            const chunks: string[] = [];
            for (let i = 0; i < allLines.length; i += CHUNK_SIZE) {
                chunks.push(allLines.slice(i, i + CHUNK_SIZE).join('\n'));
            }
            for (let i = 0; i < chunks.length; i++) {
                const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                    model: 'gemini-2.0-flash',
                    contents: { parts: [{ text: basePrompt + `\n\n--- SEGMENT ${i + 1} OF ${chunks.length} ---\n${chunks[i]}\n--- END SEGMENT ---` }] },
                    config: { temperature: 0.0, maxOutputTokens: 8192, safetySettings }
                }));
                if (response.text) extractedText += response.text + "\n";
            }
        } else if (mimeType === 'application/pdf') {
            console.log("Sending PDF directly to Gemini for extraction...");
            const sanitizedPdf = sanitizeBase64(fileBase64);
            const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: {
                    parts: [
                        { inlineData: { mimeType: 'application/pdf', data: sanitizedPdf } },
                        { text: basePrompt + "\n\nEXTRACT EVERY SINGLE ROW FROM ALL PAGES. Pay special attention to revenue accounts (groups 3.x) which may show 0,00 in SDO_ATUAL but have values in CREDITO column." }
                    ]
                },
                config: { temperature: 0.0, maxOutputTokens: 65000, safetySettings }
            }));
            if (response.text) extractedText = response.text;
        } else {
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

        const docTypeLine = lines.find(l => /Balanço|Balancete|Demonstração|Resultado/i.test(l));
        if (docTypeLine) {
            if (/Resultado|DRE/i.test(docTypeLine)) docType = 'DRE';
            else if (/Balanço/i.test(docTypeLine)) docType = 'Balanço Patrimonial';
        }

        lines = lines.filter(l => !l.startsWith('DOCTYPE') && /\d/.test(l));

        console.log("Raw Extracted Lines Preview:", lines.slice(0, 10));

        return { lines, docType };

    } catch (e: any) {
        console.error("Extraction Error:", e);
        throw new Error(`Erro na extração: ${e.message}`);
    }
}

async function generateNarrativeAnalysis(ai: GoogleGenAI, summaryData: any, sampleAccounts: { code: string, name: string }[]): Promise<{
    observations: string[], spellcheck: any[], period: string, account_audits?: any[]
}> {
    const prompt = `
    ATUE COMO: Auditor Contábil Senior SP Assessoria.
    DADOS: Doc: ${summaryData.document_type}, Resultado: ${summaryData.specific_result_value}.
    AMOSTRA CONTAS (Código | Nome): ${sampleAccounts.map(a => `${a.code} | ${a.name}`).join('; ')}
    
    TAREFA: 
    1. Identifique o período (ex: 01/2025 ou 2024 completo).
    2. Identifique erros ortográficos ou nomenclaturas contábeis fora do padrão.
    3. Sinalize contas com nomes genéricos ou confusos e sugira a melhor opção técnica.
    
    SAÍDA JSON RIGOROSA:
    {
      "period": "string",
      "observations": ["string"],
      "spellcheck": [{"original_term": "string", "suggested_correction": "string", "confidence": "High"}],
      "account_audits": [{"code": "string", "name": "string", "name_suggestion": "string", "posting_suggestion": "string", "audit_notes": "string"}]
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
    } catch (e) {
        return { observations: [], spellcheck: [], period: "Indefinido", account_audits: [] };
    }
}

export const analyzeDocument = async (fileBase64: string, mimeType: string): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const sanitizedInput = sanitizeBase64(fileBase64);
    const { lines, docType } = await extractRawData(ai, sanitizedInput, mimeType);
    if (lines.length === 0) throw new Error("Nenhum dado contábil identificado.");
    const result = normalizeFinancialData(lines, docType);
    if (result.accounts.length === 0) throw new Error("Falha na interpretação das linhas. Tente outro formato.");
    const sample = result.accounts.slice(0, 150).map(a => ({ code: a.account_code || '', name: a.account_name }));
    const narrative = await generateNarrativeAnalysis(ai, result.summary, sample);
    result.summary.period = narrative.period || 'Período não identificado';
    result.summary.observations = narrative.observations || [];
    result.spell_check = narrative.spellcheck || [];
    if (narrative.account_audits) {
        narrative.account_audits.forEach((audit: any) => {
            const acc = result.accounts.find(a =>
                (audit.code && a.account_code === audit.code) ||
                (a.account_name.toLowerCase().includes(audit.name?.toLowerCase() || ''))
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
    const accounts = (analysisData.accounts || [])
        .filter(a => !a.is_synthetic)
        .sort((a, b) => Math.abs(b.final_balance) - Math.abs(a.final_balance))
        .slice(0, 200)
        .map(a => `${a.account_code || ''} ${a.account_name}: ${a.final_balance}`)
        .join('\n');
    const prompt = `
    DADOS DO RELATÓRIO:\n${accounts}
    PEDIDO ESPECÍFICO:\n${userPrompt}
    INSTRUÇÕES DE AUDITORIA:
    1. Analise a LIQUIDEZ, SOLVÊNCIA e ESTRUTURA DE CAPITAL.
    2. Comente sobre o Resultado do Período (Lucro/Prejuízo) em relação ao faturamento.
    3. Destaque pontos de atenção na Saúde Financeira.
    4. Seja técnico, direto e use o tom da SP Assessoria Contábil.
    `;
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: { parts: [{ text: prompt }] },
        config: { systemInstruction: "Você é o Diretor de Auditoria e Estratégia da SP Assessoria.", temperature: 0.3 }
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
        history,
        config: { systemInstruction: "Assistente contábil sênior SP Assessoria.", tools: [{ googleSearch: {} }] }
    });
    const result: GenerateContentResponse = await chat.sendMessage({ message });
    return result.text;
};

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
        contents: { parts: [{ text: `Analise as variações financeiras entre ${period1} e ${period2}:\n\n${topVariations}` }] },
        config: { systemInstruction: "Auditor Contábil Senior da SP Assessoria especializado em análise horizontal.", temperature: 0.3 }
    }));
    return response.text || "Análise não gerada.";
};
