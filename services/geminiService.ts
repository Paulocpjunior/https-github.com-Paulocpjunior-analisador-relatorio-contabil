import { GoogleGenAI, GenerateContentResponse, HarmCategory, HarmBlockThreshold, Chat } from "@google/genai";
import { AnalysisResult, ExtractedAccount, ComparisonRow } from "../types";

// ============================================================================
// ⚠️ PAULO: COLOQUE SUA CHAVE DO GOOGLE ENTRE AS ASPAS ABAIXO (UMA SÓ VEZ) ⚠️
// ============================================================================
const MINHA_CHAVE_GEMINI = "AIzaSyAJIk05Vr5FW5q1h7CxSHLpigK3X3rozlY";
// ============================================================================

// Helper for Exponential Backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, baseDelay = 3000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        const message = error?.message || '';
        const status = error?.status || error?.code;

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

function customBase64ToUint8Array(base64: string): Uint8Array {
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;
    const cleaned = raw.replace(/[^A-Za-z0-9+/]/g, '');
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
    if (!clean || clean === '-' || clean === '–') return 0;

    clean = clean.replace(/^R\$\s?/, '').replace(/\s/g, '');
    clean = clean.replace(/O/gi, '0').replace(/l/g, '1').replace(/[^0-9.,\-()]/g, '');

    const isNegativeParens = /^\(.*\)$/.test(clean);
    if (isNegativeParens) {
        clean = clean.replace(/[()]/g, '');
    }

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
    else if (code.startsWith('3') || lowerName.includes('receita') || lowerName.includes('faturamento') || lowerName.includes('venda')) expectedNature = 'Credit';
    else if (code.startsWith('4') || lowerName.includes('despesa') || lowerName.includes('custo') || lowerName.includes('gastos')) expectedNature = 'Debit';

    const deductionKeywords = ['devolu', 'cancelamento', 'abatimento', 'imposto sobre', 'tributo sobre', 'cmv', 'cpv', 'csv'];
    if (deductionKeywords.some(k => lowerName.includes(k))) {
        expectedNature = 'Debit';
    }

    if (expectedNature !== 'Unknown') return false;
    return false;
}

function mapValuesToColumns(numbers: number[], docType: string): { initial: number, debit: number, credit: number, final: number } {
    const count = numbers.length;
    let initial = 0, debit = 0, credit = 0, final = 0;

    if (docType === 'DRE') {
        if (count > 0) final = numbers[0];
        return { initial, debit, credit, final };
    }

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
        if (/^(doctype|data|conta|descri|saldo|débito|crédito|página|page|cod|cód|movimento|transporte|historico|empresa|cnpj)/i.test(cleanLine)) return;
        if (/^\|?[\s-]+\|?$/.test(cleanLine)) return;

        let code = '';
        let name = '';
        let valuesPart: number[] = [];
        let type: 'Debit' | 'Credit' = 'Debit';

        if (cleanLine.includes('|')) {
            const parts = cleanLine.split('|').map(p => p.trim()).filter(p => p.length > 0);
            if (parts.length >= 2) {
                const firstLooksLikeCode = /^[\d.-]+$/.test(parts[0]) && parts[0].length < 20;
                if (firstLooksLikeCode) {
                    code = parts[0];
                    name = parts[1];
                    for (let i = 2; i < parts.length; i++) {
                        if (/^[DC%]$/i.test(parts[i])) continue;
                        valuesPart.push(parseFinancialNumber(parts[i]));
                    }
                } else {
                    name = parts[0];
                    for (let i = 1; i < parts.length; i++) {
                        if (/^[DC%]$/i.test(parts[i])) continue;
                        valuesPart.push(parseFinancialNumber(parts[i]));
                    }
                }
            }
        }

        if (valuesPart.length === 0) {
            cleanLine = cleanLine.replace(/\.{3,}/g, ' ');
            const tokens = cleanLine.split(/\s+/);
            const foundNumbers: number[] = [];
            let lastTokenIndex = tokens.length - 1;
            let numbersFoundCount = 0;

            while (lastTokenIndex >= 0 && numbersFoundCount < 4) {
                const token = tokens[lastTokenIndex];
                if (/^[DC%]$/i.test(token)) {
                    lastTokenIndex--;
                    continue;
                }
                if (/^[\d.,\-()]+$/.test(token) && /\d/.test(token)) {
                    foundNumbers.unshift(parseFinancialNumber(token));
                    numbersFoundCount++;
                    lastTokenIndex--;
                } else {
                    if (token.toUpperCase() === 'R$') lastTokenIndex--;
                    else break;
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

        accounts.push({
            account_code: cleanCode,
            account_name: name,
            initial_balance: values.initial,
            debit_value: values.debit,
            credit_value: values.credit,
            final_balance: finalBal,
            total_value: Math.abs(finalBal),
            type,
            possible_inversion: checkInversion(name, type, finalBal, null, cleanCode),
            ifrs18_category: category as any,
            level: 1,
            is_synthetic: false
        });
    });

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
                calculatedResult = resultAccount
