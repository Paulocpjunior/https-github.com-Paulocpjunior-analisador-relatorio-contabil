import React, { useState, useMemo, useEffect } from 'react';
import { AnalysisResult, ExtractedAccount, HeaderData } from '../types';
import { generateFinancialInsight, generateCMVAnalysis } from '../services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
  result: AnalysisResult;
  headerData: HeaderData;
}

type SortKey = keyof ExtractedAccount;

interface TableTheme {
    name: string;
    headerBg: string;
    headerText: string;
    rowOddBg: string;
    rowEvenBg: string;
    border: string;
}

const DEFAULT_THEMES: TableTheme[] = [
    { name: 'Padrão (Slate)', headerBg: '#f1f5f9', headerText: '#64748b', rowOddBg: '#ffffff', rowEvenBg: '#f8fafc', border: '#e2e8f0' },
    { name: 'Ocean (Azul)', headerBg: '#e0f2fe', headerText: '#0369a1', rowOddBg: '#ffffff', rowEvenBg: '#f0f9ff', border: '#bae6fd' },
    { name: 'Forest (Verde)', headerBg: '#dcfce7', headerText: '#15803d', rowOddBg: '#ffffff', rowEvenBg: '#f0fdf4', border: '#bbf7d0' },
    { name: 'Classic (Cinza)', headerBg: '#e5e7eb', headerText: '#374151', rowOddBg: '#ffffff', rowEvenBg: '#f3f4f6', border: '#d1d5db' },
];

const TABLE_THEME_KEY = 'auditAI_table_theme';
const DEFAULT_EBITDA_MULTIPLE_KEY = 'auditAI_default_ebitda_multiple';

const AnalysisViewer: React.FC<Props> = ({ result, headerData }) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isTableLoading, setIsTableLoading] = useState(true);
  
  // Theme State
  const [showThemeSettings, setShowThemeSettings] = useState(false);
  const [customTheme, setCustomTheme] = useState<TableTheme>(DEFAULT_THEMES[0]);

  useEffect(() => {
    const saved = localStorage.getItem(TABLE_THEME_KEY);
    if (saved) {
        try {
            setCustomTheme(JSON.parse(saved));
        } catch (e) {
            console.error("Failed to load theme", e);
        }
    }
  }, []);

  const applyTheme = (theme: TableTheme) => {
      setCustomTheme(theme);
      localStorage.setItem(TABLE_THEME_KEY, JSON.stringify(theme));
  };
  
  const [expandedIFRSCategories, setExpandedIFRSCategories] = useState<{
      Operacional: boolean;
      Investimento: boolean;
      Financiamento: boolean;
  }>({ Operacional: true, Investimento: false, Financiamento: false });

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  useEffect(() => {
      if (result.accounts) {
          const allSyntheticCodes = result.accounts.filter(a => a.is_synthetic && a.account_code).map(a => a.account_code!);
          setExpandedGroups(new Set(allSyntheticCodes));
      }
  }, [result]);

  const [isValuationExpanded, setIsValuationExpanded] = useState(false);
  const [isInversionExpanded, setIsInversionExpanded] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);

  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<'All' | 'Debit' | 'Credit'>('All');
  const [filterMinVal, setFilterMinVal] = useState<string>('');
  const [filterMaxVal, setFilterMaxVal] = useState<string>('');
  const [filterInversion, setFilterInversion] = useState<'all' | 'yes' | 'no'>('all');
  const [filterHasCorrection, setFilterHasCorrection] = useState(false);
  
  const [showCorrectedNames, setShowCorrectedNames] = useState(false);
  const [showSuggestionCol, setShowSuggestionCol] = useState(false);

  // Valuation & Insight State
  const [insightPrompt, setInsightPrompt] = useState('Calcular EBITDA detalhado com base nos dados extraídos e estimar Valuation.');
  const [valuationMultiple, setValuationMultiple] = useState(() => {
    try { const saved = localStorage.getItem(DEFAULT_EBITDA_MULTIPLE_KEY); return saved ? parseFloat(saved) : 5; } catch { return 5; }
  });
  const [accountingStandard, setAccountingStandard] = useState('IFRS 18 / CPC Brasil');
  
  const [ebitdaResult, setEbitdaResult] = useState<string>('');
  const [cmvResult, setCmvResult] = useState<string>('');
  
  const [isEbitdaLoading, setIsEbitdaLoading] = useState(false);
  const [isCmvLoading, setIsCmvLoading] = useState(false);

  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const handleGenerateEBITDA = async () => {
    if (!result) return;
    setIsEbitdaLoading(true);
    try {
        const text = await generateFinancialInsight(result, insightPrompt, valuationMultiple, accountingStandard);
        setEbitdaResult(text);
    } catch (e) {
        setEbitdaResult("Erro ao gerar análise. Verifique se a chave de API é válida e se há conexão com a internet.");
        console.error(e);
    } finally {
        setIsEbitdaLoading(false);
    }
  };

  const handleGenerateCMV = async () => {
      if (!result) return;
      setIsCmvLoading(true);
      try {
          const text = await generateCMVAnalysis(result, accountingStandard);
          setCmvResult(text);
      } catch (e) {
          setCmvResult("Erro ao analisar CMV. Verifique se a chave de API é válida e se há conexão com a internet.");
          console.error(e);
      } finally {
          setIsCmvLoading(false);
      }
  };

  const { summary, accounts = [], spell_check = [] } = result || {};

  const validSpellCheck = useMemo(() => {
      if (!spell_check) return [];
      return spell_check.filter(s => s.original_term && s.suggested_correction && s.original_term.toLowerCase() !== s.suggested_correction.toLowerCase());
  }, [spell_check]);

  const invertedAccounts = useMemo(() => {
      return accounts.filter(a => a.possible_inversion && !a.is_synthetic);
  }, [accounts]);

  const finalResultValue = useMemo(() => {
      if (summary?.specific_result_value !== undefined) return summary.specific_result_value;
      return summary ? summary.total_credits - summary.total_debits : 0;
  }, [summary]);

  const finalResultLabel = useMemo(() => {
      if (summary?.specific_result_label) return summary.specific_result_label;
      return finalResultValue >= 0 ? 'LUCRO / SUPERÁVIT' : 'PREJUÍZO / DÉFICIT';
  }, [summary, finalResultValue]);

  const profitLossStyle = useMemo(() => finalResultValue >= 0 
      ? { text: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' }
      : { text: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800' }, [finalResultValue]);

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
  
  const getSuggestionForAccount = (account: ExtractedAccount) => {
      const corrected = getDisplayedName(account);
      return corrected !== account.account_name ? corrected : null;
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
    if (filterHasCorrection) processedAccounts = processedAccounts.filter(acc => getSuggestionForAccount(acc) !== null);

    if (!searchTerm && filterType === 'All' && !filterMinVal && !filterInversion && !filterHasCorrection) {
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
  }, [accounts, sortConfig, searchTerm, filterType, filterMinVal, filterMaxVal, filterInversion, filterHasCorrection, expandedGroups, showCorrectedNames]);

  const paginatedAccounts = useMemo(() => filteredAndSortedAccounts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredAndSortedAccounts, currentPage, itemsPerPage]);
  const requestSort = (key: SortKey) => setSortConfig({ key, direction: sortConfig?.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc' });

  // IFRS Logic
  const ifrsGroups = useMemo(() => {
      const groups = { Operacional: [] as ExtractedAccount[], Investimento: [] as ExtractedAccount[], Financiamento: [] as ExtractedAccount[] };
      accounts.forEach(acc => {
          if (acc.ifrs18_category === 'Operacional') groups.Operacional.push(acc);
          else if (acc.ifrs18_category === 'Investimento') groups.Investimento.push(acc);
          else if (acc.ifrs18_category === 'Financiamento') groups.Financiamento.push(acc);
      });
      return groups;
  }, [accounts]);
  
  const hasIFRSData = ifrsGroups.Operacional.length + ifrsGroups.Investimento.length + ifrsGroups.Financiamento.length > 0;
  
  const toggleIFRSCategory = (cat: keyof typeof expandedIFRSCategories) => setExpandedIFRSCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  const expandAllIFRS = () => { if(hasIFRSData) setExpandedIFRSCategories({ Operacional: true, Investimento: true, Financiamento: true }); };
  const collapseAllIFRS = () => { if(hasIFRSData) setExpandedIFRSCategories({ Operacional: false, Investimento: false, Financiamento: false }); };

  // --- PDF GENERATION LOGIC ---
  const generatePDFDocument = () => {
      const doc = new jsPDF();
      
      // Header
      doc.setFillColor(37, 99, 235); // Blue
      doc.rect(0, 0, 210, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text('Relatório de Análise Contábil - AuditAI', 14, 13);
      
      // Info
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      doc.text(`Empresa: ${headerData.companyName}`, 14, 30);
      doc.text(`CNPJ: ${headerData.cnpj}`, 14, 36);
      doc.text(`Responsável: ${headerData.collaboratorName}`, 14, 42);
      doc.text(`Data: ${new Date().toLocaleDateString()}`, 150, 30);
      
      // Summary Table
      doc.setFontSize(12);
      doc.text('Resumo Financeiro', 14, 52);
      
      autoTable(doc, {
          startY: 55,
          head: [['Descrição', 'Valor']],
          body: [
              ['Total Débitos', formatCurrency(summary.total_debits)],
              ['Total Créditos', formatCurrency(summary.total_credits)],
              ['Resultado Líquido', formatCurrency(finalResultValue)],
              ['Status', summary.is_balanced ? 'Balanceado' : 'Desbalanceado']
          ],
          theme: 'striped',
          headStyles: { fillColor: [37, 99, 235] }
      });
      
      let finalY = (doc as any).lastAutoTable.finalY + 10;
      
      // Observations
      if (summary.observations.length > 0) {
          doc.text('Observações e Insights da IA', 14, finalY);
          finalY += 5;
          const obsText = summary.observations.map(o => `• ${o}`).join('\n');
          doc.setFontSize(10);
          const splitObs = doc.splitTextToSize(obsText, 180);
          doc.text(splitObs, 14, finalY);
          finalY += (splitObs.length * 5) + 10;
      }
      
      // Inconsistencies (if any)
      if (invertedAccounts.length > 0) {
          doc.setTextColor(220, 38, 38); // Red
          doc.text(`Alerta: ${invertedAccounts.length} Contas com Natureza Invertida`, 14, finalY);
          doc.setTextColor(0, 0, 0);
          
          autoTable(doc, {
              startY: finalY + 5,
              head: [['Código', 'Conta', 'Saldo Invertido']],
              body: invertedAccounts.map(acc => [
                  acc.account_code || '-',
                  acc.account_name,
                  formatCurrency(acc.final_balance)
              ]),
              theme: 'grid',
              headStyles: { fillColor: [220, 38, 38] }
          });
      }
      
      return doc;
  };

  const handleDownloadPDF = () => {
      const doc = generatePDFDocument();
      doc.save(`Relatorio_${headerData.companyName.replace(/\s+/g, '_')}.pdf`);
  };

  const handleEmailExport = () => {
    // 1. Generate and Download PDF first
    handleDownloadPDF();
    
    // 2. Open Mail Client with Instructions
    const subject = `Análise Contábil - ${headerData.companyName}`;
    const body = `
Olá,

Segue resumo da análise contábil realizada pelo AuditAI.

EMPRESA: ${headerData.companyName}
CNPJ: ${headerData.cnpj}
RESPONSÁVEL: ${headerData.collaboratorName}

--- RESUMO ---
Documento: ${summary.document_type}
Resultado: ${formatCurrency(finalResultValue)}
Status: ${summary.is_balanced ? 'Balanceado' : 'Desbalanceado'}

*** IMPORTANTE: O Relatório PDF completo foi baixado para o seu dispositivo. Por favor, anexe-o a este e-mail. ***
    `.trim();

    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  const exportPDFContent = (title: string, content: string) => {
      if (!content) return;
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(title, 20, 20);
      doc.setFontSize(10);
      doc.text(`Empresa: ${headerData.companyName}`, 20, 30);
      doc.text(`Data: ${new Date().toLocaleDateString()}`, 20, 35);
      
      const splitText = doc.splitTextToSize(content, 170);
      doc.text(splitText, 20, 50);
      doc.save(`${title.replace(/\s+/g, '_')}_${headerData.companyName.replace(/\s+/g, '_')}.pdf`);
  };

  const balanceReason = useMemo(() => {
    if (summary.is_balanced) return '';
    return summary.total_debits > summary.total_credits 
        ? 'Débitos excedem Créditos' 
        : 'Créditos excedem Débitos';
  }, [summary]);

  if (!summary) return null;

  return (
    <div className="space-y-8 animate-fadeIn relative">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm mb-2 border border-slate-200 dark:border-slate-700 print:hidden">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">{headerData.companyName || 'Empresa não identificada'}</h2>
        <div className="flex flex-col md:flex-row md:items-center gap-2 mt-1 text-slate-500 dark:text-slate-400 text-sm font-medium">
            {headerData.cnpj && <span>CNPJ: {headerData.cnpj}</span>}
            {summary.period && <span>• Período: {summary.period}</span>}
        </div>
      </div>

      <div id="summary" className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden print:shadow-none print:border-none">
        <div className="bg-slate-800 dark:bg-slate-900 px-6 py-4 flex justify-between items-center print:bg-white print:text-black print:px-0 print:border-b">
          <h3 className="text-xl font-semibold text-white print:text-black">Resumo: {summary.document_type}</h3>
          <div className="flex gap-2 print:hidden">
              <button 
                onClick={handleDownloadPDF}
                className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded border border-white/20 transition-colors flex items-center gap-2"
                title="Baixar Relatório PDF Formatado"
              >
                <span>📄</span> Baixar PDF / Imprimir
              </button>
              <button 
                onClick={handleEmailExport}
                className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded border border-blue-400 transition-colors flex items-center gap-2 font-bold"
                title="Gerar PDF e abrir E-mail"
              >
                <span>✉️</span> Enviar por E-mail
              </button>
          </div>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 print:grid-cols-2 print:gap-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-100 dark:border-blue-800">
                <p className="text-sm text-blue-600 font-medium">Débitos (Analítico)</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(summary.total_debits)}</p>
                <p className="text-[10px] text-blue-500 mt-1 italic">(Ativos + Despesas + Custos)</p>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded border border-red-100 dark:border-red-800">
                <p className="text-sm text-red-600 font-medium">Créditos (Analítico)</p>
                <p className="text-2xl font-bold text-red-900 dark:text-red-100">{formatCurrency(summary.total_credits)}</p>
                <p className="text-[10px] text-red-500 mt-1 italic">(Passivos + Receitas + PL)</p>
            </div>
            <div className={`p-4 rounded border ${profitLossStyle.bg} ${profitLossStyle.border}`}>
                <p className={`text-sm font-bold ${profitLossStyle.text}`}>{finalResultLabel}</p>
                <p className={`text-2xl font-bold ${profitLossStyle.text}`}>{formatCurrency(finalResultValue)}</p>
                {!summary.specific_result_label && (
                   <p className={`text-[10px] opacity-80 mt-1 italic ${profitLossStyle.text}`}>(Total Créditos - Total Débitos)</p>
                )}
            </div>
            <div className={`p-4 rounded border ${summary.is_balanced ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                <p className="text-sm font-medium">Status do Balancete</p>
                <span className={`text-lg font-bold ${summary.is_balanced ? 'text-green-800' : 'text-red-800'}`}>{summary.is_balanced ? 'Balanceado' : 'Desbalanceado'}</span>
                {!summary.is_balanced && (
                    <div className="mt-1">
                        <span className="text-xs text-red-700 block font-bold">Diferença: {formatCurrency(summary.discrepancy_amount)}</span>
                        <span className="text-[10px] text-red-600 italic block">Motivo: {balanceReason}</span>
                    </div>
                )}
            </div>
        </div>

        <div className="px-6 pb-6">
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-100 dark:border-indigo-800">
                <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-300 mb-4 border-b border-indigo-200 dark:border-indigo-800 pb-2">Resumo Detalhado da Análise IA</h4>
                
                {/* --- SEÇÃO DE INCONSISTÊNCIAS / ERROS --- */}
                {invertedAccounts.length > 0 && (
                     <div className="mb-6 border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 rounded overflow-hidden">
                         <button 
                             onClick={() => setIsInversionExpanded(!isInversionExpanded)}
                             className="w-full flex justify-between items-center p-3 bg-yellow-100 dark:bg-yellow-900/40 hover:bg-yellow-200 transition-colors"
                         >
                            <h5 className="font-bold text-yellow-800 dark:text-yellow-500 text-xs uppercase flex items-center">
                                <span className="text-lg mr-2">⚠️</span> 
                                Relatório de Inconsistências (Inversões de Natureza): {invertedAccounts.length}
                            </h5>
                            <span className="text-yellow-700">{isInversionExpanded ? '▼' : '▶'}</span>
                         </button>
                         
                         {isInversionExpanded && (
                             <div className="p-3">
                                 <p className="text-xs text-yellow-900 dark:text-yellow-200 mb-3">
                                     As seguintes contas apresentam saldo final contrário à sua natureza contábil (Ex: Ativo com saldo Credor):
                                 </p>
                                 <div className="max-h-60 overflow-y-auto">
                                     <table className="w-full text-xs text-left">
                                         <thead className="bg-yellow-100/50 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-400 font-bold">
                                             <tr>
                                                 <th className="p-2">Código</th>
                                                 <th className="p-2">Conta</th>
                                                 <th className="p-2 text-right">Saldo (Inv.)</th>
                                             </tr>
                                         </thead>
                                         <tbody className="divide-y divide-yellow-200 dark:divide-yellow-800">
                                             {invertedAccounts.map((acc, idx) => (
                                                 <tr key={idx} className="hover:bg-yellow-100/30">
                                                     <td className="p-2 font-mono">{acc.account_code || '-'}</td>
                                                     <td className="p-2">{acc.account_name}</td>
                                                     <td className="p-2 text-right font-bold text-red-600 dark:text-red-400">{formatCurrency(acc.final_balance)}</td>
                                                 </tr>
                                             ))}
                                         </tbody>
                                     </table>
                                 </div>
                             </div>
                         )}
                     </div>
                )}

                {/* --- SEÇÃO DE CORREÇÕES ORTOGRÁFICAS --- */}
                {validSpellCheck.length > 0 && (
                     <div className="mb-6 border border-purple-200 bg-purple-50 dark:bg-purple-900/20 rounded overflow-hidden">
                         <div className="p-3 bg-purple-100 dark:bg-purple-900/40">
                             <h5 className="font-bold text-purple-800 dark:text-purple-400 text-xs uppercase flex items-center">
                                 <span className="text-lg mr-2">🔤</span> 
                                 Sugestões de Correção Ortográfica: {validSpellCheck.length}
                             </h5>
                         </div>
                         <div className="p-3 max-h-40 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2">
                             {validSpellCheck.map((item, idx) => (
                                 <div key={idx} className="flex justify-between items-center text-xs border-b border-purple-100 dark:border-purple-800 pb-1">
                                     <span className="text-red-500 line-through mr-2">{item.original_term}</span>
                                     <span className="text-green-600 font-bold">➜ {item.suggested_correction}</span>
                                 </div>
                             ))}
                         </div>
                     </div>
                )}

                <div className="mt-4">
                    <h5 className="font-bold text-slate-700 dark:text-slate-300 text-xs uppercase mb-2">Observações Gerais da Auditoria IA:</h5>
                    <ul className="list-disc list-inside text-sm text-slate-700 dark:text-slate-300 space-y-1">
                        {summary.observations.length > 0 ? summary.observations.map((obs, i) => <li key={i}>{obs}</li>) : <li className="italic">Gerando análise detalhada...</li>}
                    </ul>
                </div>
            </div>
         </div>
      </div>

      {/* NEW FINANCIAL TOOLS SECTION (SEPARATED) */}
      <div id="valuation" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden print:hidden">
          <div className="px-6 py-4 bg-emerald-700 dark:bg-emerald-900 border-b dark:border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-white">Ferramentas Financeiras & Valuation (IA)</h3>
              <button onClick={() => setIsValuationExpanded(!isValuationExpanded)} className="text-white hover:text-emerald-200 font-mono text-xl">{isValuationExpanded ? '▼' : '▶'}</button>
          </div>
          {isValuationExpanded && (
            <div className="p-6 space-y-8">
                
                {/* TOOL 1: EBITDA & VALUATION */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-5">
                    <h4 className="font-bold text-emerald-800 dark:text-emerald-400 mb-4 flex items-center gap-2">
                        <span className="text-xl">📊</span> EBITDA & Valuation
                    </h4>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-1 space-y-4">
                             <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Prompt da Análise</label>
                                <textarea 
                                    value={insightPrompt}
                                    onChange={(e) => setInsightPrompt(e.target.value)}
                                    className="w-full h-24 p-2 border rounded text-sm dark:bg-slate-700 dark:text-white resize-none"
                                    placeholder="Ex: Calcular EBITDA detalhado..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Múltiplo de Valuation: {valuationMultiple}x</label>
                                <input 
                                    type="range" min="1" max="10" step="0.5" 
                                    value={valuationMultiple}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setValuationMultiple(val);
                                        localStorage.setItem(DEFAULT_EBITDA_MULTIPLE_KEY, val.toString());
                                    }}
                                    className="w-full h-2 bg-emerald-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                                />
                                <div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>1x (Baixo)</span><span>10x (Alto)</span></div>
                            </div>
                            <button 
                                onClick={handleGenerateEBITDA}
                                disabled={isEbitdaLoading}
                                className="w-full py-2 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm"
                            >
                                {isEbitdaLoading ? 'Calculando...' : '⚡ Calcular EBITDA & Valuation'}
                            </button>
                        </div>
                        <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-900/50 p-4 rounded border border-slate-200 dark:border-slate-700 min-h-[200px]">
                             {ebitdaResult ? (
                                <div className="prose dark:prose-invert max-w-none text-sm">
                                    <div className="flex justify-between items-center mb-4 border-b pb-2 border-slate-200 dark:border-slate-700">
                                        <span className="font-bold text-emerald-700 dark:text-emerald-500">Resultado EBITDA</span>
                                        <button onClick={() => exportPDFContent('Relatório EBITDA e Valuation', ebitdaResult)} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded border border-emerald-200 hover:bg-emerald-200">📄 PDF</button>
                                    </div>
                                    <pre className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300">{ebitdaResult}</pre>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                    <p className="text-sm">Preencha o prompt e clique em calcular.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* TOOL 2: CMV Analysis */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-5">
                    <h4 className="font-bold text-blue-800 dark:text-blue-400 mb-4 flex items-center gap-2">
                        <span className="text-xl">📉</span> Análise de CMV (Lei Vigente)
                    </h4>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-1 space-y-4">
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                A IA irá auditar as contas de Custo das Mercadorias Vendidas baseando-se na norma contábil selecionada e na legislação fiscal atual.
                            </p>
                             <button 
                                onClick={handleGenerateCMV}
                                disabled={isCmvLoading}
                                className="w-full py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
                            >
                                {isCmvLoading ? 'Analisando...' : '🔍 Analisar CMV'}
                            </button>
                        </div>
                        <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-900/50 p-4 rounded border border-slate-200 dark:border-slate-700 min-h-[150px]">
                             {cmvResult ? (
                                <div className="prose dark:prose-invert max-w-none text-sm">
                                    <div className="flex justify-between items-center mb-4 border-b pb-2 border-slate-200 dark:border-slate-700">
                                        <span className="font-bold text-blue-700 dark:text-blue-500">Resultado CMV</span>
                                        <button onClick={() => exportPDFContent('Relatório de Análise CMV', cmvResult)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded border border-blue-200 hover:bg-blue-200">📄 PDF</button>
                                    </div>
                                    <pre className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300">{cmvResult}</pre>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                    <p className="text-sm">Clique em Analisar para iniciar a auditoria de custos.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
          )}
      </div>

      {/* SPELL CHECK SECTION (Still accessible in dropdown, but now summarized above) */}
      {/* Keeping this as a detailed view if user wants to see the table form */}

      {/* DRE IFRS SECTION */}
      {summary.document_type === 'DRE' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden print:hidden">
             <div className="px-6 py-4 bg-slate-100 dark:bg-slate-900 border-b dark:border-slate-700 flex justify-between items-center">
                 <h3 className="text-lg font-semibold dark:text-white">Análise IFRS 18 (DRE)</h3>
                 <div className="flex gap-2">
                     <button onClick={expandAllIFRS} disabled={!hasIFRSData} className="px-3 py-1 rounded bg-slate-200 disabled:opacity-50 text-xs hover:bg-slate-300 text-slate-700">Expandir Tudo</button>
                     <button onClick={collapseAllIFRS} disabled={!hasIFRSData} className="px-3 py-1 rounded bg-slate-200 disabled:opacity-50 text-xs hover:bg-slate-300 text-slate-700">Recolher Tudo</button>
                 </div>
             </div>
             <div className="p-4">
                 {!hasIFRSData ? <p className="text-center text-slate-500 italic py-4">Nenhuma conta DRE categorizada encontrada.</p> : (
                     <div className="space-y-4">
                         {Object.entries(ifrsGroups).map(([category, itemsRaw]) => {
                             const items = itemsRaw as ExtractedAccount[];
                             return (
                                <div key={category} className="border rounded dark:border-slate-700">
                                    <button onClick={() => toggleIFRSCategory(category as keyof typeof expandedIFRSCategories)} className="w-full flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100">
                                        <span className="font-bold text-slate-800 dark:text-white">{category} ({items.length})</span>
                                        <span className="text-slate-500">{expandedIFRSCategories[category as keyof typeof expandedIFRSCategories] ? '▼' : '▶'}</span>
                                    </button>
                                    {expandedIFRSCategories[category as keyof typeof expandedIFRSCategories] && items.length > 0 && (
                                        <div className="p-3 bg-white dark:bg-slate-800">
                                            <ul className="text-sm space-y-1">
                                                {items.map(i => <li key={i.account_code || i.account_name} className="flex justify-between border-b border-dashed border-slate-200 dark:border-slate-700 py-1 text-slate-700 dark:text-slate-300"><span>{i.account_name}</span><span className="font-mono">{formatCurrency(i.total_value)}</span></li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                             );
                         })}
                     </div>
                 )}
             </div>
        </div>
      )}

      <div id="accounts" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
         <div className="px-6 py-4 border-b dark:border-slate-700 flex flex-wrap justify-between items-center gap-3 print:bg-slate-100">
            <h3 className="text-lg font-semibold dark:text-white">Contas ({filteredAndSortedAccounts.length})</h3>
            <div className="flex flex-wrap gap-2 print:hidden">
                <button 
                    onClick={() => setShowThemeSettings(!showThemeSettings)}
                    className={`px-3 py-2 rounded text-sm border flex items-center gap-2 transition-colors ${showThemeSettings ? 'bg-slate-100 dark:bg-slate-700' : 'bg-white dark:bg-slate-800'}`}
                >
                    🎨 Aparência
                </button>
                <button 
                    onClick={() => setShowCorrectedNames(!showCorrectedNames)} 
                    className={`px-3 py-2 rounded text-sm border flex items-center gap-2 transition-colors ${
                        showCorrectedNames 
                        ? 'bg-purple-100 border-purple-300 text-purple-700 font-bold dark:bg-purple-900/40 dark:text-purple-300' 
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-700 dark:border-slate-600 dark:text-white'
                    }`}
                    title="Alternar entre nome original do arquivo e correção da IA"
                >
                    {showCorrectedNames ? (
                        <><span>👁️</span> Visualizando: Corrigidos</>
                    ) : (
                        <><span>✏️</span> Aplicar Correções IA</>
                    )}
                </button>
                <button onClick={() => setShowSuggestionCol(!showSuggestionCol)} className={`px-3 py-2 rounded text-sm border hover:bg-slate-50 dark:hover:bg-slate-700 ${showSuggestionCol ? 'bg-slate-100 dark:bg-slate-700' : 'bg-white dark:bg-slate-800'}`}>
                    {showSuggestionCol ? 'Ocultar Sugestões' : 'Ver Sugestões IA'}
                </button>
                <button onClick={() => setShowFilters(!showFilters)} className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700">Filtros Avançados</button>
                <button onClick={expandAllGroups} className="bg-slate-200 dark:bg-slate-700 px-3 py-2 rounded text-sm hover:bg-slate-300">Expandir Tudo</button>
                <button onClick={collapseAllGroups} className="bg-slate-200 dark:bg-slate-700 px-3 py-2 rounded text-sm hover:bg-slate-300">Recolher Tudo</button>
            </div>
         </div>
         
         {/* THEME SETTINGS PANEL */}
         {showThemeSettings && (
             <div className="p-4 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 animate-slideDown print:hidden">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div>
                         <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Paletas Predefinidas</label>
                         <div className="flex flex-wrap gap-2">
                             {DEFAULT_THEMES.map(theme => (
                                 <button 
                                     key={theme.name}
                                     onClick={() => applyTheme(theme)}
                                     className={`px-3 py-2 rounded text-sm border transition-all ${customTheme.name === theme.name ? 'ring-2 ring-offset-1 ring-blue-500 font-bold' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                     style={{ backgroundColor: theme.headerBg, color: theme.headerText, borderColor: theme.border }}
                                 >
                                     {theme.name}
                                 </button>
                             ))}
                         </div>
                     </div>
                     <div>
                         <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Personalização Fina</label>
                         <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                             <div>
                                 <span className="text-[10px] text-slate-500 block mb-1">Fundo Cabeçalho</span>
                                 <input type="color" value={customTheme.headerBg} onChange={e => applyTheme({...customTheme, name: 'Personalizado', headerBg: e.target.value})} className="w-full h-8 cursor-pointer rounded border" />
                             </div>
                             <div>
                                 <span className="text-[10px] text-slate-500 block mb-1">Texto Cabeçalho</span>
                                 <input type="color" value={customTheme.headerText} onChange={e => applyTheme({...customTheme, name: 'Personalizado', headerText: e.target.value})} className="w-full h-8 cursor-pointer rounded border" />
                             </div>
                              <div>
                                 <span className="text-[10px] text-slate-500 block mb-1">Linha Ímpar</span>
                                 <input type="color" value={customTheme.rowOddBg} onChange={e => applyTheme({...customTheme, name: 'Personalizado', rowOddBg: e.target.value})} className="w-full h-8 cursor-pointer rounded border" />
                             </div>
                             <div>
                                 <span className="text-[10px] text-slate-500 block mb-1">Linha Par</span>
                                 <input type="color" value={customTheme.rowEvenBg} onChange={e => applyTheme({...customTheme, name: 'Personalizado', rowEvenBg: e.target.value})} className="w-full h-8 cursor-pointer rounded border" />
                             </div>
                         </div>
                     </div>
                 </div>
             </div>
         )}

         {showFilters && <div className="p-4 bg-slate-50 dark:bg-slate-700 grid grid-cols-1 md:grid-cols-4 gap-4 animate-slideDown print:hidden">
            <div><label className="text-xs font-bold text-slate-500 uppercase">Tipo</label><select value={filterType} onChange={e => setFilterType(e.target.value as any)} className="w-full p-2 rounded border dark:bg-slate-800 dark:border-slate-600 dark:text-white"><option value="All">Todos</option><option value="Debit">Débito</option><option value="Credit">Crédito</option></select></div>
            <div><label className="text-xs font-bold text-slate-500 uppercase">Status Inversão</label><select value={filterInversion} onChange={e => setFilterInversion(e.target.value as any)} className="w-full p-2 rounded border dark:bg-slate-800 dark:border-slate-600 dark:text-white"><option value="all">Todos</option><option value="yes">Sim (Anomalia ⚠️)</option><option value="no">Não (Normal)</option></select></div>
            <div className="flex items-end">
                <div className="flex items-center space-x-2 border p-2 rounded w-full bg-white dark:bg-slate-800 dark:border-slate-600 h-[42px]">
                    <input type="checkbox" id="toggleCorrection" checked={showCorrectedNames} onChange={(e) => setShowCorrectedNames(e.target.checked)} className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500 bg-slate-100 border-slate-300" />
                    <label htmlFor="toggleCorrection" className="text-sm cursor-pointer select-none text-slate-700 dark:text-slate-300">Substituir por Nomes Corrigidos (IA)</label>
                </div>
            </div>
            <div className="flex items-end">
                <div className="flex items-center space-x-2 border p-2 rounded w-full bg-white dark:bg-slate-800 dark:border-slate-600 h-[42px]">
                    <input 
                        type="checkbox" 
                        id="toggleSuggestionCol" 
                        checked={showSuggestionCol} 
                        onChange={(e) => setShowSuggestionCol(e.target.checked)} 
                        className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500 bg-slate-100 border-slate-300" 
                    />
                    <label htmlFor="toggleSuggestionCol" className="text-sm cursor-pointer select-none text-slate-700 dark:text-slate-300">
                        Exibir Coluna "Sugestão IA"
                    </label>
                </div>
            </div>
         </div>}
         
         <div 
            className="overflow-auto max-h-[70vh] print:max-h-none"
            style={{
                '--theme-header-bg': customTheme.headerBg,
                '--theme-header-text': customTheme.headerText,
                '--theme-row-odd': customTheme.rowOddBg,
                '--theme-row-even': customTheme.rowEvenBg,
                '--theme-border': customTheme.border,
            } as React.CSSProperties}
         >
          <table className="min-w-full divide-y divide-[var(--theme-border)]">
            <thead className="bg-[var(--theme-header-bg)] sticky top-0 z-20 shadow-md">
              <tr>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-left text-xs font-medium uppercase">Código</th>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-left text-xs font-medium uppercase">Conta</th>
                {showSuggestionCol && <th className="px-4 py-3 text-left text-xs font-medium text-purple-600 uppercase">Sugestão IA</th>}
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-right text-xs font-medium uppercase">Sdo. Anterior</th>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-right text-xs font-medium uppercase">Débito</th>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-right text-xs font-medium uppercase">Crédito</th>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-right text-xs font-medium uppercase">Sdo. Atual</th>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-center text-xs font-medium uppercase">Inv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--theme-border)]">
                  {paginatedAccounts.map((account, index) => {
                        const suggestion = getSuggestionForAccount(account);
                        const isOdd = index % 2 !== 0;
                        const rowStyle = { backgroundColor: isOdd ? 'var(--theme-row-odd)' : 'var(--theme-row-even)' };
                        
                        return (
                        <tr key={account.originalIndex} style={rowStyle} className={`hover:opacity-90 ${account.possible_inversion ? '!bg-yellow-50 dark:!bg-yellow-900/10 border-l-[6px] border-yellow-500' : ''} ${account.is_synthetic ? 'font-bold' : ''}`}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-blue-600 font-bold">
                             {account.account_code ? <a href={`https://www.google.com/search?q=${encodeURIComponent(account.account_code + ' ' + account.account_name)}`} target="_blank" rel="noreferrer" className="hover:underline">{account.account_code}</a> : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm dark:text-slate-800 relative">
                            <div className="flex items-center" style={{ paddingLeft: `${(account.level - 1) * 16}px` }}>
                                {account.is_synthetic && (
                                    <button onClick={() => account.account_code && toggleGroup(account.account_code)} className="mr-2 w-4 h-4 flex items-center justify-center border rounded bg-slate-200 text-xs print:hidden">
                                        {account.account_code && expandedGroups.has(account.account_code) ? '-' : '+'}
                                    </button>
                                )}
                                <span className={account.possible_inversion ? 'underline decoration-red-500 decoration-wavy' : ''}>
                                    {showCorrectedNames ? getDisplayedName(account) : account.account_name}
                                </span>
                                
                                {/* GRAPHICAL SUGGESTION INDICATOR */}
                                {!showCorrectedNames && suggestion && (
                                    <div className="group relative ml-2 cursor-help print:hidden">
                                        <span className="text-purple-500 animate-pulse text-lg" title="Sugestão de Correção Disponível">✨</span>
                                        <div className="absolute left-full top-0 ml-2 w-64 bg-white border border-purple-200 shadow-xl rounded p-3 text-xs z-50 hidden group-hover:block">
                                            <p className="font-bold text-purple-700 mb-1 border-b pb-1">Sugestão Ortográfica IA:</p>
                                            <p className="line-through text-slate-400 mb-1">{account.account_name}</p>
                                            <p className="text-green-600 font-bold text-sm">⬇ {suggestion}</p>
                                        </div>
                                    </div>
                                )}
                                
                                {showCorrectedNames && suggestion && (
                                     <span className="ml-2 text-[10px] bg-purple-100 text-purple-600 px-1 rounded border border-purple-200">Corrigido</span>
                                )}
                            </div>
                          </td>
                          {showSuggestionCol && <td className="px-4 py-3 text-sm text-green-600 font-medium">{getSuggestionForAccount(account) || '-'}</td>}
                          <td className="px-4 py-3 text-right text-sm font-mono text-slate-600">{formatCurrency(account.initial_balance)}</td>
                          <td className="px-4 py-3 text-right text-sm text-blue-700 font-mono">{account.debit_value > 0 ? formatCurrency(account.debit_value) : '-'}</td>
                          <td className="px-4 py-3 text-right text-sm text-red-700 font-mono">{account.credit_value > 0 ? formatCurrency(account.credit_value) : '-'}</td>
                          <td className="px-4 py-3 text-right text-sm font-mono text-slate-800">{formatCurrency(account.final_balance)}</td>
                          <td className={`px-4 py-3 text-center ${account.possible_inversion ? 'bg-yellow-100 rounded' : ''}`}>
                              {account.possible_inversion && !account.is_synthetic && (
                                  <div className="group relative inline-block cursor-help print:hidden">
                                      <span className="text-yellow-600 font-bold text-lg">⚠️</span>
                                      <div className="absolute right-0 top-full mt-2 w-72 bg-white border-2 border-yellow-400 shadow-xl rounded-lg p-4 text-left z-50 hidden group-hover:block animate-fadeIn">
                                          <h4 className="font-bold text-yellow-700 text-sm uppercase mb-3 border-b border-yellow-200 pb-2 flex items-center">
                                             <span className="mr-2 text-xl">⚠️</span> Inversão de Natureza
                                          </h4>
                                          <p className="text-xs mb-3 text-slate-700 leading-relaxed font-medium">
                                             Esta conta está com saldo final contrário ao esperado para seu grupo contábil.
                                          </p>
                                          <div className="bg-yellow-50 p-3 rounded border border-yellow-200 mb-3">
                                              <p className="text-[10px] font-extrabold text-yellow-800 mb-2 uppercase tracking-wide">Exemplos Concretos:</p>
                                              <ul className="space-y-2">
                                                  <li className="text-xs text-slate-800 flex items-start">
                                                      <span className="text-red-500 mr-1">❌</span>
                                                      <span><strong>Caixa/Bancos (Ativo)</strong><br/><span className="text-[10px] opacity-80">Virou CREDOR (Negativo/Estourado)</span></span>
                                                  </li>
                                                  <li className="text-xs text-slate-800 flex items-start">
                                                      <span className="text-red-500 mr-1">❌</span>
                                                      <span><strong>Fornecedores (Passivo)</strong><br/><span className="text-[10px] opacity-80">Virou DEVEDOR (Adiantamento?)</span></span>
                                                  </li>
                                              </ul>
                                          </div>
                                          <p className="text-xs text-blue-600 font-bold border-t pt-2 border-slate-100">
                                              👉 Ação: Verifique erros de classificação ou lançamentos manuais invertidos.
                                          </p>
                                      </div>
                                  </div>
                              )}
                          </td>
                        </tr>
                  )})}
            </tbody>
          </table>
         </div>
      </div>
    </div>
  );
};

export default AnalysisViewer;