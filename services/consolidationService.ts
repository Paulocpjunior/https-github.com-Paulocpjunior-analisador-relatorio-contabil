
import { AnalysisResult, HistoryItem, ConsolidationResult, ConsolidatedRow, ConsolidatedCompany } from "../types";

// Helper to normalize account keys for merging
const getAccountKey = (code: string | null, name: string): string => {
    // Priority: Code. If code exists, use it as primary key (stripping dots for loose matching).
    // If no code, use normalized name.
    if (code && code.length > 0) {
        return code.replace(/[^0-9]/g, ''); 
    }
    return name.trim().toUpperCase();
};

export const consolidateDREs = (items: { item: HistoryItem, result: AnalysisResult }[]): ConsolidationResult => {
    const companies: ConsolidatedCompany[] = items.map(i => ({
        id: i.item.id,
        name: i.item.headerData.companyName,
        cnpj: i.item.headerData.cnpj
    }));

    const accountMap = new Map<string, ConsolidatedRow>();

    // 1. Iterate over all companies to build the superset of accounts
    items.forEach(({ item, result }) => {
        result.accounts.forEach(acc => {
            const key = getAccountKey(acc.account_code, acc.account_name);
            
            if (!accountMap.has(key)) {
                accountMap.set(key, {
                    code: acc.account_code || '',
                    name: acc.account_name,
                    is_synthetic: acc.is_synthetic,
                    level: acc.level,
                    values: {},
                    total: 0
                });
            }

            const row = accountMap.get(key)!;
            
            // Populate value for this company
            // Ensure we initialize if undefined
            if (row.values[item.id] === undefined) row.values[item.id] = 0;
            
            // Add value (Assuming final_balance represents the DRE line value)
            // Note: In our extraction logic, final_balance for DRE is the line amount.
            row.values[item.id] = acc.final_balance;
        });
    });

    // 2. Calculate Totals and finalize rows
    const rows = Array.from(accountMap.values()).map(row => {
        let sum = 0;
        companies.forEach(company => {
            const val = row.values[company.id] || 0;
            row.values[company.id] = val; // Ensure 0 instead of undefined
            sum += val;
        });
        row.total = sum;
        return row;
    });

    // 3. Sort rows by Code
    rows.sort((a, b) => {
        // Handle rows without codes (push to bottom or sort by name)
        if (!a.code && !b.code) return 0;
        if (!a.code) return 1;
        if (!b.code) return -1;
        
        // Natural sort for "1.01", "1.02", "1.10"
        return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
    });

    // 4. Recalculate Result (Lucro/Prejuízo) explicitly to ensure math consistency
    // (Optional, depends if the rows contain the calculated result or just lines)
    // We rely on the rows extracted.

    return {
        companies,
        rows,
        generatedAt: new Date().toISOString(),
        groupName: companies.length > 0 ? `${companies[0].name} e Outras` : 'Grupo Econômico'
    };
};
