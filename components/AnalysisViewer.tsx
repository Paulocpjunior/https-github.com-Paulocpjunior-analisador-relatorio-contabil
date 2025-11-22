import React, { useState, useMemo, useEffect } from 'react';
import { AnalysisResult, ExtractedAccount, HeaderData } from '../types';
import { generateFinancialInsight, generateCMVAnalysis } from '../services/geminiService';
import jsPDF from 'jspdf';

interface Props {
  result: AnalysisResult;
  headerData: HeaderData;
}

type SortKey = keyof ExtractedAccount;

const DEFAULT_EBITDA_MULTIPLE_KEY = 'auditAI_default_ebitda_multiple';

const AnalysisViewer: React.FC<Props> = ({ result, headerData }) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isTableLoading, setIsTableLoading] = useState(true);
  
  const [expandedIFRSCategories, setExpandedIFRSCategories] = useState<{
      Operacional: boolean;
      Investimento: boolean;
      Financiamento: boolean;
  }>({ Operacional: true, Investimento: false, Financiamento: false });

  // State to track expanded groups (Synthetic Accounts) by Code
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  // Initialize all groups as expanded by default when result changes
  useEffect(() => {
      if (result.accounts) {
          const allSyntheticCodes = result.accounts.filter(a => a.is_synthetic && a.account_code).map(a => a.account_code!);
          setExpandedGroups(new Set(allSyntheticCodes));
      }
  }, [result]);

  const [isValuationExpanded, setIsValuationExpanded] = useState(true);
  const [isSpellCheckExpanded, setIsSpellCheckExpanded] = useState(true); // Default to true to show suggestions immediately
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100); // Increased since we have hierarchy now

  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<'All' | 'Debit' | 'Credit'>('All');
  const [filterMinVal, setFilterMinVal] = useState<string>('');
  const [filterMaxVal, setFilterMaxVal] = useState<string>('');
  const [filterInversion, setFilterInversion] = useState<'all' | 'yes' | 'no'>('all');
  const [filterHasCorrection, setFilterHasCorrection] = useState(false);
  const [showCorrectedNames, setShowCorrectedNames] = useState(false);

  const [insightPrompt, setInsightPrompt] = useState('Calcular EBITDA detalhado com base nos dados extraídos e estimar Valuation.');
  const [valuationMultiple, setValuationMultiple] = useState(() => {
    try { const saved = localStorage.getItem(DEFAULT_EBITDA_MULTIPLE_KEY); return saved ? parseFloat(saved) : 5; } catch { return 5; }
  });
  const [accountingStandard, setAccountingStandard] = useState('IFRS 18 / CPC Brasil');
  const [insightResult, setInsightResult] = useState<string>('');
  const [isInsightLoading, setIsInsightLoading] = useState(false);

  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const { summary, accounts = [], spell_check = [] } = result || {};

  const validSpellCheck = useMemo(() => {
      if (!spell_check) return [];
      return spell_check.filter(s => s.original_term && s.suggested_correction && s.original_term.toLowerCase() !== s.suggested_correction.toLowerCase());
  }, [spell_check]);

  const invertedAccounts = useMemo(() => {
      return accounts.filter(a => a.possible_inversion && !a.is_synthetic);
  }, [accounts]);

  const netResult = useMemo(() => summary ? summary.total_credits - summary.total_debits : 0, [summary]);
  const profitLossLabel = useMemo(() => netResult >= 0 ? 'LUCRO / SUPERÁVIT' : 'PREJUÍZO / DÉFICIT', [netResult]);
  const profitLossStyle = useMemo(() => netResult >= 0 
      ? { text: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' }
      : { text: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800' }, [netResult]);

  const getDisplayedName = (account: ExtractedAccount) => {
      let correctedName = account.account_name;
      spell_check.forEach(sc => {
          if (sc.confidence !== 'Low') {
              const escapedOriginal = sc.original_term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(escapedOriginal, 'gi');
              correctedName = correctedName.replace(regex, sc.suggested_correction);
          }
      });
      return correctedName;
  };

  useEffect(() => { setIsTableLoading(true); setTimeout(() => setIsTableLoading(false), 600); }, [result]);
  useEffect(() => setCurrentPage(1), [searchTerm, filterType, filterMinVal, filterMaxVal, filterInversion, filterHasCorrection]);

  const toggleGroup = (code: string) => {
      const newSet = new Set(expandedGroups);
      if (newSet.has(code)) {
          newSet.delete(code);
      } else {
          newSet.add(code);
      }
      setExpandedGroups(newSet);
  };

  const expandAllGroups = () => {
      const allCodes = accounts.filter(a => a.is_synthetic && a.account_code).map(a => a.account_code!);
      setExpandedGroups(new Set(allCodes));
  };

  const collapseAllGroups = () => {
      setExpandedGroups(new Set());
  };

  const filteredAndSortedAccounts = useMemo(() => {
    if (!accounts) return [];
    let processedAccounts = accounts.map((acc, index) => ({ ...acc, originalIndex: index }));

    if (searchTerm) {
        const s = searchTerm.toLowerCase();
        processedAccounts = processedAccounts.filter(a => a.account_name.toLowerCase().includes(s) || (a.account_code && a.account_code.toLowerCase().includes(s)));
    }
    if (filterType !== 'All') processedAccounts = processedAccounts.filter(acc => acc.type === filterType);
    if (filterMinVal && !isNaN(parseFloat(filterMinVal))) processedAccounts = processedAccounts.filter(acc => Math.max(acc.debit_value, acc.credit_value) >= parseFloat(filterMinVal));
    if (filterMaxVal && !isNaN(parseFloat(filterMaxVal))) processedAccounts = processedAccounts.filter(acc => Math.max(acc.debit_value, acc.credit_value) <= parseFloat(filterMaxVal));
    if (filterInversion !== 'all') processedAccounts = processedAccounts.filter(acc => filterInversion === 'yes' ? acc.possible_inversion : !acc.possible_inversion);
    if (filterHasCorrection) processedAccounts = processedAccounts.filter(acc => getDisplayedName(acc) !== acc.account_name);

    // Hierarchy Filtering: Only show accounts if their parent is expanded
    // We do this by checking if the account's parent code is in the expanded set.
    if (!searchTerm && filterType === 'All' && !filterMinVal && !filterInversion) {
        processedAccounts = processedAccounts.filter(acc => {
            if (!acc.account_code) return true;
            const parts = acc.account_code.split(/[.-]/);
            if (parts.length <= 1) return true; 
            
            let currentPath = parts[0];
            for (let i = 1; i < parts.length; i++) {
                if (!expandedGroups.has(currentPath)) return false;
                currentPath += (acc.account_code.includes('-') ? '-' : '.') + parts[i];
            }
            return true;
        });
    }

    if (sortConfig) {
      processedAccounts.sort((a, b) => {
        let aVal: any = a[sortConfig.key] || '', bVal: any = b[sortConfig.key] || '';
        if (typeof aVal === 'boolean') { aVal = aVal ? 1 : 0; bVal = bVal ? 1 : 0; }
        return aVal < bVal ? (sortConfig.direction === 'asc' ? -1 : 1) : (sortConfig.direction === 'asc' ? 1 : -1);
      });
    }
    return processedAccounts;
  }, [accounts, sortConfig, searchTerm, filterType, filterMinVal, filterMaxVal, filterInversion, filterHasCorrection, expandedGroups]);

  const paginatedAccounts = useMemo(() => filteredAndSortedAccounts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredAndSortedAccounts, currentPage, itemsPerPage]);
  const requestSort = (key: SortKey) => setSortConfig({ key, direction: sortConfig?.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc' });

  // IFRS 18 Grouping
  const ifrsGroups = useMemo(() => {
      const groups = {
          Operacional: [] as ExtractedAccount[],
          Investimento: [] as ExtractedAccount[],
          Financiamento: [] as ExtractedAccount[]
      };
      accounts.forEach(acc => {
          if (acc.ifrs18_category === 'Operacional') groups.Operacional.push(acc);
          else if (acc.ifrs18_category === 'Investimento') groups.Investimento.push(acc);
          else if (acc.ifrs18_category === 'Financiamento') groups.Financiamento.push(acc);
          else if (summary && summary.document_type === 'DRE') groups.Operacional.push(acc); 
      });
      return groups;
  }, [accounts, summary]);

  const totalIFRSAccounts = ifrsGroups.Operacional.length + ifrsGroups.Investimento.length + ifrsGroups.Financiamento.length;
  const hasIFRSData = summary.document_type === 'DRE' && totalIFRSAccounts > 0;

  const toggleIFRSCategory = (cat: keyof typeof expandedIFRSCategories) => {
      setExpandedIFRSCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const expandAllIFRS = () => setExpandedIFRSCategories({ Operacional: true, Investimento: true, Financiamento: true });
  const collapseAllIFRS = () => setExpandedIFRSCategories({ Operacional: false, Investimento: false, Financiamento: false });

  const handleGenerateInsight = async () => {
      if (!insightPrompt) return;
      setIsInsightLoading(true);
      try {
          const text = await generateFinancialInsight(result, insightPrompt, valuationMultiple, accountingStandard);
          setInsightResult(text);
      } catch (error) { setInsightResult("Erro ao gerar análise."); } 
      finally { setIsInsightLoading(false); }
  };

  const handleGenerateCMV = async () => {
      setIsInsightLoading(true);
      try {
          const text = await generateCMVAnalysis(result, accountingStandard);
          setInsightResult(text);
          setIsValuationExpanded(true);
          document.getElementById('valuation')?.scrollIntoView({ behavior: 'smooth' });
      } catch (error) { setInsightResult("Erro na análise CMV."); }
      finally { setIsInsightLoading(false); }
  };

  if (!summary) return null;

  return (
    <div className="space-y-8 animate-fadeIn relative">
      
      {/* HEADER WITH COMPANY INFO */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm mb-2 border border-slate-200 dark:border-slate-700">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">{headerData.companyName || 'Empresa não identificada'}</h2>
        <div className="flex flex-col md:flex-row md:items-center gap-2 mt-1 text-slate-500 dark:text-slate-400 text-sm font-medium">
            {headerData.cnpj && (
                <span className="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
                    {headerData.cnpj}
                </span>
            )}
            {summary.period && (
                <>
                    <span className="hidden md:inline mx-1">•</span>
                    <span className="flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0h18M5.25 12h13.5" /></svg>
                        {summary.period}
                    </span>
                </>
            )}
        </div>
      </div>

      <div id="summary" className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="bg-slate-800 dark:bg-slate-900 px-6 py-4 flex justify-between items-center">
          <h3 className="text-xl font-semibold text-white">Resumo: {summary.document_type}</h3>
          <button onClick={() => { setInsightPrompt("Calcular EBITDA"); setIsValuationExpanded(true); document.getElementById('valuation')?.scrollIntoView(); }} className="text-sm bg-yellow-600 hover:bg-yellow-500 text-white py-2 px-3 rounded border border-yellow-500">⚡ EBITDA</button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-100 dark:border-blue-800"><p className="text-sm text-blue-600 font-medium">Débitos (Analítico)</p><p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(summary.total_debits)}</p></div>
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded border border-red-100 dark:border-red-800"><p className="text-sm text-red-600 font-medium">Créditos (Analítico)</p><p className="text-2xl font-bold text-red-900 dark:text-red-100">{formatCurrency(summary.total_credits)}</p></div>
            <div className={`p-4 rounded border ${profitLossStyle.bg} ${profitLossStyle.border}`}><p className={`text-sm font-bold ${profitLossStyle.text}`}>{profitLossLabel}</p><p className={`text-2xl font-bold ${profitLossStyle.text}`}>{formatCurrency(netResult)}</p></div>
            <div className={`p-4 rounded border ${summary.is_balanced ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}><p className="text-sm font-medium">Status</p><span className={`text-lg font-bold ${summary.is_balanced ? 'text-green-800' : 'text-red-800'}`}>{summary.is_balanced ? 'Balanceado' : 'Desbalanceado'}</span></div>
        </div>
        
        {/* AI SUMMARY NARRATIVE */}
        <div className="px-6 pb-6">
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-100 dark:border-indigo-800">
                <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-300 mb-4 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
                    Resumo Detalhado da Análise IA
                </h4>
                
                {/* EVIDENCE ANALYTICAL TOTALS & COMPOSITION */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm mb-6">
                        <div className="bg-white/60 dark:bg-slate-800/60 p-3 rounded border border-indigo-100 dark:border-indigo-900/50">
                            <div className="flex justify-between items-baseline mb-1">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Total Débitos (Analítico)</span>
                                <span className="font-mono font-bold text-blue-700 dark:text-blue-300 text-lg">{formatCurrency(summary.total_debits)}</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Composição: Soma de todas as contas analíticas de natureza devedora, incluindo <strong>Ativos</strong> e <strong>Despesas</strong>.
                            </p>
                        </div>
                        <div className="bg-white/60 dark:bg-slate-800/60 p-3 rounded border border-indigo-100 dark:border-indigo-900/50">
                            <div className="flex justify-between items-baseline mb-1">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Total Créditos (Analítico)</span>
                                <span className="font-mono font-bold text-red-700 dark:text-red-300 text-lg">{formatCurrency(summary.total_credits)}</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Composição: Soma de todas as contas analíticas de natureza credora, incluindo <strong>Passivos</strong>, <strong>Patrimônio Líquido</strong> e <strong>Receitas</strong>.
                            </p>
                        </div>
                </div>

                {/* INVERTED ACCOUNTS SUMMARY */}
                {invertedAccounts.length > 0 && (
                     <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 p-3 rounded border border-amber-200 dark:border-amber-800/50">
                         <h5 className="font-bold text-amber-800 dark:text-amber-500 text-xs uppercase mb-2">Anomalias Identificadas (Inversões)</h5>
                         <p className="text-sm text-amber-900 dark:text-amber-200">
                             Foram detectadas <strong>{invertedAccounts.length}</strong> contas com saldo invertido (natureza contrária). 
                             Contas como: <span className="italic">{invertedAccounts.slice(0, 3).map(a => a.account_name).join(', ')}{invertedAccounts.length > 3 ? '...' : ''}</span>.
                         </p>
                     </div>
                )}

                <div className="mt-4">
                    <h5 className="font-bold text-slate-700 dark:text-slate-300 text-xs uppercase mb-2">Observações Gerais da IA:</h5>
                    <ul className="list-disc list-inside text-sm text-slate-700 dark:text-slate-300 space-y-1">
                        {summary.observations.length > 0 ? (
                            summary.observations.map((obs, i) => <li key={i}>{obs}</li>)
                        ) : (
                            <li className="italic text-slate-500">Nenhuma observação adicional gerada.</li>
                        )}
                    </ul>
                </div>
            </div>
         </div>
      </div>

      {/* SPELL CHECK SUGGESTIONS SECTION */}
      {validSpellCheck.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="bg-teal-700 px-6 py-4 flex justify-between cursor-pointer hover:bg-teal-600 transition-colors" onClick={() => setIsSpellCheckExpanded(!isSpellCheckExpanded)}>
                  <h3 className="text-lg font-semibold text-white flex items-center">
                      📝 Sugestões de Correção Ortográfica ({validSpellCheck.length})
                  </h3>
                  <span className="text-white">{isSpellCheckExpanded ? '▲' : '▼'}</span>
              </div>
              {isSpellCheckExpanded && (
                  <div className="p-4 max-h-96 overflow-y-auto bg-slate-50 dark:bg-slate-900">
                      <table className="min-w-full text-sm text-left">
                          <thead className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                              <tr>
                                  <th className="p-2 rounded-tl-lg">Termo Original</th>
                                  <th className="p-2">Sugestão IA</th>
                                  <th className="p-2 rounded-tr-lg">Confiança</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                              {validSpellCheck.map((item, idx) => (
                                  <tr key={idx} className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700">
                                      <td className="p-2 font-mono text-red-600 dark:text-red-400">{item.original_term}</td>
                                      <td className="p-2 font-bold text-green-600 dark:text-green-400">{item.suggested_correction}</td>
                                      <td className="p-2">
                                          <span className={`px-2 py-0.5 rounded text-xs ${item.confidence === 'High' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                              {item.confidence === 'High' ? 'Alta' : 'Média'}
                                          </span>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              )}
          </div>
      )}

      {/* IFRS 18 DRE SEction */}
      {summary.document_type === 'DRE' && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="bg-teal-900 px-6 py-4 flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-white">Análise IFRS 18 (DRE)</h3>
                  <div className="flex gap-2">
                      <button 
                          onClick={expandAllIFRS} 
                          disabled={!hasIFRSData}
                          className={`text-xs bg-teal-800 hover:bg-teal-700 text-white py-1 px-2 rounded border border-teal-700 ${!hasIFRSData ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                          Expandir Tudo
                      </button>
                      <button 
                          onClick={collapseAllIFRS} 
                          disabled={!hasIFRSData}
                          className={`text-xs bg-teal-800 hover:bg-teal-700 text-white py-1 px-2 rounded border border-teal-700 ${!hasIFRSData ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                          Recolher Tudo
                      </button>
                  </div>
              </div>
              {hasIFRSData ? (
                  <div className="p-4 space-y-2">
                      {Object.entries(ifrsGroups).map(([category, value]) => {
                          const catAccounts = value as ExtractedAccount[];
                          if (catAccounts.length === 0) return null;
                          return (
                          <div key={category} className="border rounded-lg dark:border-slate-700 overflow-hidden">
                              <div 
                                  className="bg-slate-50 dark:bg-slate-700 p-3 flex justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600"
                                  onClick={() => toggleIFRSCategory(category as any)}
                              >
                                  <div className="font-bold text-slate-700 dark:text-white">{category} ({catAccounts.length})</div>
                                  <div className="flex items-center gap-4">
                                      <span className="text-sm font-mono font-semibold text-slate-600 dark:text-slate-300">
                                          {formatCurrency(catAccounts.reduce((sum, a) => sum + a.total_value, 0))}
                                      </span>
                                      <span className="text-slate-500">{expandedIFRSCategories[category as keyof typeof expandedIFRSCategories] ? '▲' : '▼'}</span>
                                  </div>
                              </div>
                              {expandedIFRSCategories[category as keyof typeof expandedIFRSCategories] && (
                                  <div className="p-3 bg-white dark:bg-slate-800">
                                      <table className="min-w-full text-sm">
                                          <tbody>
                                              {catAccounts.map((acc, idx) => (
                                                  <tr key={idx} className="border-b dark:border-slate-700 last:border-0">
                                                      <td className="py-1 text-slate-600 dark:text-slate-300">{acc.account_name}</td>
                                                      <td className="py-1 text-right font-mono">{formatCurrency(acc.total_value)}</td>
                                                  </tr>
                                              ))}
                                          </tbody>
                                      </table>
                                  </div>
                              )}
                          </div>
                      )})}
                  </div>
              ) : (
                  <div className="p-6 text-center text-slate-500 dark:text-slate-400 italic">
                      Nenhuma conta detalhada identificada para categorização IFRS 18.
                  </div>
              )}
          </div>
      )}

      <div id="valuation" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
         <div className="bg-indigo-900 px-6 py-4 flex justify-between cursor-pointer" onClick={() => setIsValuationExpanded(!isValuationExpanded)}>
            <h3 className="text-lg font-semibold text-white">Ferramentas Financeiras & Valuation (IA)</h3>
            <span className="text-white">{isValuationExpanded ? '▲' : '▼'}</span>
         </div>
         {isValuationExpanded && (
             <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div><label className="block text-sm font-medium mb-1 dark:text-white">Norma Contábil</label><select value={accountingStandard} onChange={e => setAccountingStandard(e.target.value)} className="w-full border rounded p-2 dark:bg-slate-700 dark:text-white"><option>IFRS 18 / CPC Brasil</option><option>US GAAP</option><option>IFRS International</option></select></div>
                    <div><label className="block text-sm font-medium mb-1 dark:text-white">Múltiplo Valuation (x EBITDA)</label><input type="range" min="1" max="20" step="0.5" value={valuationMultiple} onChange={e => { const v = parseFloat(e.target.value); setValuationMultiple(v); localStorage.setItem(DEFAULT_EBITDA_MULTIPLE_KEY, String(v)); }} className="w-full" /><div className="text-right text-sm dark:text-white">{valuationMultiple}x</div></div>
                    <div className="flex items-end"><button onClick={handleGenerateCMV} className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded">Análise de CMV (Lei Vigente)</button></div>
                </div>
                <textarea value={insightPrompt} onChange={e => setInsightPrompt(e.target.value)} className="w-full p-3 border rounded dark:bg-slate-700 dark:text-white" rows={3} placeholder="Pergunta para IA..." />
                <button onClick={handleGenerateInsight} disabled={isInsightLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded w-full">{isInsightLoading ? 'Processando...' : 'Gerar Análise / Valuation'}</button>
                {insightResult && <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900 rounded border dark:border-slate-700 whitespace-pre-wrap dark:text-slate-300">{insightResult}</div>}
             </div>
         )}
      </div>

      <div id="accounts" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
         <div className="px-6 py-4 border-b dark:border-slate-700 flex justify-between items-center">
            <h3 className="text-lg font-semibold dark:text-white">Contas ({filteredAndSortedAccounts.length})</h3>
            <div className="flex gap-2">
                {validSpellCheck.length > 0 && (
                    <button 
                        onClick={() => setShowCorrectedNames(!showCorrectedNames)} 
                        className={`px-3 py-2 rounded text-sm font-semibold border transition-all shadow-sm ${showCorrectedNames ? 'bg-green-600 hover:bg-green-700 text-white border-green-700' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'}`}
                    >
                        {showCorrectedNames ? '✔ Nomes Corrigidos' : 'Visualizar Correções'}
                    </button>
                )}
                <button onClick={() => setShowFilters(!showFilters)} className="bg-blue-600 text-white px-3 py-2 rounded text-sm flex items-center gap-1">
                    Filtros Avançados {showFilters ? '▲' : '▼'}
                </button>
                <button onClick={expandAllGroups} className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-3 py-2 rounded text-sm border border-slate-300">Expandir Tudo</button>
                <button onClick={collapseAllGroups} className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-3 py-2 rounded text-sm border border-slate-300">Recolher Tudo</button>
            </div>
         </div>
         {showFilters && <div className="p-4 bg-slate-50 dark:bg-slate-700 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-fadeIn">
            <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Tipo</label>
                <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className="w-full p-2 rounded border dark:bg-slate-600 dark:text-white dark:border-slate-500"><option value="All">Todos</option><option value="Debit">Débito</option><option value="Credit">Crédito</option></select>
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Status Inversão</label>
                <select value={filterInversion} onChange={e => setFilterInversion(e.target.value as any)} className="w-full p-2 rounded border dark:bg-slate-600 dark:text-white dark:border-slate-500"><option value="all">Todos</option><option value="yes">Com Inversão (⚠️)</option><option value="no">Normal</option></select>
            </div>
            <div className="flex gap-2">
                <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 mb-1">Min</label>
                    <input type="number" value={filterMinVal} onChange={e => setFilterMinVal(e.target.value)} className="w-full p-2 rounded border dark:bg-slate-600 dark:text-white dark:border-slate-500" placeholder="0.00" />
                </div>
                <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 mb-1">Max</label>
                    <input type="number" value={filterMaxVal} onChange={e => setFilterMaxVal(e.target.value)} className="w-full p-2 rounded border dark:bg-slate-600 dark:text-white dark:border-slate-500" placeholder="Max" />
                </div>
            </div>
            <div className="flex flex-col justify-end">
                <label className="flex items-center space-x-2 text-sm dark:text-white cursor-pointer p-2 border rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors dark:border-slate-500">
                    <input type="checkbox" checked={filterHasCorrection} onChange={e => setFilterHasCorrection(e.target.checked)} className="form-checkbox w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600" /> 
                    <span>Com Correção IA</span>
                </label>
            </div>
            <div className="col-span-1 md:col-span-2 lg:col-span-4 mt-2">
                <input type="text" placeholder="Buscar conta ou código..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full p-2 rounded border dark:bg-slate-600 dark:text-white dark:border-slate-500 placeholder-slate-400" />
            </div>
         </div>}
         
         <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-100 dark:bg-slate-900 sticky top-0 z-20 shadow-md">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer bg-slate-100 dark:bg-slate-900" onClick={() => requestSort('account_code')}>Código</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer bg-slate-100 dark:bg-slate-900" onClick={() => requestSort('account_name')}>Conta</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase cursor-pointer bg-slate-100 dark:bg-slate-900" onClick={() => requestSort('initial_balance')}>Sdo. Anterior</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase cursor-pointer bg-slate-100 dark:bg-slate-900" onClick={() => requestSort('debit_value')}>Débito</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase cursor-pointer bg-slate-100 dark:bg-slate-900" onClick={() => requestSort('credit_value')}>Crédito</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase cursor-pointer bg-slate-100 dark:bg-slate-900" onClick={() => requestSort('final_balance')}>Sdo. Atual</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase bg-slate-100 dark:bg-slate-900">Inv.</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                  {paginatedAccounts.map((account) => (
                        <tr key={account.originalIndex} className={`hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${account.possible_inversion ? 'bg-amber-50 dark:bg-amber-900/20 border-l-[6px] border-amber-500' : 'border-l-[6px] border-transparent'} ${account.is_synthetic ? 'bg-slate-50 dark:bg-slate-700/50' : ''}`}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-blue-600 font-bold">
                             {account.account_code ? (
                                 account.is_synthetic ? 
                                 <span>{account.account_code}</span> :
                                 <a href={`https://www.google.com/search?q=${encodeURIComponent(account.account_code + ' ' + account.account_name + ' contabilidade')}`} target="_blank" rel="noreferrer" className="hover:underline hover:text-blue-800 dark:hover:text-blue-400">{account.account_code} ↗</a>
                             ) : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm dark:text-white relative">
                            <div className="flex items-center" style={{ paddingLeft: `${(account.level - 1) * 16}px` }}>
                                {account.is_synthetic && (
                                    <button 
                                        onClick={() => account.account_code && toggleGroup(account.account_code)}
                                        className="mr-2 w-4 h-4 flex items-center justify-center border rounded bg-slate-200 text-slate-700 text-xs"
                                    >
                                        {account.account_code && expandedGroups.has(account.account_code) ? '-' : '+'}
                                    </button>
                                )}
                                <span className={`${account.possible_inversion ? 'underline decoration-red-500 decoration-wavy decoration-2 underline-offset-4' : ''} ${account.is_synthetic ? 'font-bold text-slate-800 dark:text-white' : ''}`}>
                                    {showCorrectedNames ? getDisplayedName(account) : account.account_name}
                                </span>
                            </div>
                            
                            {!showCorrectedNames && getDisplayedName(account) !== account.account_name && !account.is_synthetic && (
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800 relative group cursor-help border border-green-200">
                                    📝 Sugestão
                                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-black text-white text-xs rounded p-2 hidden group-hover:block z-50 shadow-lg">
                                        <div className="font-bold border-b border-gray-600 mb-1 pb-1">Sugestão IA</div>
                                        <div><span className="text-gray-400">Original:</span> {account.account_name}</div>
                                        <div><span className="text-green-400">Sugestão:</span> {getDisplayedName(account)}</div>
                                    </div>
                                </span>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right text-sm text-slate-600 dark:text-slate-300 font-mono ${account.is_synthetic ? 'font-bold' : ''}`}>{formatCurrency(account.initial_balance)}</td>
                          <td className={`px-4 py-3 text-right text-sm text-blue-700 dark:text-blue-400 font-mono ${account.is_synthetic ? 'font-bold' : ''}`}>{account.debit_value > 0 ? formatCurrency(account.debit_value) : '-'}</td>
                          <td className={`px-4 py-3 text-right text-sm text-red-700 dark:text-red-400 font-mono ${account.is_synthetic ? 'font-bold' : ''}`}>{account.credit_value > 0 ? formatCurrency(account.credit_value) : '-'}</td>
                          <td className={`px-4 py-3 text-right text-sm text-slate-800 dark:text-white font-mono bg-slate-50/50 dark:bg-slate-800 ${account.is_synthetic ? 'font-bold' : 'font-bold'}`}>{formatCurrency(account.final_balance)}</td>
                          <td className="px-4 py-3 text-center">
                              {account.possible_inversion && !account.is_synthetic && (
                                  <div className="group relative inline-block cursor-help">
                                      <span className="text-amber-500 font-bold text-lg">⚠️</span>
                                      <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 shadow-xl rounded-lg p-4 text-left z-50 hidden group-hover:block">
                                          <div className="flex items-center gap-2 border-b border-amber-100 dark:border-amber-800 pb-2 mb-2">
                                              <span className="text-xl">🔄</span>
                                              <h4 className="font-bold text-amber-700 dark:text-amber-500 text-sm uppercase tracking-wide">Inversão de Natureza</h4>
                                          </div>
                                          
                                          <p className="text-xs text-slate-600 dark:text-slate-300 mb-3 leading-relaxed">
                                              Esta conta apresenta um saldo final contrário à sua natureza contábil padrão. Isso geralmente indica um erro de lançamento ou classificação.
                                          </p>
                                          
                                          <div className="space-y-3 mb-3">
                                              <div className="bg-red-50 dark:bg-red-900/20 p-2.5 rounded border border-red-100 dark:border-red-800/30">
                                                  <strong className="block text-xs text-red-700 dark:text-red-400 mb-1">⚠️ Ativo com Saldo Credor</strong>
                                                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                                      Ex: <strong>Caixa/Bancos</strong> negativo. 
                                                      <br/>Investigar: Pagamentos sem entrada de recursos ou saídas duplicadas.
                                                  </p>
                                              </div>
                                              <div className="bg-blue-50 dark:bg-blue-900/20 p-2.5 rounded border border-blue-100 dark:border-blue-800/30">
                                                  <strong className="block text-xs text-blue-700 dark:text-blue-400 mb-1">⚠️ Passivo com Saldo Devedor</strong>
                                                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                                      Ex: <strong>Fornecedores</strong> positivo.
                                                      <br/>Investigar: Pagamentos antecipados não baixados ou classificação em conta errada.
                                                  </p>
                                              </div>
                                          </div>
                                          
                                          <div className="pt-2 border-t border-slate-100 dark:border-slate-700 text-[10px] text-slate-400 italic flex gap-1">
                                              <span>💡</span>
                                              <span>Dica: Contas redutoras (ex: Depreciação) são exceções naturais.</span>
                                          </div>
                                      </div>
                                  </div>
                              )}
                          </td>
                        </tr>
                  ))}
            </tbody>
          </table>
         </div>
      </div>
    </div>
  );
};

export default AnalysisViewer;