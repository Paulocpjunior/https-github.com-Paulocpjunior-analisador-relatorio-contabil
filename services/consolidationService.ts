import { AnalysisResult, HistoryItem, ConsolidationResult, ConsolidatedRow, ConsolidatedCompany } from "../types";

// FIX 1: getAccountKey — preserva estrutura do código, apenas normaliza separadores.
// ANTES: code.replace(/[^0-9]/g, '') → "0000000001" virava "1", colidindo com a conta "1" (ATIVO).
// DEPOIS: mantém pontos e zeros, apenas remove espaços e padroniza maiúsculas.
const getAccountKey = (code: string | null, name: string): string => {
    if (code && code.trim().length > 0) {
        return code.trim().toUpperCase();
    }
    return name.trim().toUpperCase();
};

// FIX 3: Corrige sinal do final_balance para Balanço Patrimonial.
// Contas de Ativo (código inicia com "1") têm natureza DEVEDORA → saldo sempre positivo.
// Contas de Passivo/PL (código inicia com "2") têm natureza CREDORA → saldo sempre positivo tb
// (representadas como positivo na visão de consolidação).
const normalizeBalance = (finalBalance: number, accountCode: string | null): number => {
    if (!accountCode) return finalBalance;
    const firstChar = accountCode.trim().replace(/^0+/, '').charAt(0);
    if (firstChar === '1' && finalBalance < 0) {
        return Math.abs(finalBalance); // Ativo com sinal negativo → inverte
    }
    if (firstChar === '2' && finalBalance < 0) {
        return Math.abs(finalBalance); // Passivo/PL com sinal negativo → inverte
    }
    return finalBalance;
};

export const consolidateDREs = (items: { item: HistoryItem, result: AnalysisResult }[]): ConsolidationResult => {
    const companies: ConsolidatedCompany[] = items.map(i => ({
        id: i.item.id,
        name: i.item.headerData.companyName,
        cnpj: i.item.headerData.cnpj
    }));

    const accountMap = new Map<string, ConsolidatedRow>();

    // FIX 2: Ignora contas sintéticas na mesclagem inicial.
    // ANTES: processava TUDO, inclusive sintéticas — cada empresa tem sua própria conta
    // "ATIVO CIRCULANTE" já somada. Ao mesclar, o mapa ficava com o valor de apenas
    // uma empresa (a última a escrever), ignorando as demais.
    // DEPOIS: apenas analíticas são mescladas. Sintéticas são recalculadas depois.

    // 1. Mescla apenas contas analíticas de todas as empresas
    items.forEach(({ item, result }) => {
        result.accounts
            .filter(acc => !acc.is_synthetic) // ← pula sintéticas
            .forEach(acc => {
                const key = getAccountKey(acc.account_code, acc.account_name);

                if (!accountMap.has(key)) {
                    accountMap.set(key, {
                        code: acc.account_code || '',
                        name: acc.account_name,
                        is_synthetic: false,
                        level: acc.level,
                        values: {},
                        total: 0
                    });
                }

                const row = accountMap.get(key)!;

                if (row.values[item.id] === undefined) row.values[item.id] = 0;

                // FIX 3 aplicado: corrige sinal antes de armazenar
                row.values[item.id] = normalizeBalance(acc.final_balance, acc.account_code);
            });
    });

    // 2. Recalcula contas sintéticas somando seus filhos analíticos do accountMap.
    // Garante que ATIVO, ATIVO CIRCULANTE, DISPONÍVEL etc. reflitam a soma real
    // das 4 empresas, e não apenas o valor de uma delas.
    const syntheticMeta = new Map<string, { code: string; name: string; level: number }>();

    items.forEach(({ result }) => {
        result.accounts
            .filter(acc => acc.is_synthetic)
            .forEach(acc => {
                const key = getAccountKey(acc.account_code, acc.account_name);
                if (!syntheticMeta.has(key)) {
                    syntheticMeta.set(key, {
                        code: acc.account_code || '',
                        name: acc.account_name,
                        level: acc.level
                    });
                }
            });
    });

    syntheticMeta.forEach((meta, synKey) => {
        const synRow: ConsolidatedRow = {
            code: meta.code,
            name: meta.name,
            is_synthetic: true,
            level: meta.level,
            values: {},
            total: 0
        };

        // Inicializa todas as empresas com 0
        companies.forEach(c => { synRow.values[c.id] = 0; });

        // Soma todas as analíticas cujo código começa com o código da sintética + "."
        if (meta.code) {
            accountMap.forEach((anaRow) => {
                if (anaRow.code && anaRow.code.startsWith(meta.code + '.')) {
                    companies.forEach(c => {
                        synRow.values[c.id] = (synRow.values[c.id] || 0) + (anaRow.values[c.id] || 0);
                    });
                }
            });
        }

        accountMap.set(synKey, synRow);
    });

    // 3. Calcula TOTAL GRUPO para todas as linhas (analíticas + sintéticas recalculadas)
    const rows = Array.from(accountMap.values()).map(row => {
        let sum = 0;
        companies.forEach(company => {
            const val = row.values[company.id] || 0;
            row.values[company.id] = val;
            sum += val;
        });
        row.total = sum;
        return row;
    });

    // 4. Ordena por código (natural sort: "1.1" < "1.1.1" < "1.1.2" < "1.2")
    rows.sort((a, b) => {
        if (!a.code && !b.code) return a.name.localeCompare(b.name);
        if (!a.code) return 1;
        if (!b.code) return -1;
        return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
    });

    return {
        companies,
        rows,
        generatedAt: new Date().toISOString(),
        groupName: companies.length > 0 ? `${companies[0].name} e Outras` : 'Grupo Econômico'
    };
};
