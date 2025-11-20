import React, { useState, useMemo, useEffect } from 'react';
import { AnalysisResult, ExtractedAccount } from '../types';
import { generateFinancialInsight, generateCMVAnalysis } from '../services/geminiService';
import jsPDF from 'jspdf';

interface Props {
  result: AnalysisResult;
}

type SortKey = keyof ExtractedAccount;

const DEFAULT_EBITDA_MULTIPLE_KEY = 'auditAI_default_ebitda_multiple';

const AnalysisViewer: React.FC<Props> = ({ result }) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRowIds, setExpandedRowIds] = useState<Set<number>>(new Set());
  const [isTableLoading, setIsTableLoading] = useState(true);
  
  // IFRS 18 Expansion State
  const [expandedIFRSCategories, setExpandedIFRSCategories] = useState<{
      Operacional: boolean;
      Investimento: boolean;
      Financiamento: boolean;
  }>({
      Operacional: true,
      Investimento: false,
      Financiamento: false
  });

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

  // Financial Insight State
  const [insightPrompt, setInsightPrompt] = useState('Calcular EBITDA e estimar Valuation da empresa.');
  const [valuationMultiple, setValuationMultiple] = useState(() => {
    try {
      const saved = localStorage.getItem(DEFAULT_EBITDA_MULTIPLE_KEY);
      return saved ? parseFloat(saved) : 5;
    } catch {
      return 5;
    }
  });
  const [insightResult, setInsightResult] = useState<string>('');
  const [isInsightLoading, setIsInsightLoading] = useState(false);

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

  // IFRS 18 Grouping Logic
  const ifrsData = useMemo(() => {
      if (summary.document_type !== 'DRE') return null;

      const groups = {
          Operacional: accounts.filter(a => a.ifrs18_category === 'Operacional'),
          Investimento: accounts.filter(a => a.ifrs18_category === 'Investimento'),
          Financiamento: accounts.filter(a => a.ifrs18_category === 'Financiamento')
      };

      const calcNet = (accs: ExtractedAccount[]) => {
          const credits = accs.reduce((sum, a) => sum + (a.type === 'Credit' ? a.total_value : 0), 0);
          const debits = accs.reduce((sum, a) => sum + (a.type === 'Debit' ? a.total_value : 0), 0);
          return credits - debits;
      };

      return {
          groups,
          totals: {
              Operacional: calcNet(groups.Operacional),
              Investimento: calcNet(groups.Investimento),
              Financiamento: calcNet(groups.Financiamento)
          }
      };
  }, [accounts, summary.document_type]);

  const toggleIFRSCategory = (category: keyof typeof expandedIFRSCategories) => {
      setExpandedIFRSCategories(prev => ({
          ...prev,
          [category]: !prev[category]
      }));
  };

  const handleExpandAllIFRS = () => {
      setExpandedIFRSCategories({
          Operacional: true,
          Investimento: true,
          Financiamento: true
      });
  };

  const handleCollapseAllIFRS = () => {
      setExpandedIFRSCategories({
          Operacional: false,
          Investimento: false,
          Financiamento: false
      });
  };

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

  const handleExportSummaryTxt = () => {
    const balanceStatus = summary.is_balanced ? "BALANCEADO" : "DESBALANCEADO";
    let textContent = `RESUMO DA ANÁLISE: ${summary.document_type.toUpperCase()}\n`;
    textContent += `----------------------------------------\n`;
    textContent += `Total Débitos:  ${formatCurrency(summary.total_debits)}\n`;
    textContent += `Total Créditos: ${formatCurrency(summary.total_credits)}\n`;
    textContent += `Status:         ${balanceStatus}\n`;
    
    if (!summary.is_balanced) {
      textContent += `Diferença:      ${formatCurrency(summary.discrepancy_amount)}\n`;
    }
    
    if (summary.observations.length > 0) {
      textContent += `\nOBSERVAÇÕES DA IA:\n`;
      summary.observations.forEach(obs => {
        textContent += `- ${obs}\n`;
      });
    }

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Resumo_Analise_${summary.document_type.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleMultipleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    setValuationMultiple(newValue);
    localStorage.setItem(DEFAULT_EBITDA_MULTIPLE_KEY, newValue.toString());
  };

  const handleGenerateInsight = async () => {
    if (!insightPrompt.trim()) return;
    
    setIsInsightLoading(true);
    try {
      const resultText = await generateFinancialInsight(result, insightPrompt, valuationMultiple);
      setInsightResult(resultText);
    } catch (error) {
      setInsightResult("Erro ao gerar análise financeira. Tente novamente.");
    } finally {
      setIsInsightLoading(false);
    }
  };

  const handleAnalyzeCMV = async () => {
      setIsInsightLoading(true);
      setInsightResult("Processando análise de CMV e legislação vigente com Gemini 3...");
      try {
          const resultText = await generateCMVAnalysis(result);
          setInsightResult(resultText);
      } catch (error) {
          setInsightResult("Erro ao gerar análise de CMV. Tente novamente.");
      } finally {
          setIsInsightLoading(false);
      }
  };

  const handleExportInsightPDF = () => {
    if (!insightResult) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text("Relatório Financeiro Especializado", 14, 20);
    
    // Parameters
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text(`Documento Base: ${summary.document_type}`, 14, 40);
    doc.text(`Data da Análise: ${new Date().toLocaleDateString('pt-BR')}`, 14, 48);
    
    // Content
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 62, pageWidth - 14, 62);
    
    doc.setFontSize(10);
    const splitText = doc.splitTextToSize(insightResult.replace(/\*\*/g, '').replace(/#/g, ''), pageWidth - 28);
    doc.text(splitText, 14, 70);

    doc.save(`AuditAI_Analise_Financeira.pdf`);
  };

  return (
    <div className="space-y-8 animate-fadeIn relative">
      {/* Quick Navigation Bar */}
      <nav className="sticky top-20 z-30 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-md p-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm mb-6 flex flex-wrap gap-2">
        <a href="#summary" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:text-accent transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
            <path fillRule="evenodd" d="M4.5 2A2.5 2.5 0 002 4.5v11A2.5 2.5 0 004.5 18h11a2.5 2.5 0 002.5-2.5v-11A2.5 2.5 0 0015.5 2h-11zm1 3.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM5.5 9a.5.5 0 000 1h9a.5.5 0 000-1h-9zm0 3.5a.5.5 0 000 1h5a.5.5 0 000-1h-5z" clipRule="evenodd" />
          </svg>
          Resumo
        </a>
         {summary.document_type === 'DRE' && (
           <a href="#ifrs18" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:text-accent transition-all">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
                <path d="M10 1a9 9 0 100 18 9 9 0 000-18zM8 6a1 1 0 112 0v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H5a1 1 0 110-2h3V6z" />
             </svg>
             IFRS 18
           </a>
         )}
         <a href="#valuation" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:text-accent transition-all">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
             <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM6 8a2 2 0 11-4 0 2 2 0 014 0zM1.49 15.326a.78.78 0 01-.358-.442 3 3 0 014.308-3.516 6.484 6.484 0 00-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 01-2.07-.655zM16.44 15.98a4.97 4.97 0 002.07-.654.78.78 0 00.358-.442 3 3 0 00-4.308-3.517 6.484 6.484 0 011.905 3.959c.023.222.014.442-.025.654zM9 12a6.96 6.96 0 00-5.293 2.454A4.96 4.96 0 016 16h8a4.96 4.96 0 012.293-1.546A6.963 6.963 0 009 12z" />
           </svg>
           Valuation & IA
         </a>
        {(topDebits.length > 0 || topCredits.length > 0) && (
          <a href="#charts" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:text-accent transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
              <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" />
            </svg>
            Gráficos
          </a>
        )}
        {spell_check.length > 0 && (
          <a href="#spell-check" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:text-accent transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
              <path fillRule="evenodd" d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517V17.25a.75.75 0 001.075.676L10 15.082l5.925 2.844A.75.75 0 0017 17.25V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z" clipRule="evenodd" />
            </svg>
            Correções ({spell_check.length})
          </a>
        )}
        <a href="#accounts" className="flex items-center px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:text-accent transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2">
            <path fillRule="evenodd" d="M1 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H2a1 1 0 01-1-1V4zm12 4a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V8zM1 14a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H2a1 1 0 01-1-1v-2zm12-4a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1v-2z" clipRule="evenodd" />
          </svg>
          Detalhamento
        </a>
      </nav>

      {/* Summary Section */}
      <div id="summary" className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden scroll-mt-28 transition-colors">
        <div className="bg-slate-800 dark:bg-slate-900 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h3 className="text-xl font-semibold text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2 text-green-400">
               <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
            Resumo da Análise: {summary.document_type}
          </h3>
          <button 
            onClick={handleExportSummaryTxt}
            className="text-xs md:text-sm bg-slate-700 hover:bg-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 text-white py-2 px-3 rounded-md transition-colors flex items-center border border-slate-600 dark:border-slate-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Exportar Resumo (TXT)
          </button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800/50">
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">Total Débitos</p>
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(summary.total_debits)}</p>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800/50">
               <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">Total Créditos</p>
               <p className="text-2xl font-bold text-red-900 dark:text-red-100">{formatCurrency(summary.total_credits)}</p>
            </div>
            <div className={`p-4 rounded-lg border ${summary.is_balanced ? 'bg-green-50 border-green-100 dark:bg-green-900/20 dark:border-green-800/50' : 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-800/50'}`}>
               <p className={`text-sm font-medium mb-1 ${summary.is_balanced ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                 Status do Balanço
               </p>
               <div className="flex items-center">
                 {summary.is_balanced ? (
                   <span className="flex items-center text-green-800 dark:text-green-200 font-bold text-lg">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 mr-1">
                       <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                     </svg>
                     Balanceado
                   </span>
                 ) : (
                   <div>
                     <span className="flex items-center text-red-800 dark:text-red-200 font-bold text-lg">
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 mr-1">
                         <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                       </svg>
                       Desbalanceado
                     </span>
                     <p className="text-sm text-red-600 dark:text-red-300 mt-1">Diferença: {formatCurrency(summary.discrepancy_amount)}</p>
                   </div>
                 )}
               </div>
            </div>
          </div>

          {/* Inversion Warning Summary */}
          {inversionCount > 0 && (
             <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 dark:border-yellow-600 p-4 mb-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-yellow-600 dark:text-yellow-500 mt-0.5">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Atenção: Possíveis Inversões de Natureza Identificadas</h3>
                  <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300 max-w-2xl">
                    Detectamos {inversionCount} conta(s) com saldo contrário à sua natureza contábil padrão (ex: Ativo com saldo Credor). Verifique as linhas destacadas em <span className="font-semibold text-yellow-800 bg-yellow-100 dark:bg-yellow-800/50 dark:text-yellow-100 px-1 rounded">amarelo</span> na tabela abaixo.
                  </p>
                </div>
              </div>
            </div>
          )}

          {summary.observations.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-700/50 border-l-4 border-slate-400 dark:border-slate-500 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-500 dark:text-slate-400">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">Outras Observações da IA</h3>
                  <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
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

      {/* IFRS 18 Analysis Section (Only for DRE) */}
      {ifrsData && (
          <div id="ifrs18" className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden scroll-mt-28 transition-colors">
              <div className="bg-teal-900 dark:bg-teal-950 px-6 py-4 border-b border-teal-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2 text-teal-200">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                        </svg>
                        Classificação IFRS 18 (DRE)
                    </h3>
                    <p className="text-teal-100 text-sm mt-1 opacity-90">
                        Detalhamento das contas conforme as categorias Operacional, Investimento e Financiamento.
                    </p>
                  </div>
                  <div className="flex space-x-2">
                      <button 
                          onClick={handleExpandAllIFRS}
                          className="bg-teal-800 hover:bg-teal-700 text-white text-xs font-medium py-1.5 px-3 rounded border border-teal-600 transition-colors flex items-center"
                      >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3 mr-1">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                          </svg>
                          Expandir Tudo
                      </button>
                      <button 
                          onClick={handleCollapseAllIFRS}
                          className="bg-teal-800 hover:bg-teal-700 text-white text-xs font-medium py-1.5 px-3 rounded border border-teal-600 transition-colors flex items-center"
                      >
                           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3 mr-1">
                             <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                           </svg>
                          Recolher Tudo
                      </button>
                  </div>
              </div>
              
              <div className="p-6 space-y-4">
                  {/* Operacional */}
                  <div className="border dark:border-slate-600 rounded-lg overflow-hidden shadow-sm">
                      <button 
                          onClick={() => toggleIFRSCategory('Operacional')}
                          className="w-full flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                          <div className="flex items-center">
                             <span className={`mr-3 transform transition-transform duration-200 text-slate-500 dark:text-slate-300 ${expandedIFRSCategories.Operacional ? 'rotate-90' : ''}`}>▶</span>
                             <span className="font-bold text-slate-800 dark:text-slate-100">Operacional</span>
                             <span className="ml-2 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded-full">
                                 {ifrsData.groups.Operacional.length} contas
                             </span>
                          </div>
                          <span className={`font-bold ${ifrsData.totals.Operacional >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-red-700 dark:text-red-300'}`}>
                              {formatCurrency(ifrsData.totals.Operacional)}
                          </span>
                      </button>
                      {expandedIFRSCategories.Operacional && (
                          <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-600 animate-fadeIn">
                              {ifrsData.groups.Operacional.length > 0 ? (
                                  <table className="min-w-full text-sm">
                                      <tbody>
                                          {ifrsData.groups.Operacional.map((acc, idx) => (
                                              <tr key={idx} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700">
                                                  <td className="py-2 px-2 text-slate-600 dark:text-slate-300">{acc.account_name}</td>
                                                  <td className="py-2 px-2 text-right font-mono text-slate-800 dark:text-slate-200">
                                                      {formatCurrency(acc.type === 'Credit' ? acc.total_value : -acc.total_value)}
                                                  </td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              ) : <p className="text-sm text-slate-500 italic">Nenhuma conta classificada.</p>}
                          </div>
                      )}
                  </div>

                  {/* Investimento */}
                  <div className="border dark:border-slate-600 rounded-lg overflow-hidden shadow-sm">
                      <button 
                          onClick={() => toggleIFRSCategory('Investimento')}
                          className="w-full flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                           <div className="flex items-center">
                             <span className={`mr-3 transform transition-transform duration-200 text-slate-500 dark:text-slate-300 ${expandedIFRSCategories.Investimento ? 'rotate-90' : ''}`}>▶</span>
                             <span className="font-bold text-slate-800 dark:text-slate-100">Investimento</span>
                             <span className="ml-2 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-2 py-0.5 rounded-full">
                                 {ifrsData.groups.Investimento.length} contas
                             </span>
                          </div>
                          <span className={`font-bold ${ifrsData.totals.Investimento >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-red-700 dark:text-red-300'}`}>
                              {formatCurrency(ifrsData.totals.Investimento)}
                          </span>
                      </button>
                      {expandedIFRSCategories.Investimento && (
                          <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-600 animate-fadeIn">
                               {ifrsData.groups.Investimento.length > 0 ? (
                                  <table className="min-w-full text-sm">
                                      <tbody>
                                          {ifrsData.groups.Investimento.map((acc, idx) => (
                                              <tr key={idx} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700">
                                                  <td className="py-2 px-2 text-slate-600 dark:text-slate-300">{acc.account_name}</td>
                                                  <td className="py-2 px-2 text-right font-mono text-slate-800 dark:text-slate-200">
                                                      {formatCurrency(acc.type === 'Credit' ? acc.total_value : -acc.total_value)}
                                                  </td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              ) : <p className="text-sm text-slate-500 italic">Nenhuma conta classificada.</p>}
                          </div>
                      )}
                  </div>

                  {/* Financiamento */}
                  <div className="border dark:border-slate-600 rounded-lg overflow-hidden shadow-sm">
                      <button 
                          onClick={() => toggleIFRSCategory('Financiamento')}
                          className="w-full flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                           <div className="flex items-center">
                             <span className={`mr-3 transform transition-transform duration-200 text-slate-500 dark:text-slate-300 ${expandedIFRSCategories.Financiamento ? 'rotate-90' : ''}`}>▶</span>
                             <span className="font-bold text-slate-800 dark:text-slate-100">Financiamento</span>
                             <span className="ml-2 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 px-2 py-0.5 rounded-full">
                                 {ifrsData.groups.Financiamento.length} contas
                             </span>
                          </div>
                          <span className={`font-bold ${ifrsData.totals.Financiamento >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-red-700 dark:text-red-300'}`}>
                              {formatCurrency(ifrsData.totals.Financiamento)}
                          </span>
                      </button>
                      {expandedIFRSCategories.Financiamento && (
                          <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-600 animate-fadeIn">
                               {ifrsData.groups.Financiamento.length > 0 ? (
                                  <table className="min-w-full text-sm">
                                      <tbody>
                                          {ifrsData.groups.Financiamento.map((acc, idx) => (
                                              <tr key={idx} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700">
                                                  <td className="py-2 px-2 text-slate-600 dark:text-slate-300">{acc.account_name}</td>
                                                  <td className="py-2 px-2 text-right font-mono text-slate-800 dark:text-slate-200">
                                                      {formatCurrency(acc.type === 'Credit' ? acc.total_value : -acc.total_value)}
                                                  </td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              ) : <p className="text-sm text-slate-500 italic">Nenhuma conta classificada.</p>}
                          </div>
                      )}
                  </div>
                  
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 italic text-right">
                      * Classificação sugerida pela IA baseada nas descrições das contas.
                  </div>
              </div>
          </div>
      )}

      {/* Valuation & Financial Insight Section */}
      <div id="valuation" className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden scroll-mt-28 transition-colors">
        <div className="bg-gradient-to-r from-blue-900 to-blue-800 dark:from-blue-950 dark:to-blue-900 px-6 py-4 border-b border-blue-700">
          <h3 className="text-xl font-semibold text-white flex items-center">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2 text-blue-200">
               <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
             </svg>
             Ferramentas Financeiras & Valuation (IA)
          </h3>
        </div>
        <div className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Múltiplo de EBITDA (Valuation)</label>
                        <div className="flex items-center space-x-4">
                            <input 
                                type="range" 
                                min="1" 
                                max="10" 
                                step="0.5" 
                                value={valuationMultiple} 
                                onChange={handleMultipleChange}
                                className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                            <span className="text-xl font-bold text-blue-800 dark:text-blue-300 w-16 text-right">{valuationMultiple}x</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Selecione o múltiplo para projetar o valor da empresa.</p>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Cálculo de EBITDA e Valuation (IA)</label>
                        <textarea 
                            value={insightPrompt}
                            onChange={(e) => setInsightPrompt(e.target.value)}
                            rows={4}
                            className="w-full p-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            placeholder="Ex: Calcular EBITDA e Valuation. Analisar margem de lucro."
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">A IA identificará automaticamente Juros, Impostos, Depreciação e Amortização.</p>
                    </div>

                    <div className="space-y-2">
                      <button
                          onClick={handleGenerateInsight}
                          disabled={isInsightLoading}
                          className={`w-full py-3 px-4 rounded-lg font-bold text-white flex items-center justify-center transition-all
                              ${isInsightLoading ? 'bg-slate-400 dark:bg-slate-600 cursor-wait' : 'bg-accent hover:bg-blue-700 shadow-md'}`}
                      >
                          {isInsightLoading && insightResult.includes("Valuation") ? (
                              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                          ) : null}
                          Gerar Análise com IA
                      </button>

                      <button
                          onClick={handleAnalyzeCMV}
                          disabled={isInsightLoading}
                          className={`w-full py-3 px-4 rounded-lg font-bold text-white flex items-center justify-center transition-all
                              ${isInsightLoading ? 'bg-slate-400 dark:bg-slate-600 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700 shadow-md'}`}
                      >
                          {isInsightLoading && insightResult.includes("CMV") ? (
                              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                          )}
                          Análise de CMV (Lei Vigente)
                      </button>
                    </div>
                </div>

                <div className="lg:col-span-2">
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600 h-full flex flex-col">
                        <div className="p-3 border-b border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 flex justify-between items-center">
                            <span className="font-semibold text-slate-600 dark:text-slate-300 text-sm">Resultado da Análise</span>
                             {insightResult && (
                                 <button 
                                     onClick={handleExportInsightPDF}
                                     className="text-xs bg-red-600 hover:bg-red-700 text-white py-1 px-2 rounded transition-colors flex items-center"
                                 >
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3 mr-1">
                                         <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                     </svg>
                                     Exportar PDF
                                 </button>
                             )}
                        </div>
                        <div className="p-4 flex-grow overflow-y-auto max-h-[400px] text-slate-800 dark:text-slate-200 text-sm leading-relaxed whitespace-pre-line">
                            {insightResult ? (
                                insightResult
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 italic">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-2 opacity-50">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                                    </svg>
                                    <p className="text-center px-4">Selecione o múltiplo e clique em "Gerar Análise" ou utilize a "Análise de CMV" para auditoria específica.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Charts Section */}
      {(topDebits.length > 0 || topCredits.length > 0) && (
          <div id="charts" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-28">
              {/* Top Debits Chart */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 transition-colors">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-6 flex items-center">
                      <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
                      Top 5 Contas Devedoras
                  </h3>
                  <div className="space-y-5">
                      {topDebits.map((acc, idx) => (
                          <div key={idx}>
                              <div className="flex justify-between text-sm mb-2">
                                  <span className="text-slate-700 dark:text-slate-300 truncate pr-4 font-medium" title={acc.account_name}>
                                      {acc.account_code ? `${acc.account_code} - ` : ''}{getDisplayedName(acc)}
                                  </span>
                                  <span className="text-blue-700 dark:text-blue-400 font-semibold whitespace-nowrap">{formatCurrency(acc.debit_value)}</span>
                              </div>
                              <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
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
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 transition-colors">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-6 flex items-center">
                      <span className="w-3 h-3 rounded-full bg-red-500 mr-2"></span>
                      Top 5 Contas Credoras
                  </h3>
                  <div className="space-y-5">
                      {topCredits.map((acc, idx) => (
                          <div key={idx}>
                              <div className="flex justify-between text-sm mb-2">
                                  <span className="text-slate-700 dark:text-slate-300 truncate pr-4 font-medium" title={acc.account_name}>
                                       {acc.account_code ? `${acc.account_code} - ` : ''}{getDisplayedName(acc)}
                                  </span>
                                  <span className="text-red-700 dark:text-red-400 font-semibold whitespace-nowrap">{formatCurrency(acc.credit_value)}</span>
                              </div>
                              <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
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
        <div id="spell-check" className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden scroll-mt-28 transition-colors">
           <div className="bg-orange-50 dark:bg-orange-900/20 px-6 py-3 border-b border-orange-100 dark:border-orange-800/50">
            <h3 className="text-lg font-semibold text-orange-800 dark:text-orange-200 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              Sugestões de Correção Ortográfica
            </h3>
          </div>
          <div className="overflow-x-auto">
             <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-700">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Termo Original</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Sugestão</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Confiança</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                {spell_check.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 dark:text-red-400 line-through decoration-red-300">{item.original_term}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 dark:text-green-400 font-medium">{item.suggested_correction}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                        ${item.confidence === 'High' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                          item.confidence === 'Medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                          'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300'}`}>
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
      <div id="accounts" className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden scroll-mt-28 transition-colors">
         <div className="bg-slate-50 dark:bg-slate-700/50 px-6 py-4 border-b border-slate-200 dark:border-slate-700 space-y-4">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Detalhamento de Contas Extraídas</h3>
                
                <div className="flex flex-wrap gap-3 items-center">
                    {/* Toggle Corrections */}
                    {spell_check.length > 0 && (
                        <label className="inline-flex items-center cursor-pointer mr-4">
                            <input type="checkbox" checked={showCorrectedNames} onChange={() => setShowCorrectedNames(!showCorrectedNames)} className="sr-only peer" />
                            <div className="relative w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                            <span className="ms-3 text-sm font-medium text-slate-700 dark:text-slate-300 select-none">Visualizar Correções</span>
                        </label>
                    )}

                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center px-3 py-2 text-sm font-medium rounded-md border transition-colors
                            ${showFilters ? 'bg-accent text-white border-accent' : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'}`}
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
                            className="pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-accent w-full"
                        />
                    </div>
                </div>
            </div>

             {/* Advanced Filters Panel */}
             {showFilters && (
                 <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg border border-slate-200 dark:border-slate-600 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm animate-fadeIn transition-colors">
                     <div>
                         <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">Tipo de Saldo</label>
                         <select
                             value={filterType}
                             onChange={(e) => setFilterType(e.target.value as any)}
                             className="w-full p-2 border border-slate-300 dark:border-slate-500 dark:bg-slate-600 dark:text-white rounded-md focus:ring-accent focus:border-accent"
                         >
                             <option value="All">Todos</option>
                             <option value="Debit">Devedoras (Débito)</option>
                             <option value="Credit">Credoras (Crédito)</option>
                         </select>
                     </div>
                      <div>
                         <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">Status de Inversão</label>
                          <select
                             value={filterInversion}
                             onChange={(e) => setFilterInversion(e.target.value as any)}
                             className="w-full p-2 border border-slate-300 dark:border-slate-500 dark:bg-slate-600 dark:text-white rounded-md focus:ring-accent focus:border-accent"
                         >
                             <option value="all">Todas as Contas</option>
                             <option value="yes">Com Inversão (Anomalia)</option>
                             <option value="no">Sem Inversão (Normais)</option>
                         </select>
                     </div>
                     <div>
                         <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">Valor Mínimo</label>
                         <input
                             type="number"
                             placeholder="ex: 1000"
                             value={filterMinVal}
                             onChange={(e) => setFilterMinVal(e.target.value)}
                             className="w-full p-2 border border-slate-300 dark:border-slate-500 dark:bg-slate-600 dark:text-white rounded-md focus:ring-accent focus:border-accent"
                         />
                     </div>
                     <div>
                         <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">Valor Máximo</label>
                         <input
                             type="number"
                             placeholder="ex: 50000"
                             value={filterMaxVal}
                             onChange={(e) => setFilterMaxVal(e.target.value)}
                             className="w-full p-2 border border-slate-300 dark:border-slate-500 dark:bg-slate-600 dark:text-white rounded-md focus:ring-accent focus:border-accent"
                         />
                     </div>
                 </div>
             )}
          </div>
        <div className="overflow-x-auto relative min-h-[300px]">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-100 dark:bg-slate-700">
              <tr>
                <th scope="col" className="w-10 px-3 py-3"></th> {/* Expand chevron column */}
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors select-none"
                  onClick={() => requestSort('account_code')}
                >
                  Código {getSortIndicator('account_code')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors select-none"
                  onClick={() => requestSort('account_name')}
                >
                  Conta {getSortIndicator('account_name')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors select-none"
                  onClick={() => requestSort('debit_value')}
                >
                  Débito {getSortIndicator('debit_value')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors select-none"
                  onClick={() => requestSort('credit_value')}
                >
                  Crédito {getSortIndicator('credit_value')}
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors select-none"
                  onClick={() => requestSort('type')}
                >
                  Tipo {getSortIndicator('type')}
                </th>
                <th
                   scope="col"
                   className="px-6 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors select-none"
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
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700 transition-opacity duration-300">
              {isTableLoading ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent mb-3"></div>
                      <p className="text-slate-500 dark:text-slate-400 text-sm font-medium animate-pulse">Preparando visualização dos dados...</p>
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
                              ${account.possible_inversion 
                                ? 'bg-yellow-50 dark:bg-yellow-900/10 hover:bg-yellow-100 dark:hover:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-600' 
                                : 'hover:bg-slate-50 dark:hover:bg-slate-700 border-l-4 border-transparent'}`}
                        >
                          <td className="px-3 py-4 text-slate-400">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                              </svg>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-500 dark:text-slate-400">
                             {account.account_code && !account.possible_inversion ? (
                                 <a 
                                    href={`https://www.google.com/search?q=${encodeURIComponent(account.account_name + ' Plano de Contas Brasileiro')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent hover:text-blue-800 dark:hover:text-blue-300 hover:underline flex items-center"
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
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white truncate max-w-xs" title={account.account_name}>
                            {getDisplayedName(account)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-700 dark:text-blue-400 font-medium font-mono tabular-nums tracking-tight">
                            {account.debit_value > 0 ? formatCurrency(account.debit_value) : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-700 dark:text-red-400 font-medium font-mono tabular-nums tracking-tight">
                            {account.credit_value > 0 ? formatCurrency(account.credit_value) : '-'}
                          </td>
                           <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                                ${account.type === 'Debit' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                                  account.type === 'Credit' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                                  'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300'}`}>
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
                            <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 shadow-inner animate-fadeIn">
                                <td colSpan={7} className="px-6 py-4">
                                    <div className="pl-8">
                                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Detalhes da Conta</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                            <div className="text-slate-600 dark:text-slate-300">
                                                <p><span className="font-medium">Nome Original Lido:</span> {account.account_name}</p>
                                                {showCorrectedNames && account.account_name !== getDisplayedName(account) && (
                                                    <p className="mt-1 text-green-700 dark:text-green-400"><span className="font-medium">Nome Corrigido:</span> {getDisplayedName(account)}</p>
                                                )}
                                                <p className="mt-1"><span className="font-medium">Saldo Total Lido:</span> {formatCurrency(account.total_value)}</p>
                                            </div>
                                            <div>
                                                 {account.possible_inversion ? (
                                                     <div className="bg-yellow-100 dark:bg-yellow-900/30 p-3 rounded-md border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200">
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
                                                     <p className="text-slate-500 dark:text-slate-400 italic">Nenhuma anomalia de natureza detectada para esta conta.</p>
                                                 )}
                                                 {/* Show category if exists */}
                                                 {account.ifrs18_category && (
                                                     <div className="mt-2">
                                                         <span className="text-xs font-medium bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200 px-2 py-1 rounded">
                                                             Categoria IFRS 18: {account.ifrs18_category}
                                                         </span>
                                                     </div>
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
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 italic">
                          Nenhuma conta encontrada para os filtros atuais.
                      </td>
                  </tr>
              )}
            </tbody>
            {filteredAndSortedAccounts.length > 0 && !isTableLoading && (
              <tfoot className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
                 <tr>
                   <td colSpan={7} className="px-6 py-3">
                     <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-700 dark:text-slate-300">
                           Mostrando <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> até <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredAndSortedAccounts.length)}</span> de <span className="font-medium">{filteredAndSortedAccounts.length}</span> resultados
                        </div>
                        <div className="flex space-x-2">
                           <button
                             onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                             disabled={currentPage === 1}
                             className="px-3 py-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                           >
                             Anterior
                           </button>
                           <span className="px-3 py-1 text-sm text-slate-700 dark:text-slate-300 font-medium flex items-center">
                               Página {currentPage} de {totalPages}
                           </span>
                           <button
                             onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                             disabled={currentPage === totalPages}
                             className="px-3 py-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
         <div className="bg-slate-50 dark:bg-slate-700/50 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end space-x-8 text-sm font-medium text-slate-700 dark:text-slate-300">
             <span>TOTAL DÉBITOS: <span className="text-blue-700 dark:text-blue-400 ml-2 font-bold">{formatCurrency(summary.total_debits)}</span></span>
             <span>TOTAL CRÉDITOS: <span className="text-red-700 dark:text-red-400 ml-2 font-bold">{formatCurrency(summary.total_credits)}</span></span>
         </div>
      </div>
    </div>
  );
};

export default AnalysisViewer;