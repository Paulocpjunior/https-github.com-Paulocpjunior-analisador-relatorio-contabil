import { GoogleGenAI, GenerateContentResponse, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { AnalysisResult, ExtractedAccount } from "../types";

// Helper for Exponential Backoff
async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, baseDelay = 3000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const message = error?.message || '';
    const status = error?.status || error?.code;
    
    const isRateLimit = 
        message.includes('429') || 
        message.includes('Resource has been exhausted') || 
        message.includes('Quota exceeded') ||
        status === 429 || 
        status === 'RESOURCE_EXHAUSTED';

    const isServerOverload = message.includes('503') || status === 503;

    // 404 Model Not Found - Do not retry.
    if (message.includes('404') || message.includes('not found')) {
        throw error;
    }

    if ((isRateLimit || isServerOverload) && retries > 0) {
      console.warn(`API Quota/Busy (${status}). Retrying in ${baseDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, baseDelay));
      return retryWithBackoff(fn, retries - 1, baseDelay * 2);
    }
    throw error;
  }
}

// --- ROBUST FINANCIAL NUMBER PARSER ---
// Designed specifically for Brazilian OCR quirks
function parseFinancialNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  
  if (typeof val === 'string') {
    let clean = val.trim();
    const isNegative = clean.includes('-') || clean.startsWith('(') || clean.endsWith('D') || clean.endsWith('C'); // D/C handled by logic, but check for signs

    // Remove currency symbols and common OCR noise
    clean = clean.replace(/[R$]/gi, '').trim();
    // Fix OCR errors where 0, 1, l, O are confused
    clean = clean.replace(/[OolI]/g, (m) => m === 'I' || m === 'l' ? '1' : '0'); 
    
    // Handle "dirty" spaces inside numbers (e.g. "1 200, 00")
    clean = clean.replace(/\s+/g, ''); 
    
    // Remove trailing D/C if attached tightly
    clean = clean.replace(/[DC]$/i, '');

    // DETECT LOCALE STRATEGY
    // If there is a comma, we assume BR format (Comma = Decimal)
    if (clean.includes(',')) {
        // Remove thousands separators (dots)
        clean = clean.replace(/\./g, ''); 
        // Replace decimal comma with dot for JS parsing
        clean = clean.replace(/,/g, '.'); 
    } else {
        // If NO comma, check dots.
        const parts = clean.split('.');
        if (parts.length > 2) {
            // 1.000.000 -> Remove all dots
             clean = clean.replace(/\./g, '');
        } else if (parts.length === 2) {
             const decimalPart = parts[1];
             if (decimalPart.length === 3) {
                 // Likely 1.000 (Thousand)
                 clean = clean.replace(/\./g, '');
             } else {
                 // Likely 1.50 (Decimal) - Keep dot
             }
        }
    }

    clean = clean.replace(/[^0-9.]/g, '');
    const num = parseFloat(clean);
    // Note: We return positive numbers here; D/C logic handles polarity elsewhere usually, 
    // but if explicit minus sign existed, we respect it.
    return isNaN(num) ? 0 : (clean.includes('-') || val.includes('-') ? -num : num);
  }
  return 0;
}

function detectAccountNature(name: string, declaredType: string | null): 'Debit' | 'Credit' {
    const lower = name ? name.toLowerCase() : '';
    // Keywords for DEBIT (Active, Expenses)
    if (lower.includes('ativo') || lower.includes('despesa') || lower.includes('custo') || lower.includes('cliente') || lower.includes('caixa') || lower.includes('banco') || lower.includes('imobilizado') || lower.includes('aplicacao')) return 'Debit';
    // Keywords for CREDIT (Liability, Revenue, Equity)
    if (lower.includes('passivo') || lower.includes('receita') || lower.includes('fornecedor') || lower.includes('capital') || lower.includes('patrimonio') || lower.includes('pagar') || lower.includes('lucro') || lower.includes('faturamento')) return 'Credit';
    
    if (declaredType === 'D' || declaredType === 'DEBITO' || declaredType === 'DEBIT') return 'Debit';
    if (declaredType === 'C' || declaredType === 'CREDITO' || declaredType === 'CREDIT') return 'Credit';
    
    return 'Debit'; // Default
}

// --- DATA NORMALIZATION ---
function normalizeFinancialData(result: AnalysisResult): AnalysisResult {
  if (!result) return {
      summary: { document_type: 'Outro', period: 'N/A', total_credits: 0, total_debits: 0, is_balanced: false, discrepancy_amount: 0, observations: ['Erro: Resultado vazio'] },
      accounts: [],
      spell_check: []
  };
  
  // Safety initialization
  if (!Array.isArray(result.accounts)) result.accounts = [];
  if (!Array.isArray(result.spell_check)) result.spell_check = [];
  if (!result.summary) {
      result.summary = { document_type: 'Outro', period: 'N/A', total_credits: 0, total_debits: 0, is_balanced: false, discrepancy_amount: 0, observations: [] };
  }

  const seen = new Set();
  result.accounts = result.accounts.filter(acc => {
      if (!acc.account_name && !acc.account_code) return false;
      const key = `${acc.account_code}|${acc.account_name}|${acc.final_balance}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
  });

  result.accounts = result.accounts.map(acc => {
      let code = acc.account_code ? String(acc.account_code).trim() : '';
      let name = acc.account_name ? String(acc.account_name).trim() : '';

      // IMPROVED CODE SPLITTING:
      const splitRegex = /^([\d.]+(?:[-.]\d+)*)\s*[-–.]?\s+([A-Za-zÀ-ÿ].+)$/; 
      
      if ((!code || code.length < 2) && splitRegex.test(name)) {
         const match = name.match(splitRegex);
         if (match && match[1] && match[2]) {
             code = match[1]; 
             name = match[2]; 
         }
      }
      else if (!code && /^\d/.test(name)) {
          const parts = name.split(' ');
          if (parts.length > 1 && /^[\d.-]+$/.test(parts[0])) {
              code = parts[0];
              name = parts.slice(1).join(' ');
          }
      }

      if (code) code = code.replace(/[^0-9.\-]/g, '').replace(/^\.+|\.+$/g, '');
      name = name.replace(/^[.\-–\s]+/, '').trim();

      let initial = parseFinancialNumber(acc.initial_balance);
      let debit = parseFinancialNumber(acc.debit_value);
      let credit = parseFinancialNumber(acc.credit_value);
      let final = parseFinancialNumber(acc.final_balance);
      let rawTotal = parseFinancialNumber(acc.total_value); 

      const detectedNature = detectAccountNature(name, acc.type === 'Credit' ? 'C' : 'D');

      // HIERARCHY & SYNTHETIC LOGIC
      // Calculate level based on dots. e.g. "1" = 1, "1.1" = 2, "1.1.1" = 3
      let level = 1;
      if (code) {
          // Count dots or separators
          const separators = code.split(/[.-]/).length;
          level = separators;
      } else {
          // Fallback if no code (rare)
          level = 1; 
      }

      // Determine if Synthetic (Group) or Analytical
      // 1. If AI said it's synthetic, trust it partially.
      // 2. If it has NO debit/credit movement but HAS a balance, and level is low (1, 2, 3), it's likely Synthetic.
      // 3. Analytical accounts usually are deeper (Level 4+ or 3+)
      let isSynthetic = acc.is_synthetic; 
      
      // Auto-correction for synthetic status based on logic
      if (debit === 0 && credit === 0 && (initial !== 0 || final !== 0) && level < 4) {
          isSynthetic = true;
      }
      // If the code is very short (e.g. "1" or "2"), strictly synthetic
      if (code.length === 1) isSynthetic = true;

      // SCENARIO A: Single Column / Missing Debit/Credit but present Final
      if (debit === 0 && credit === 0 && final > 0) {
           if (detectedNature === 'Credit') {
               acc.type = 'Credit';
           } else {
               acc.type = 'Debit';
           }
      }

      // SCENARIO B: Swapped Columns Check
      if (final === 0 && (initial !== 0 || debit !== 0 || credit !== 0)) {
          if (detectedNature === 'Debit') final = initial + debit - credit;
          else final = initial + credit - debit;
      }
      
      let total = Math.max(debit, credit, final, rawTotal);
      
      let category = acc.ifrs18_category;
      if (!category && result.summary.document_type === 'DRE' && !isSynthetic) {
          const n = name.toLowerCase();
          if (n.includes('imposto') || n.includes('contribuicao')) category = 'Operacional';
          else if (n.includes('receita') || n.includes('venda') || n.includes('custo') || n.includes('despesa')) category = 'Operacional';
          else if (n.includes('juro') || n.includes('financ') || n.includes('emprestimo') || n.includes('bancari')) category = 'Financiamento';
          else if (n.includes('invest') || n.includes('imobiliz') || n.includes('equivale')) category = 'Investimento';
          else category = 'Operacional';
      }

      return {
          ...acc,
          account_code: code || null,
          account_name: name,
          initial_balance: initial,
          debit_value: debit,
          credit_value: credit,
          final_balance: final,
          total_value: total,
          type: acc.type || (debit > 0 || (final > 0 && detectedNature === 'Debit') ? 'Debit' : 'Credit'),
          ifrs18_category: category,
          level: level,
          is_synthetic: isSynthetic
      };
  });

  // Strict Filter for PAGE Totals, but KEEP Hierarchy Totals
  result.accounts = result.accounts.filter(acc => {
      const name = acc.account_name ? acc.account_name.toLowerCase() : '';
      const invalidKeywords = ['transporte', 'saldo anterior', 'apuração do resultado']; 
      
      if (invalidKeywords.some(k => name.includes(k))) return false;
      
      // If it says "Total" but it's a synthetic account (Group), keep it.
      // Only remove "Total Geral" or "Total do Periodo" if it duplicates the whole file.
      if (name === 'total geral' || name === 'total do ativo' || name === 'total do passivo') {
          // Often better to hide these top-level duplicates if they aren't properly coded
          // But if they have a code "1" or "2", we keep them.
          if (!acc.account_code) return false;
      }
      
      return true;
  });

  if (result.summary) {
      // SUM ONLY ANALYTICAL ACCOUNTS to avoid double counting groups
      const analyticalAccounts = result.accounts.filter(a => !a.is_synthetic);
      
      result.summary.total_debits = analyticalAccounts.reduce((sum, acc) => sum + acc.debit_value, 0);
      result.summary.total_credits = analyticalAccounts.reduce((sum, acc) => sum + acc.credit_value, 0);
      result.summary.discrepancy_amount = Math.abs(result.summary.total_debits - result.summary.total_credits);
      result.summary.is_balanced = result.summary.discrepancy_amount < 1.0;
      if (!result.summary.period) result.summary.period = 'Período não identificado';
  }

  return result;
}

// --- PARSER ---
function parseTextOutput(text: string): AnalysisResult {
    const result: AnalysisResult = {
        summary: { document_type: 'Outro', period: '', total_debits: 0, total_credits: 0, is_balanced: false, discrepancy_amount: 0, observations: [] },
        accounts: [],
        spell_check: []
    };

    if (!text) return result;

    let cleanText = text.replace(/```json/g, '').replace(/```/g, '');
    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l);
    
    const hasHeaders = lines.some(l => l.includes('---ACCOUNTS---'));
    let section = hasHeaders ? '' : 'ACCOUNTS';

    for (const line of lines) {
        if (line.includes('---SUMMARY---')) { section = 'SUMMARY'; continue; }
        if (line.includes('---ACCOUNTS---')) { section = 'ACCOUNTS'; continue; }
        if (line.includes('---SPELLCHECK---')) { section = 'SPELLCHECK'; continue; }
        if (line.includes('---END---')) { break; }

        if (section === 'SUMMARY') {
            const [key, val] = line.split(':').map(s => s.trim());
            if (key === 'TYPE') result.summary.document_type = val as any;
            if (key === 'PERIOD') result.summary.period = val;
            if (key === 'OBS') result.summary.observations = val ? val.split('|').map(o => o.trim()).filter(o => o) : [];
        } else if (section === 'ACCOUNTS') {
            // PIPE SPLIT FORMAT:
            // Code|Name|Initial|Debit|Credit|Final|Type|Inv|Cat|IsSynthetic
            let parts = line.split('|').map(p => p.trim());
            if (parts[0] === '') parts.shift();
            
            // REGEX RESCUE (Line Scanner)
            // Matches: Code Name Initial Debit Credit Final
            const lineRescueRegex = /^([\d.-]+)?\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*([DC])?$/i;
            
            // SYNTHETIC ACCOUNT RESCUE
            // Matches: Code Name Final
            const syntheticRescueRegex = /^([\d.-]+)\s+([^\d].+?)\s+([\d.,]+)\s*([DC])?$/i;

            const rescueMatch = line.match(lineRescueRegex);
            const syntheticMatch = line.match(syntheticRescueRegex);

            let code = '', name = '', initial = 0, debit = 0, credit = 0, final = 0, type = 'D', inversion = false, category = null;
            let isSynthetic = false;

            if (parts.length >= 6) {
                code = parts[0];
                name = parts[1];
                initial = parseFinancialNumber(parts[2]);
                debit = parseFinancialNumber(parts[3]);
                credit = parseFinancialNumber(parts[4]);
                final = parseFinancialNumber(parts[5]);
                type = parts[6] || 'D';
                inversion = parts[7] === 'T' || parts[7] === 'TRUE';
                category = parts[8] === 'null' ? null : (parts[8] as any);
                isSynthetic = parts[9] === 'T' || parts[9] === 'TRUE' || parts[9] === 'S'; // Check explicit flag
            } else if (rescueMatch) {
                code = rescueMatch[1] || '';
                name = rescueMatch[2];
                initial = parseFinancialNumber(rescueMatch[3]);
                debit = parseFinancialNumber(rescueMatch[4]);
                credit = parseFinancialNumber(rescueMatch[5]);
                final = parseFinancialNumber(rescueMatch[6]);
                type = (rescueMatch[7] || 'D').toUpperCase();
            } else if (syntheticMatch) {
                code = syntheticMatch[1];
                name = syntheticMatch[2];
                final = parseFinancialNumber(syntheticMatch[3]);
                type = (syntheticMatch[4] || 'D').toUpperCase();
                isSynthetic = true; // Regex used for group headers
            }

            if (name && (initial !== 0 || debit !== 0 || credit !== 0 || final !== 0 || isSynthetic)) {
                 result.accounts.push({
                    account_code: code || null,
                    account_name: name,
                    initial_balance: initial,
                    debit_value: debit,
                    credit_value: credit,
                    final_balance: final,
                    total_value: final, 
                    type: type.startsWith('C') ? 'Credit' : 'Debit',
                    possible_inversion: inversion,
                    ifrs18_category: category,
                    level: 1, // Will be calculated in normalize
                    is_synthetic: isSynthetic
                });
            }
        } else if (section === 'SPELLCHECK') {
            const parts = line.split('|');
            if (parts.length >= 2) result.spell_check.push({ original_term: parts[0].trim(), suggested_correction: parts[1].trim(), confidence: 'Medium' });
        }
    }
    return result;
}

function repairTruncatedJSON(jsonStr: string): string {
    let repaired = jsonStr.trim().replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '');
    if (repaired.length === 0) return "{}";

    const lastCurly = repaired.lastIndexOf('}');
    const lastSquare = repaired.lastIndexOf(']');
    const safeCut = Math.max(lastCurly, lastSquare);
    if (safeCut !== -1) repaired = repaired.substring(0, safeCut + 1);

    const stack: string[] = [];
    let inString = false;
    
    for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        const prev = i > 0 ? repaired[i-1] : '';
        if (char === '"' && prev !== '\\') { inString = !inString; continue; }
        if (inString) continue;
        if (char === '{') stack.push('}');
        else if (char === '[') stack.push(']');
        else if (char === '}' || char === ']') {
             if (stack.length > 0 && stack[stack.length-1] === char) stack.pop();
        }
    }

    while (stack.length > 0) repaired += stack.pop();
    return repaired;
}

export const analyzeDocument = async (fileBase64: string, mimeType: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) throw new Error("API Key not found.");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const performHighDensityAnalysis = async () => {
      const prompt = `
      ATUE COMO SISTEMA OCR CONTÁBIL DE ALTA PRECISÃO PARA ARQUIVOS EXTENSOS.
      O ARQUIVO CONTÉM MÚLTIPLAS PÁGINAS (13+). É CRUCIAL EXTRAIR TODO O CONTEÚDO SEM PARAR.

      ⚠️ REGRAS DE EXTRAÇÃO MASSIVA:
      1. IGNORE CABEÇALHOS E RODAPÉS DE PÁGINA REPETITIVOS (Ex: "Página X de Y", "Data emissão") para economizar espaço.
      2. MANTENHA O FOCO ESTRITO NAS LINHAS DE CONTAS.
      3. NÃO PARE NO FINAL DA PÁGINA 1. CONTINUE LENDO ATÉ O FINAL DO ARQUIVO.
      4. EXTRAIA HIERARQUIA COMPLETA: GRUPOS (SINTÉTICAS) E SUB-CONTAS (ANALÍTICAS).
      5. NÃO CONVERTA FORMATOS DE NÚMEROS. Copie exatamente como visto (ex: "1.000,00").
      6. SEPARE CÓDIGO DO NOME EM COLUNAS DISTINTAS.

      COLUNAS OBRIGATÓRIAS (Use Pipe '|' como separador):
      - Código
      - Nome da Conta
      - Saldo Anterior
      - Débito
      - Crédito
      - Saldo Atual / Final
      - Indicador D/C (D ou C)
      - Inversão? (T/F - True se natureza estiver invertida)
      - Categ IFRS (Se aplicável)
      - Sintética? (S/N - S se for Grupo/Totalizador, N se for Analítica)

      FORMATO DE SAÍDA (RAW TEXT, SEM MARKDOWN):
      ---SUMMARY---
      TYPE: {DRE/Balanço}
      PERIOD: {Período exato extraído}
      OBS: {Resumo executivo curto}
      ---ACCOUNTS---
      {Cod}|{Nome}|{S.Ant}|{Deb}|{Cred}|{S.Fin}|{T}|{Inv}|{Cat}|{Sint}
      {Cod}|{Nome}|{S.Ant}|{Deb}|{Cred}|{S.Fin}|{T}|{Inv}|{Cat}|{Sint}
      ... (REPITA PARA TODAS AS LINHAS, TODAS AS PÁGINAS)
      ---SPELLCHECK---
      {Termo}|{Correção}
      ---END---
      `;
      // USING GEMINI 3 PRO for maximum context window handling
      return await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: { parts: [{ inlineData: { mimeType: mimeType, data: fileBase64 } }, { text: prompt }] },
          config: { temperature: 0.0, maxOutputTokens: 8192, safetySettings }
      }));
  };

  const performEmergencySimpleExtraction = async () => {
      const prompt = `OCR MODE. Extract ALL accounts ROW BY ROW including GROUPS. Format: Code Name PreviousBal Debit Credit FinalBal D/C`;
      return await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
          model: 'gemini-2.5-flash', 
          contents: { parts: [{ inlineData: { mimeType: mimeType, data: fileBase64 } }, { text: prompt }] },
          config: { temperature: 0.0, maxOutputTokens: 8192, safetySettings }
      }));
  };

  let analysisResult: AnalysisResult | null = null;

  try {
    console.log("Attempt 1: Gemini 3 Pro Pipe (Massive File Mode)");
    const response = await performHighDensityAnalysis();
    if (response.text) analysisResult = parseTextOutput(response.text);
  } catch (e) { console.warn("Attempt 1 failed", e); }

  if (!analysisResult || !analysisResult.accounts || analysisResult.accounts.length === 0) {
      try {
        console.log("Attempt 2: JSON Mode");
        const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ inlineData: { mimeType, data: fileBase64 } }, { text: "Extrair todas as contas (Sintéticas e Analíticas) para JSON: account_code, account_name, initial_balance, debit_value, credit_value, final_balance, type (D/C), is_synthetic (bool)." }] },
            config: { responseMimeType: "application/json", safetySettings }
        }));
        if (response.text) {
            const repairedJSON = repairTruncatedJSON(response.text);
            analysisResult = JSON.parse(repairedJSON) as AnalysisResult;
        }
      } catch(e) { console.warn("Attempt 2 failed", e); }
  }

  if (!analysisResult || !analysisResult.accounts || analysisResult.accounts.length === 0) {
      try {
        console.log("Attempt 3: Emergency Flash");
        const response = await performEmergencySimpleExtraction();
        if (response.text) analysisResult = parseTextOutput(response.text);
      } catch(e) { console.warn("Attempt 3 failed", e); }
  }

  if (!analysisResult || !analysisResult.accounts || analysisResult.accounts.length === 0) {
      throw new Error("O modelo não retornou dados. O documento pode estar ilegível.");
  }

  return normalizeFinancialData(analysisResult);
};

export const generateFinancialInsight = async (
  analysisData: AnalysisResult,
  userPrompt: string,
  multiple: number,
  accountingStandard: string = 'IFRS 18 / CPC Brasil'
): Promise<string> => {
  if (!process.env.API_KEY) throw new Error("API Key not found.");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const accounts = (analysisData.accounts || []).slice(0, 300).map(a => `${a.account_name}: ${a.total_value}`).join('\n');
  
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts: [{ text: `Contexto:\n${accounts}\nPergunta: ${userPrompt}\nNorma: ${accountingStandard}` }] },
    config: { temperature: 0.4, tools: [{ googleSearch: {} }] }
  }));
  return response.text || "Erro na geração do insight.";
};

export const generateCMVAnalysis = async (analysisData: AnalysisResult, accountingStandard: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const accounts = (analysisData.accounts || []).slice(0, 400).map(a => `${a.account_code} ${a.account_name}: ${a.total_value}`).join('\n');
    
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: { parts: [{ text: `Analise CMV:\n${accounts}` }] },
      config: { 
          systemInstruction: `Especialista em Custos e ${accountingStandard}.`, 
          temperature: 0.3
      }
    }));
    return response.text || "Erro na análise de CMV.";
};

export const chatWithFinancialAgent = async (history: {role: 'user' | 'model', parts: {text: string}[]}[], message: string) => {
    if (!process.env.API_KEY) throw new Error("API Key not found.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const chat = ai.chats.create({
        model: 'gemini-3-pro-preview',
        history: history,
        config: { systemInstruction: "Assistente contábil sênior.", tools: [{ googleSearch: {} }] }
    });
    const result = await chat.sendMessage({ message });
    return result.text;
}