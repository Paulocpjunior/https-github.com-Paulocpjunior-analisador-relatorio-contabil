import React, { useState, useMemo, useEffect } from 'react';
import { AnalysisResult, ExtractedAccount } from '../types';

interface Props {
  result: AnalysisResult;
}

type SortKey = keyof ExtractedAccount;

const AnalysisViewer: React.FC<Props> = ({ result }) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRowIds, setExpandedRowIds] = useState<Set<number>>(new Set());
  const [isTableLoading, setIsTableLoading] = useState(true);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  // Advanced Filters state
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<'All' | 'Debit' | 'Credit'>('All');
  const [filterMinVal, setFilterMinVal] = useState<string>('');
  const [filterMaxVal, setFilterMaxVal] = useState<string>('');
  const [filterInversion, setFilterInversion] = useState<'all' | 'yes' | 'no'>('all');
  const [showCorrectedNames, setShowCorrectedNames] = useState(false);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const { summary, accounts, spell_check } = result;

  // Simulate a brief loading state for smoother visual transition when mounting
  useEffect(() => {
    setIsTableLoading(true);
    const timer = setTimeout(() => setIsTableLoading(false), 600);
    return () => clearTimeout(timer);
  }, [result]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType, filterMinVal, filterMaxVal, filterInversion]);

  const filteredAndSortedAccounts = useMemo(() => {
    let processedAccounts = accounts.map((acc, index) => ({ ...acc, originalIndex: index }));

    // 1. Search Filter
    const searchLower = searchTerm.toLowerCase();
    if (searchLower) {
        processedAccounts = processedAccounts.filter(account =>
            account.account_name.toLowerCase().includes(searchLower) ||
            (account.account_code && account.account_code.toLowerCase().includes(searchLower))
        );
    }

    // 2. Advanced Filters
    if (filterType !== 'All') {
        processedAccounts = processedAccounts.filter(acc => acc.type === filterType);
    }

    if (filterMinVal) {
        const min = parseFloat(filterMinVal);
        if (!isNaN(min)) {
            processedAccounts = processedAccounts.filter(acc => Math.max(acc.debit_value, acc.credit_value) >= min);
        }
    }

    if (filterMaxVal) {
        const max = parseFloat(filterMaxVal);
        if (!isNaN(max)) {
             processedAccounts = processedAccounts.filter(acc => Math.max(acc.debit_value, acc.credit_value) <= max);
        }
    }

    if (filterInversion !== 'all') {
        processedAccounts = processedAccounts.filter(acc => 
            filterInversion === 'yes' ? acc.possible_inversion : !acc.possible_inversion
        );
    }

    // 3. Sorting
    if (sortConfig !== null) {
      processedAccounts.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (aValue === null) aValue = '';
        if (bValue === null) bValue = '';

        if (typeof aValue === 'boolean') {
            aValue = aValue ? 1 : 0;
            bValue = bValue ? 1 : 0;
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return processedAccounts;
  }, [accounts, sortConfig, searchTerm, filterType, filterMinVal, filterMaxVal, filterInversion]);

  // Pagination logic
  const totalPages = Math.ceil(filteredAndSortedAccounts.length / itemsPerPage);
  const paginatedAccounts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedAccounts.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredAndSortedAccounts, currentPage, itemsPerPage]);

  const requestSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const toggleRow = (originalIndex: number) => {
      const newSet = new Set(expandedRowIds);
      if (newSet.has(originalIndex)) {
          newSet.delete(originalIndex);
      } else {
          newSet.add(originalIndex);
      }
      setExpandedRowIds(newSet);
  };

  const getSortIndicator = (key: SortKey) => {
    if (!sortConfig || sortConfig.key !== key) {
      return <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 ml-1 inline-block opacity-30"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>;
    }
    return sortConfig.direction === 'asc'
      ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 ml-1 inline-block text-accent"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
      : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 ml-1 inline-block text-accent"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>;
  };

  const inversionCount = useMemo(() => accounts.filter(a => a.possible_inversion).length, [accounts]);

  // Graphics Data Preparation
  const topDebits = useMemo(() => {
    return [...accounts]
        .filter(a => a.type === 'Debit' && a.debit_value > 0)
        .sort((a, b) => b.debit_value - a.debit_value)
        .slice(0, 5);
  }, [accounts]);

  const topCredits = useMemo(() => {
      return [...accounts]
          .filter(a => a.type === 'Credit' && a.credit_value > 0)
          .sort((a, b) => b.credit_value - a.credit_value)
          .slice(0, 5);
  }, [accounts]);

  const maxDebitVal = useMemo(() => Math.max(...topDebits.map(a => a.debit_value), 1), [topDebits]);
  const maxCreditVal = useMemo(() => Math.max(...topCredits.map(a => a.credit_value), 1), [topCredits]);

  // Helper to get corrected name if toggle is on
  const getDisplayedName = (account: ExtractedAccount) => {
      if (!showCorrectedNames) return account.account_name;

      let correctedName = account.account_name;
      spell_check.forEach(sc => {
          if (sc.confidence !== 'Low') { // Only apply medium/high confidence automatically for view
              const escapedOriginal = sc.original_term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(escapedOriginal, 'gi');
              correctedName = correctedName.replace(regex, sc.suggested_correction);
          }
      });
      return correctedName;
  };

  return (
    <div className="space-y-8 animate-fadeIn relative">
      {/* Quick Navigation Bar */}
      <nav className="sticky top-20 z-30 bg-slate-100/80 backdrop-blur-md p-2 rounded-lg border border-slate-200 shadow-sm mb-6 flex flex-wrap gap-2">
        <a href="#summary" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 rounded-md hover:bg-white hover:text-accent transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
            <path fillRule="evenodd" d="M4.5 2A2.5 2.5 0 002 4.5v11A2.5 2.5 0 004.5 18h11a2.5 2.5 0 002.5-2.5v-11A2.5 2.5 0 0015.5 2h-11zm1 3.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM5.5 9a.5.5 0 000 1h9a.5.5 0 000-1h-9zm0 3.5a.5.5 0 000 1h5a.5.5 0 000-1h-5z" clipRule="evenodd" />
          </svg>
          Resumo
        </a>
        {(topDebits.length > 0 || topCredits.length > 0) && (
          <a href="#charts" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 rounded-md hover:bg-white hover:text-accent transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
              <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" />
            </svg>
            Gráficos
          </a>
        )}
        {spell_check.length > 0 && (
          <a href="#spell-check" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 rounded-md hover:bg-white hover:text-accent transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
              <path fillRule="evenodd" d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517V17.25a.75.75 0 001.075.676L10 15.082l5.925 2.844A.75.75 0 0017 17.25V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z" clipRule="evenodd" />
            </svg>
            Correções ({spell_check.length})
          </a>
        )}
        <a href="#accounts" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 rounded-md hover:bg-white hover:text-accent transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
            <path fillRule="evenodd" d="M1 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H2a1 1 0 01-1-1V4zm12 4a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V8zM1 14a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H2a1 1 0 01-1-1v-2zm12-4a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1v-2z" clipRule="evenodd" />
          </svg>
          Detalhamento
        </a>
      </nav>

      {/* Summary Section */}
      <div id="summary" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-28">
        <div className="bg-slate-800 px-6 py-4">
          <h3 className="text-xl font-semibold text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2 text-green-400">
               <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
            Resumo da Análise: {summary.document_type}
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-blue-600 font-medium mb-1">Total Débitos</p>
              <p className="text-2xl font-bold text-blue-900">{formatCurrency(summary.total_debits)}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg border border-red-100">
               <p className="text-sm text-red-600 font-medium mb-1">Total Créditos</p>
               <p className="text-2xl font-bold text-red-900">{formatCurrency(summary.total_credits)}</p>
            </div>
            <div className={`p-4 rounded-lg border ${summary.is_balanced ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
               <p className={`text-sm font-medium mb-1 ${summary.is_balanced ? 'text-green-600' : 'text-red-600'}`}>
                 Status do Balanço
               </p>
               <div className="flex items-center">
                 {summary.is_balanced ? (
                   <span className="flex items-center text-green-800 font-bold text-lg">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 mr-1">
                       <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                     </svg>
                     Balanceado
                   </span>
                 ) : (
                   <div>
                     <span className="flex items-center text-red-800 font-bold text-lg">
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 mr-1">
                         <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                       </svg>
                       Desbalanceado
                     </span>
                     <p className="text-sm text-red-600 mt-1">Diferença: {formatCurrency(summary.discrepancy_amount)}</p>
                   </div>
                 )}
               </div>
            </div>
          </div>

          {/* Inversion Warning Summary */}
          {inversionCount > 0 && (
             <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-yellow-600 mt-0.5">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800">Atenção: Possíveis Inversões de Natureza Identificadas</h3>
                  <p className="mt-1 text-sm text-yellow-700 max-w-2xl">
                    Detectamos {inversionCount} conta(s) com saldo contrário à sua natureza contábil padrão (ex: Ativo com saldo Credor). Verifique as linhas destacadas em <span className="font-semibold text-yellow-800 bg-yellow-100 px-1 rounded">amarelo</span> na tabela abaixo.
                  </p>
                </div>
              </div>
            </div>
          )}

          {summary.observations.length > 0 && (
            <div className="bg-slate-50 border-l-4 border-slate-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-500">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-slate-800">Outras Observações da IA</h3>
                  <div className="mt-2 text-sm text-slate-700">
                    <ul className="list-disc pl-5 space-y-1">
                      {summary.observations.map((obs, idx) => (
                        <li key={idx}>{obs}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Charts Section */}
      {(topDebits.length > 0 || topCredits.length > 0) && (
          <div id="charts" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-28">
              {/* Top Debits Chart */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center">
                      <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
                      Top 5 Contas Devedoras
                  </h3>
                  <div className="space-y-5">
                      {topDebits.map((acc, idx) => (
                          <div key={idx}>
                              <div className="flex justify-between text-sm mb-2">
                                  <span className="text-slate-700 truncate pr-4 font-medium" title={acc.account_name}>
                                      {acc.account_code ? `${acc.account_code} - ` : ''}{getDisplayedName(acc)}
                                  </span>
                                  <span className="text-blue-700 font-semibold whitespace-nowrap">{formatCurrency(acc.debit_value)}</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                                  <div
                                      className="bg-blue-500 h-3 rounded-full transition-all duration-1000 ease-out"
                                      style={{ width: `${(acc.debit_value / maxDebitVal) * 100}%` }}
                                  ></div>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>

              {/* Top Credits Chart */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center">
                      <span className="w-3 h-3 rounded-full bg-red-500 mr-2"></span>
                      Top 5 Contas Credoras
                  </h3>
                  <div className="space-y-5">
                      {topCredits.map((acc, idx) => (
                          <div key={idx}>
                              <div className="flex justify-between text-sm mb-2">
                                  <span className="text-slate-700 truncate pr-4 font-medium" title={acc.account_name}>
                                       {acc.account_code ? `${acc.account_code} - ` : ''}{getDisplayedName(acc)}
                                  </span>
                                  <span className="text-red-700 font-semibold whitespace-nowrap">{formatCurrency(acc.credit_value)}</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                                  <div
                                      className="bg-red-500 h-3 rounded-full transition-all duration-1000 ease-out"
                                      style={{ width: `${(acc.credit_value / maxCreditVal) * 100}%` }}
                                  ></div>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* Spell Check Section */}
      {spell_check.length > 0 && (
        <div id="spell-check" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-28">
           <div className="bg-orange-50 px-6 py-3 border-b border-orange-100">
            <h3 className="text-lg font-semibold text-orange-800 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              Sugestões de Correção Ortográfica
            </h3>
          </div>
          <div className="overflow-x-auto">
             <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Termo Original</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Sugestão</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Confiança</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {spell_check.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 line-through decoration-red-300">{item.original_term}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-medium">{item.suggested_correction}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                        ${item.confidence === 'High' ? 'bg-green-100 text-green-800' :
                          item.confidence === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-slate-100 text-slate-800'}`}>
                        {item.confidence === 'High' ? 'Alta' : item.confidence === 'Medium' ? 'Média' : 'Baixa'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Accounts Table Section */}
      <div id="accounts" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-28">
         <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 space-y-4">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <h3 className="text-lg font-semibold text-slate-700">Detalhamento de Contas Extraídas</h3>
                
                <div className="flex flex-wrap gap-3 items-center">
                    {/* Toggle Corrections */}
                    {spell_check.length > 0 && (
                        <label className="inline-flex items-center cursor-pointer mr-4">
                            <input type="checkbox" checked={showCorrectedNames} onChange={() => setShowCorrectedNames(!showCorrectedNames)} className="sr-only peer" />
                            <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                            <span className="ms-3 text-sm font-medium text-slate-700 select-none">Visualizar Correções</span>
                        </label>
                    )}

                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center px-3 py-2 text-sm font-medium rounded-md border transition-colors
                            ${showFilters ? 'bg-accent text-white border-accent' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                        </svg>
                        Filtros Avançados
                    </button>

                    {/* Search Input */}
                    <div className="relative flex-grow md:max-w-xs">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-400">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Filtrar por nome ou código..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-accent w-full"
                        />
                    </div>
                </div>
            </div>

             {/* Advanced Filters Panel */}
             {showFilters && (
                 <div className="bg-slate-100 p-4 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm animate-fadeIn">
                     <div>
                         <label className="block text-slate-600 font-medium mb-1">Tipo de Saldo</label>
                         <select
                             value={filterType}
                             onChange={(e) => setFilterType(e.target.value as any)}
                             className="w-full p-2 border border-slate-300 rounded-md focus:ring-accent focus:border-accent"
                         >
                             <option value="All">Todos</option>
                             <option value="Debit">Devedoras (Débito)</option>
                             <option value="Credit">Credoras (Crédito)</option>
                         </select>
                     </div>
                      <div>
                         <label className="block text-slate-600 font-medium mb-1">Status de Inversão</label>
                          <select
                             value={filterInversion}
                             onChange={(e) => setFilterInversion(e.target.value as any)}
                             className="w-full p-2 border border-slate-300 rounded-md focus:ring-accent focus:border-accent"
                         >
                             <option value="all">Todas as Contas</option>
                             <option value="yes">Com Inversão (Anomalia)</option>
                             <option value="no">Sem Inversão (Normais)</option>
                         </select>
                     </div>
                     <div>
                         <label className="block text-slate-600 font-medium mb-1">Valor Mínimo</label>
                         <input
                             type="number"
                             placeholder="ex: 1000"
                             value={filterMinVal}
                             onChange={(e) => setFilterMinVal(e.target.value)}
                             className="w-full p-2 border border-slate-300 rounded-md focus:ring-accent focus:border-accent"
                         />
                     </div>
                     <div>
                         <label className="block text-slate-600 font-medium mb-1">Valor Máximo</label>
                         <input
                             type="number"
                             placeholder="ex: 50000"
                             value={filterMaxVal}
                             onChange={(e) => setFilterMaxVal(e.target.value)}
                             className="w-full p-2 border border-slate-300 rounded-md focus:ring-accent focus:border-accent"
                         />
                     </div>
                 </div>
             )}
          </div>
        <div className="overflow-x-auto relative min-h-[300px]">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-100">
              <tr>
                <th scope="col" className="w-10 px-3 py-3"></th> {/* Expand chevron column */}
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-200 transition-colors select-none"
                  onClick={() => requestSort('account_code')}
                >
                  Código {getSortIndicator('account_code')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-200 transition-colors select-none"
                  onClick={() => requestSort('account_name')}
                >
                  Conta {getSortIndicator('account_name')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-200 transition-colors select-none"
                  onClick={() => requestSort('debit_value')}
                >
                  Débito {getSortIndicator('debit_value')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-200 transition-colors select-none"
                  onClick={() => requestSort('credit_value')}
                >
                  Crédito {getSortIndicator('credit_value')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-200 transition-colors select-none"
                  onClick={() => requestSort('type')}
                >
                  Tipo {getSortIndicator('type')}
                </th>
                <th
                   scope="col"
                   className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-200 transition-colors select-none"
                   onClick={() => requestSort('possible_inversion')}
                 >
                   <div className="group relative inline-flex justify-center">
                       <span className="cursor-help">⚠️</span>
                       {getSortIndicator('possible_inversion')}
                       {/* Custom Tooltip */}
                       <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 transition-opacity group-hover:opacity-100 z-50 mb-2 w-72">
                           <div className="bg-slate-800 text-white text-xs rounded py-2 px-3 shadow-lg">
                               <p className="font-bold text-yellow-400 mb-1">Inversão de Natureza Contábil</p>
                               <p className="mb-2">
                                   Indica que o saldo da conta (Devedor/Credor) é contrário à sua classificação padrão.
                               </p>
                               <ul className="list-disc pl-4 space-y-1 text-slate-300 mb-2">
                                   <li><strong>Ativo/Despesa:</strong> Espera-se saldo Devedor.</li>
                                   <li><strong>Passivo/Receita:</strong> Espera-se saldo Credor.</li>
                               </ul>
                               <p className="font-semibold text-yellow-300 border-t border-slate-600 pt-2 mt-2">
                                   Ação Recomendada:
                               </p>
                               <p className="text-slate-300">
                                   Verifique se é uma <strong>conta redutora</strong> legítima (ex: Depreciação Acumulada) ou se houve erro de lançamento.
                               </p>
                               <svg className="absolute text-slate-800 h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255" xmlSpace="preserve"><polygon className="fill-current" points="0,0 127.5,127.5 255,0"/></svg>
                           </div>
                       </div>
                   </div>
                 </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200 transition-opacity duration-300">
              {isTableLoading ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent mb-3"></div>
                      <p className="text-slate-500 text-sm font-medium animate-pulse">Preparando visualização dos dados...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedAccounts.length > 0 ? (
                  paginatedAccounts.map((account) => {
                    const isExpanded = expandedRowIds.has(account.originalIndex);
                    return (
                      <React.Fragment key={account.originalIndex}>
                        <tr 
                          onClick={() => toggleRow(account.originalIndex)}
                          className={`cursor-pointer transition-colors animate-fadeIn
                              ${account.possible_inversion ? 'bg-yellow-50 hover:bg-yellow-100 border-l-4 border-yellow-400' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                        >
                          <td className="px-3 py-4 text-slate-400">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                              </svg>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-500">
                             {account.account_code && !account.possible_inversion ? (
                                 <a 
                                    href={`https://www.google.com/search?q=${encodeURIComponent(account.account_name + ' Plano de Contas Brasileiro')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent hover:text-blue-800 hover:underline flex items-center"
                                    title="Consultar Classificação Padrão no Google"
                                    onClick={(e) => e.stopPropagation()}
                                 >
                                     {account.account_code}
                                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 ml-1 opacity-50">
                                       <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                                       <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
                                     </svg>
                                 </a>
                             ) : (
                                 account.account_code || '-'
                             )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 truncate max-w-xs" title={account.account_name}>
                            {getDisplayedName(account)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-700 font-medium font-mono tabular-nums tracking-tight">
                            {account.debit_value > 0 ? formatCurrency(account.debit_value) : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-700 font-medium font-mono tabular-nums tracking-tight">
                            {account.credit_value > 0 ? formatCurrency(account.credit_value) : '-'}
                          </td>
                           <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                                ${account.type === 'Debit' ? 'bg-blue-100 text-blue-800' :
                                  account.type === 'Credit' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'}`}>
                                {account.type === 'Debit' ? 'Devedora' : account.type === 'Credit' ? 'Credora' : '?'}
                              </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {account.possible_inversion && (
                                 <div className="group relative inline-block">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-yellow-500">
                                      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                    </svg>
                                 </div>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                            <tr className="bg-slate-50 border-b border-slate-200 shadow-inner animate-fadeIn">
                                <td colSpan={7} className="px-6 py-4">
                                    <div className="pl-8">
                                        <h4 className="text-sm font-bold text-slate-700 mb-2">Detalhes da Conta</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                            <div>
                                                <p><span className="font-medium text-slate-600">Nome Original Lido:</span> {account.account_name}</p>
                                                {showCorrectedNames && account.account_name !== getDisplayedName(account) && (
                                                    <p className="mt-1 text-green-700"><span className="font-medium text-slate-600">Nome Corrigido:</span> {getDisplayedName(account)}</p>
                                                )}
                                                <p className="mt-1"><span className="font-medium text-slate-600">Saldo Total Lido:</span> {formatCurrency(account.total_value)}</p>
                                            </div>
                                            <div>
                                                 {account.possible_inversion ? (
                                                     <div className="bg-yellow-100 p-3 rounded-md border border-yellow-200 text-yellow-800">
                                                         <p className="font-semibold flex items-center">
                                                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-1">
                                                               <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                                             </svg>
                                                             Inversão de Natureza Detectada
                                                         </p>
                                                         <p className="mt-1">
                                                             Esta conta foi identificada como <span className="font-bold">{account.type === 'Debit' ? 'DEVEDORA' : 'CREDORA'}</span>,
                                                             mas sua classificação padrão sugere o oposto. Verifique se é uma conta redutora legítima ou um erro de lançamento.
                                                         </p>
                                                     </div>
                                                 ) : (
                                                     <p className="text-slate-500 italic">Nenhuma anomalia de natureza detectada para esta conta.</p>
                                                 )}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        )}
                      </React.Fragment>
                    );
                  })
              ) : (
                  <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-500 italic">
                          Nenhuma conta encontrada para os filtros atuais.
                      </td>
                  </tr>
              )}
            </tbody>
            {filteredAndSortedAccounts.length > 0 && !isTableLoading && (
              <tfoot className="bg-white border-t border-slate-200">
                 <tr>
                   <td colSpan={7} className="px-6 py-3">
                     <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-700">
                           Mostrando <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> até <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredAndSortedAccounts.length)}</span> de <span className="font-medium">{filteredAndSortedAccounts.length}</span> resultados
                        </div>
                        <div className="flex space-x-2">
                           <button
                             onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                             disabled={currentPage === 1}
                             className="px-3 py-1 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                           >
                             Anterior
                           </button>
                           <span className="px-3 py-1 text-sm text-slate-700 font-medium flex items-center">
                               Página {currentPage} de {totalPages}
                           </span>
                           <button
                             onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                             disabled={currentPage === totalPages}
                             className="px-3 py-1 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                           >
                             Próximo
                           </button>
                        </div>
                     </div>
                   </td>
                 </tr>
              </tfoot>
            )}
          </table>
        </div>
         {/* General Document Totals */}
         <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end space-x-8 text-sm font-medium text-slate-700">
             <span>TOTAL DÉBITOS: <span className="text-blue-700 ml-2 font-bold">{formatCurrency(summary.total_debits)}</span></span>
             <span>TOTAL CRÉDITOS: <span className="text-red-700 ml-2 font-bold">{formatCurrency(summary.total_credits)}</span></span>
         </div>
      </div>
    </div>
  );
};

export default AnalysisViewer;