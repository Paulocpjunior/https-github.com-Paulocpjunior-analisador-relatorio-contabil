import React, { useState, useMemo, useEffect } from 'react';
import { AnalysisResult, ExtractedAccount, HeaderData } from '../types';
import { generateFinancialInsight, generateCMVAnalysis, generateSpedComplianceCheck } from '../services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

interface Props {
  result: AnalysisResult;
  headerData: HeaderData;
  previousAccounts?: ExtractedAccount[];
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

const AnalysisViewer: React.FC<Props> = ({ result, headerData, previousAccounts }) => {
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
      setShowThemeSettings(false);
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
      if (result.summary.document_type === 'DRE') {
          setExpandedIFRSCategories({ Operacional: true, Investimento: true, Financiamento: true });
      }
  }, [result]);

  const [isValuationExpanded, setIsValuationExpanded] = useState(false);
  const [isChartExpanded, setIsChartExpanded] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);

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
  
  const [isEbitdaLoading, setIsEbitdaLoading] = useState(false);

  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const handleGenerateEBITDA = async () => {
    if (!result) return;
    setIsEbitdaLoading(true);
    try {
        const text = await generateFinancialInsight(result, insightPrompt, valuationMultiple, accountingStandard);
        setEbitdaResult(text);
    } catch (e) {
        setEbitdaResult("Erro ao gerar análise. Verifique se a chave de API é válida.");
    } finally {
        setIsEbitdaLoading(false);
    }
  };

  const { summary, accounts = [], spell_check = [] } = result || {};

  const invertedAccounts = useMemo(() => {
      return accounts.filter(a => a.possible_inversion && !a.is_synthetic);
  }, [accounts]);

  // --- BALANCE SHEET CHART DATA ---
  const balanceSheetChartData = useMemo(() => {
      if (summary.document_type !== 'Balanço Patrimonial' || accounts.length === 0) return null;

      // Helpers to sum accounts starting with a code prefix
      const sumByPrefix = (prefix: string) => accounts
          .filter(a => a.account_code?.startsWith(prefix) && a.level === 2) // Level 2 usually captures groups like 1.1, 1.2
          .reduce((sum, a) => sum + a.final_balance, 0);
        
      // Fallback: search by name if codes are weird
      const sumByName = (keywords: string[]) => accounts
          .filter(a => !a.is_synthetic && keywords.some(k => a.account_name.toLowerCase().includes(k)))
          .reduce((sum, a) => sum + a.final_balance, 0);

      // Attempt Code Extraction First (Standard Plan of Accounts)
      let ac = sumByPrefix('1.1');
      let anc = sumByPrefix('1.2');
      let pc = sumByPrefix('2.1');
      let pnc = sumByPrefix('2.2');
      let pl = sumByPrefix('2.3');

      // If zeros, try keywords (fallback)
      if (ac === 0 && anc === 0) {
          ac = sumByName(['ativo circulante']);
          anc = sumByName(['não circulante', 'realizável a longo prazo', 'imobilizado', 'intangível']);
          pc = sumByName(['passivo circulante']);
          pnc = sumByName(['passivo não circulante', 'exigível a longo prazo']);
          pl = sumByName(['patrimônio líquido', 'capital social', 'lucros acumulados']);
      }

      // Ensure positive values for visualization
      return [
          {
              name: 'Ativo',
              Circulante: Math.abs(ac),
              NaoCirculante: Math.abs(anc),
          },
          {
              name: 'Passivo + PL',
              Circulante: Math.abs(pc),
              NaoCirculante: Math.abs(pnc),
              PatrimonioLiquido: Math.abs(pl)
          }
      ];
  }, [summary.document_type, accounts]);

  // --- GENERAL CHART DATA PREPARATION ---
  const chartData = useMemo(() => {
      if (!accounts || accounts.length === 0) return [];
      const analytical = accounts.filter(a => !a.is_synthetic);
      const topAccounts = analytical
          .sort((a, b) => Math.abs(b.final_balance) - Math.abs(a.final_balance))
          .slice(0, 5);
      if (topAccounts.length === 0) return [];
      return topAccounts.map(acc => ({
          name: acc.account_name.length > 15 ? acc.account_name.substring(0, 15) + '...' : acc.account_name,
          fullName: acc.account_name,
          initial: typeof acc.initial_balance === 'number' ? acc.initial_balance : 0,
          final: typeof acc.final_balance === 'number' ? acc.final_balance : 0
      }));
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

  // --- ROBUST PDF GENERATOR (SAFARI FIX) ---
  const generatePDFDocument = () => {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      // Execute autoTable with fallback checks
      const runAutoTable = (options: any) => {
          if (typeof autoTable === 'function') {
              autoTable(doc, options);
          } else if (autoTable && typeof (autoTable as any).default === 'function') {
              (autoTable as any).default(doc, options);
          } else if (typeof (doc as any).autoTable === 'function') {
              (doc as any).autoTable(options);
          } else {
              console.error("AutoTable not loaded", autoTable);
              throw new Error("Plugin de Tabela PDF não disponível");
          }
      };

      const printHeader = (title: string) => {
          doc.setFillColor(30, 64, 175);
          doc.rect(0, 0, pageWidth, 25, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(16);
          doc.text(title, 14, 16);
          doc.setFontSize(9);
          doc.text('Relatório Gerado por AuditAI - Inteligência Contábil', 14, 21);
          
          doc.setTextColor(50, 50, 50);
          doc.setFontSize(10);
      };

      printHeader('Resumo da Auditoria');
      
      doc.setFontSize(11);
      doc.text(`Empresa: ${headerData.companyName || 'N/D'}`, 14, 35);
      doc.text(`CNPJ: ${headerData.cnpj || 'N/D'}`, 14, 41);
      doc.text(`Período Base: ${summary.period || 'Não identificado'}`, 14, 47);
      doc.text(`Data do Relatório: ${new Date().toLocaleDateString()}`, 14, 53);

      let currentY = 60;

      doc.setFontSize(12);
      doc.setTextColor(30, 64, 175);
      doc.text('1. Indicadores Chave', 14, currentY);
      currentY += 5;

      runAutoTable({
          startY: currentY,
          head: [['Indicador', 'Valor', 'Status']],
          body: [
              ['Total de Débitos', formatCurrency(summary.total_debits), ''],
              ['Total de Créditos', formatCurrency(summary.total_credits), ''],
              ['Resultado Apurado', formatCurrency(finalResultValue), finalResultValue >= 0 ? 'Lucro/Superávit' : 'Prejuízo/Déficit'],
              ['Conformidade (Balancete)', summary.is_balanced ? 'Balanceado' : 'Divergente', summary.is_balanced ? 'OK' : formatCurrency(summary.discrepancy_amount)]
          ],
          theme: 'grid',
          headStyles: { fillColor: [30, 64, 175] },
          styles: { fontSize: 10, cellPadding: 4 }
      });

      const lastTable = (doc as any).lastAutoTable;
      currentY = lastTable ? lastTable.finalY + 15 : currentY + 50;

      doc.setFontSize(12);
      doc.setTextColor(30, 64, 175);
      doc.text('2. Parecer da Inteligência Artificial', 14, currentY);
      currentY += 5;

      const insightText = summary.observations.length > 0 
          ? summary.observations.map(o => `• ${o}`).join('\n\n')
          : "Nenhuma observação crítica detectada automaticamente.";

      runAutoTable({
          startY: currentY,
          body: [[insightText]],
          theme: 'plain',
          styles: { fontSize: 10, cellPadding: 5, overflow: 'linebreak' },
          showHead: 'never'
      });
      
      const lastTable2 = (doc as any).lastAutoTable;
      currentY = lastTable2 ? lastTable2.finalY + 15 : currentY + 40;

      if (invertedAccounts.length > 0) {
          doc.setFontSize(12);
          doc.setTextColor(220, 38, 38);
          doc.text(`3. Alertas de Inconsistência (${invertedAccounts.length})`, 14, currentY);
          currentY += 5;

          runAutoTable({
              startY: currentY,
              head: [['Código', 'Conta', 'Saldo', 'Natureza']],
              body: invertedAccounts.map(acc => [acc.account_code, acc.account_name, formatCurrency(acc.final_balance), 'Invertida']),
              theme: 'striped',
              headStyles: { fillColor: [220, 38, 38] },
          });
      }

      doc.addPage();
      printHeader('Detalhamento Analítico de Contas');
      
      const tableData = accounts.filter(a => !a.is_synthetic).map(a => [
          a.account_code || '',
          a.account_name,
          a.type === 'Debit' ? 'Débito' : 'Crédito', // Added Type column
          formatCurrency(a.initial_balance),
          formatCurrency(a.debit_value),
          formatCurrency(a.credit_value),
          formatCurrency(a.final_balance)
      ]);

      runAutoTable({
          startY: 35,
          head: [['Código', 'Descrição da Conta', 'Tipo', 'Saldo Ant.', 'Débitos', 'Créditos', 'Saldo Atual']],
          body: tableData,
          theme: 'striped',
          headStyles: { fillColor: [50, 50, 50] },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: {
              0: { cellWidth: 20 },
              1: { cellWidth: 'auto' },
              2: { cellWidth: 15, halign: 'center' },
              3: { cellWidth: 25, halign: 'right' },
              4: { cellWidth: 25, halign: 'right' },
              5: { cellWidth: 25, halign: 'right' },
              6: { cellWidth: 25, halign: 'right' }
          },
          didDrawPage: (data: any) => {
              const str = 'Página ' + doc.internal.getNumberOfPages();
              doc.setFontSize(8);
              doc.text(str, pageWidth - 30, pageHeight - 10);
          }
      });

      return doc;
  };

  const handleDownloadPDF = () => {
      const doc = generatePDFDocument();
      const fileName = `AuditAI_${(headerData.companyName || 'Relatorio').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`;

      // HYBRID DOWNLOAD STRATEGY
      try {
          // Attempt 1: Standard .save() - Best for Chrome/Edge/Firefox
          doc.save(fileName);
      } catch (e) {
          console.warn("PDF Save failed, trying fallback...", e);
          // Attempt 2: Open in new window (Best for Safari/iOS to avoid WebKitBlobResource error)
          try {
              const blob = doc.output('blob');
              const url = URL.createObjectURL(blob);
              const newWindow = window.open(url, '_blank');
              if (!newWindow) {
                  alert("Pop-up bloqueado. Permita pop-ups para visualizar o PDF.");
              }
              // Cleanup after delay
              setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (e2) {
              alert("Erro ao gerar PDF.");
          }
      }
  };
  
  const handlePrint = () => {
      window.print();
  };

  const handleShare = async () => {
      const fileName = `AuditAI_${(headerData.companyName || 'Relatorio').replace(/\s+/g, '_')}.pdf`;
      const doc = generatePDFDocument();
      const blob = doc.output('blob');
      const file = new File([blob], fileName, { type: 'application/pdf' });

      // 1. Try Native Web Share API (Safari/Mobile)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
              await navigator.share({
                  title: 'Relatório de Auditoria AuditAI',
                  text: `Segue análise contábil de ${headerData.companyName}.\nResultado: ${finalResultValue >= 0 ? 'Lucro' : 'Prejuízo'} de ${formatCurrency(finalResultValue)}`,
                  files: [file]
              });
              return;
          } catch (e) {
              console.log("Web Share API canceled or failed", e);
          }
      }

      // 2. Fallback to Mailto (Desktop)
      // Note: We cannot programmatically attach files to mailto due to browser security restrictions.
      const subject = encodeURIComponent(`Relatório de Auditoria: ${headerData.companyName}`);
      const body = encodeURIComponent(`Olá,\n\nSegue resumo da análise contábil:\n\nEmpresa: ${headerData.companyName}\nResultado: ${finalResultValue >= 0 ? 'Lucro' : 'Prejuízo'} de ${formatCurrency(finalResultValue)}\n\n*OBSERVAÇÃO:* Por favor, anexe manualmente o arquivo PDF que será baixado agora.`);
      
      // Trigger PDF download first so the user has the file
      handleDownloadPDF();
      
      setTimeout(() => {
          window.location.href = `mailto:?subject=${subject}&body=${body}`;
          alert("O cliente de e-mail foi aberto. Por favor, anexe o PDF que foi baixado.");
      }, 500);
  };

  const exportPDFContent = (title: string, content: string) => {
      if (!content) return;
      try {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text(title, 14, 15);
        doc.setFontSize(10);
        const splitText = doc.splitTextToSize(content, 180);
        doc.text(splitText, 14, 25);
        doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
      } catch (err) {
        alert("Erro ao exportar conteúdo.");
      }
  };

  const handleExportIFRS = () => {
    try {
        const doc = new jsPDF();
        const runAutoTable = (options: any) => {
          if (typeof autoTable === 'function') autoTable(doc, options);
          else if (autoTable && typeof (autoTable as any).default === 'function') (autoTable as any).default(doc, options);
          else if (typeof (doc as any).autoTable === 'function') (doc as any).autoTable(options);
        };

        doc.setFontSize(16);
        doc.setTextColor(30, 64, 175);
        doc.text('Relatório DRE - Visão IFRS 18', 14, 20);
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Empresa: ${headerData.companyName || 'Não Identificada'}`, 14, 30);
        doc.text(`Período de Análise: ${summary.period || 'Indefinido'}`, 14, 36);

        let currentY = 45;

        Object.entries(ifrsGroups).forEach(([category, itemsRaw]) => {
             const items = itemsRaw as ExtractedAccount[];
             if (items.length === 0) return;
             
             const total = items.reduce((acc, curr) => acc + curr.total_value, 0);

             if (currentY > 250) { doc.addPage(); currentY = 20; }
             
             doc.setFontSize(12);
             doc.setTextColor(0);
             doc.text(`${category} (Total: ${formatCurrency(total)})`, 14, currentY);
             currentY += 4;

             runAutoTable({
                 startY: currentY,
                 head: [['Código', 'Conta', 'Saldo']],
                 body: items.map(i => [i.account_code || '', i.account_name, formatCurrency(i.total_value)]),
                 theme: 'grid',
                 headStyles: { fillColor: [67, 56, 202] }, // Indigo-700
                 styles: { fontSize: 8, cellPadding: 2 },
             });
             
             const lastTable = (doc as any).lastAutoTable;
             currentY = lastTable ? lastTable.finalY + 10 : currentY + 30;
        });
        
        doc.save(`DRE_IFRS_${(headerData.companyName || 'Relatorio').replace(/\s+/g, '_')}.pdf`);

    } catch (error) {
        console.error("Error generating IFRS PDF", error);
        alert("Erro ao gerar PDF IFRS.");
    }
  };

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
              <button onClick={handlePrint} className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-full border border-slate-600 transition-colors flex items-center gap-2 font-bold shadow-sm">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
                </svg>
                 Imprimir
              </button>
              
              <button onClick={handleShare} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-full border border-indigo-500 transition-colors flex items-center gap-2 font-bold shadow-sm">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                 Compartilhar por e-mail
              </button>

              <button onClick={handleDownloadPDF} className="text-xs bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full border border-white/30 transition-colors flex items-center gap-2 font-bold shadow-sm">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 12.75l-3-3m0 0l-3 3m3-3v7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                 Exportar PDF
              </button>
          </div>
        </div>
        
        {/* KEY METRICS GRID */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 print:grid-cols-2 print:gap-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                <p className="text-xs text-blue-600 font-bold uppercase tracking-wider">Débitos (Total)</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">{formatCurrency(summary.total_debits)}</p>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800">
                <p className="text-xs text-red-600 font-bold uppercase tracking-wider">Créditos (Total)</p>
                <p className="text-2xl font-bold text-red-900 dark:text-red-100 mt-1">{formatCurrency(summary.total_credits)}</p>
            </div>
            <div className={`p-4 rounded-lg border ${profitLossStyle.bg} ${profitLossStyle.border}`}>
                <p className={`text-xs font-bold uppercase tracking-wider ${profitLossStyle.text}`}>{finalResultLabel}</p>
                <p className={`text-2xl font-bold mt-1 ${profitLossStyle.text}`}>{formatCurrency(finalResultValue)}</p>
            </div>
            <div className={`p-4 rounded-lg border ${summary.is_balanced ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Conformidade</p>
                <div className="flex items-center gap-2 mt-1">
                    <span className={`text-lg font-bold ${summary.is_balanced ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {summary.is_balanced ? 'Balanceado' : 'Divergente'}
                    </span>
                    {summary.is_balanced 
                        ? <span className="text-emerald-600 bg-emerald-100 rounded-full px-2 text-xs">OK</span>
                        : <span className="text-rose-600 bg-rose-100 rounded-full px-2 text-xs font-mono">Diff: {formatCurrency(summary.discrepancy_amount)}</span>
                    }
                </div>
            </div>
        </div>
        
        {/* CONSOLIDATED INSIGHTS SECTION */}
        <div className="px-6 pb-6">
             <div className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-700 rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-600 flex items-center gap-2 bg-slate-100/50 dark:bg-slate-800">
                    <span className="text-xl">🧠</span>
                    <h3 className="font-bold text-slate-700 dark:text-white text-sm uppercase tracking-wide">Parecer da Auditoria Inteligente</h3>
                </div>
                <div className="p-5">
                    {summary.observations.length > 0 ? (
                        <div className="space-y-3">
                            {summary.observations.map((obs, i) => (
                                <div key={i} className="flex items-start gap-3">
                                    <div className="mt-1 min-w-[20px]">
                                        {obs.toLowerCase().includes('atenção') || obs.toLowerCase().includes('erro') 
                                            ? <span className="text-red-500 text-lg">⚠️</span> 
                                            : <span className="text-blue-500 text-lg">ℹ️</span>
                                        }
                                    </div>
                                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-600 shadow-sm w-full">
                                        {obs}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-slate-400">
                            <span className="text-2xl mb-2">✓</span>
                            <p className="text-sm italic">Nenhuma anomalia crítica ou observação relevante detectada automaticamente pela IA.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>

       {/* BALANCE SHEET SPECIFIC CHART (Stacked) */}
       {balanceSheetChartData && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden print:hidden mb-6">
             <div className="px-6 py-4 bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-100 dark:border-indigo-800">
                 <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                     <span>🏛️</span> Estrutura Patrimonial
                 </h3>
             </div>
             <div className="p-6 w-full h-[350px]">
                 <ResponsiveContainer width="100%" height="100%">
                     <BarChart data={balanceSheetChartData} layout="vertical" barSize={40} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                         <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                         <XAxis type="number" tickFormatter={(v) => new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v)} />
                         <YAxis dataKey="name" type="category" width={100} />
                         <Tooltip formatter={(value: number) => formatCurrency(value)} />
                         <Legend />
                         <Bar dataKey="Circulante" stackId="a" fill="#3b82f6" name="Circulante" />
                         <Bar dataKey="NaoCirculante" stackId="a" fill="#1d4ed8" name="Não Circulante" />
                         <Bar dataKey="PatrimonioLiquido" stackId="a" fill="#10b981" name="Patrimônio Líquido" />
                     </BarChart>
                 </ResponsiveContainer>
             </div>
          </div>
       )}

       {/* STANDARD CHART SECTION */}
       {isChartExpanded && (
          <div id="chart" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden print:hidden">
            <div className="px-6 py-4 bg-slate-100 dark:bg-slate-900 border-b dark:border-slate-700 flex justify-between items-center">
                <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2"><span>📈</span> Movimentação das Principais Contas</h3>
                <button onClick={() => setIsChartExpanded(!isChartExpanded)} className="text-slate-500 font-mono text-xl">{isChartExpanded ? '▼' : '▶'}</button>
            </div>
            <div className="p-6 w-full" style={{ height: 400 }}>
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                            <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} />
                            <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(value) => new Intl.NumberFormat('pt-BR', { notation: "compact" }).format(value)} />
                            <Tooltip formatter={(value: number) => formatCurrency(value)} />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Bar dataKey="initial" name="Saldo Anterior" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="final" name="Saldo Atual" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                        <p>Dados insuficientes para gerar o gráfico.</p>
                    </div>
                )}
            </div>
          </div>
       )}

      {/* TOOLS SECTION (EBITDA, CMV, SPED) */}
      <div id="valuation" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden print:hidden">
          <div className="px-6 py-4 bg-emerald-700 dark:bg-emerald-900 border-b dark:border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-white">Ferramentas Financeiras & Valuation (IA)</h3>
              <button onClick={() => setIsValuationExpanded(!isValuationExpanded)} className="text-white hover:text-emerald-200 font-mono text-xl">{isValuationExpanded ? '▼' : '▶'}</button>
          </div>
          {isValuationExpanded && (
            <div className="p-6 space-y-8">
                {/* TOOL 1: EBITDA */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-5">
                    <h4 className="font-bold text-emerald-800 dark:text-emerald-400 mb-4 flex items-center gap-2"><span className="text-xl">📊</span> EBITDA & Valuation</h4>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-1 space-y-4">
                            <textarea value={insightPrompt} onChange={(e) => setInsightPrompt(e.target.value)} className="w-full h-24 p-2 border rounded text-sm dark:bg-slate-700 dark:text-white resize-none" />
                            <button onClick={handleGenerateEBITDA} disabled={isEbitdaLoading} className="w-full py-2 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 disabled:opacity-50">
                                {isEbitdaLoading ? 'Calculando...' : '⚡ Calcular'}
                            </button>
                        </div>
                        <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-900/50 p-4 rounded border dark:border-slate-700 min-h-[200px]">
                             {ebitdaResult ? (
                                <div className="prose dark:prose-invert max-w-none text-sm">
                                    <pre className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300">{ebitdaResult}</pre>
                                    <button onClick={() => exportPDFContent('EBITDA', ebitdaResult)} className="mt-2 text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded">PDF</button>
                                </div>
                            ) : <p className="text-slate-400 text-sm">Resultados aparecerão aqui.</p>}
                        </div>
                    </div>
                </div>
            </div>
          )}
      </div>

      {/* DRE IFRS */}
      {summary.document_type === 'DRE' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden print:hidden border-indigo-200 dark:border-indigo-900">
             <div className="px-6 py-4 bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-100 dark:border-indigo-800 flex justify-between items-center">
                 <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Visão DRE - IFRS 18</h3>
                 <div className="flex items-center gap-3">
                     <div className="flex gap-1">
                         {/* ADDED SINGLE TOGGLE BUTTONS GROUP AS REQUESTED, ENSURING VISIBILITY */}
                         <button onClick={expandAllIFRS} disabled={!hasIFRSData} className="px-3 py-1.5 rounded-l bg-white border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-50 transition-colors">Expandir Tudo</button>
                         <button onClick={collapseAllIFRS} disabled={!hasIFRSData} className="px-3 py-1.5 rounded-r bg-white border-t border-b border-r border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-50 transition-colors">Recolher Tudo</button>
                     </div>
                     <button onClick={handleExportIFRS} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-bold shadow-sm hover:bg-indigo-700">Exportar PDF</button>
                 </div>
             </div>
             <div className="p-4 bg-indigo-50/30">
                 {Object.entries(ifrsGroups).map(([category, itemsRaw]) => {
                     const items = itemsRaw as ExtractedAccount[];
                     if (items.length === 0) return null;
                     const categoryTotal = items.reduce((sum, item) => sum + item.total_value, 0);
                     return (
                        <div key={category} className="border rounded-lg bg-white dark:bg-slate-800 mb-2 overflow-hidden shadow-sm">
                            <button onClick={() => toggleIFRSCategory(category as any)} className="w-full flex justify-between items-center p-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                                <span className="font-bold text-slate-800 dark:text-white uppercase text-sm">{category} ({items.length})</span>
                                <span className="font-mono font-bold">{formatCurrency(categoryTotal)}</span>
                            </button>
                            {expandedIFRSCategories[category as keyof typeof expandedIFRSCategories] && (
                                <div className="border-t dark:border-slate-700 p-2">
                                    {items.map(i => (
                                        <div key={i.account_name} className="flex justify-between text-xs py-1 px-2 border-b last:border-0 border-slate-100 dark:border-slate-700">
                                            <span>{i.account_name}</span>
                                            <span>{formatCurrency(i.total_value)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                     );
                 })}
             </div>
        </div>
      )}

      {/* ACCOUNT LIST TABLE */}
      <div id="accounts" className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
         <div className="px-6 py-4 border-b dark:border-slate-700 flex flex-wrap justify-between items-center gap-3">
            <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2">
                Detalhamento de Contas ({filteredAndSortedAccounts.length})
                
                {/* THEME SELECTOR UI */}
                <div className="relative inline-block text-left ml-2">
                    <button 
                        onClick={() => setShowThemeSettings(!showThemeSettings)} 
                        className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-600 flex items-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                        <span>🎨</span> Tema: {customTheme.name}
                    </button>
                    {showThemeSettings && (
                        <div className="absolute left-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl z-50 border border-slate-200 dark:border-slate-600 overflow-hidden ring-1 ring-black ring-opacity-5">
                            {DEFAULT_THEMES.map(t => (
                                <button 
                                    key={t.name} 
                                    onClick={() => applyTheme(t)} 
                                    className="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                                >
                                    <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: t.headerBg }}></div>
                                    {t.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </h3>
            
            <div className="flex flex-wrap gap-2">
                <button onClick={() => setShowCorrectedNames(!showCorrectedNames)} className="px-3 py-2 rounded text-sm border bg-white dark:bg-slate-700 dark:text-white hover:bg-slate-50">{showCorrectedNames ? 'Ver Original' : 'Ver Corrigidos'}</button>
                <button onClick={() => setShowSuggestionCol(!showSuggestionCol)} className="px-3 py-2 rounded text-sm border bg-white dark:bg-slate-700 dark:text-white hover:bg-slate-50">{showSuggestionCol ? 'Ocultar Sugestões' : 'Ver Sugestões'}</button>
            </div>
         </div>
         
         <div style={{'--theme-header-bg': customTheme.headerBg, '--theme-header-text': customTheme.headerText, '--theme-row-odd': customTheme.rowOddBg, '--theme-row-even': customTheme.rowEvenBg, '--theme-border': customTheme.border} as React.CSSProperties} className="overflow-auto max-h-[70vh]">
          <table className="min-w-full divide-y divide-[var(--theme-border)]">
            <thead className="bg-[var(--theme-header-bg)] sticky top-0 z-20 shadow-md">
              <tr>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-left text-xs font-medium uppercase">Código</th>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-left text-xs font-medium uppercase">Conta</th>
                <th style={{ color: 'var(--theme-header-text)' }} className="px-4 py-3 text-center text-xs font-medium uppercase">Tipo</th> {/* Added Type Column */}
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
                        const isOdd = index % 2 !== 0;
                        const rowStyle = { backgroundColor: isOdd ? 'var(--theme-row-odd)' : 'var(--theme-row-even)' };
                        
                        return (
                        <tr key={account.originalIndex} style={rowStyle} className={`hover:opacity-90 transition-colors duration-150 ${account.is_synthetic ? 'font-bold' : ''} ${account.possible_inversion && !account.is_synthetic ? 'bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500' : ''}`}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-blue-600 font-bold">
                             {account.account_code || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm dark:text-slate-800 relative">
                            <div style={{ paddingLeft: `${(account.level - 1) * 16}px` }}>
                                {showCorrectedNames ? getDisplayedName(account) : account.account_name}
                            </div>
                          </td>
                          {/* New Type Column Cell */}
                          <td className="px-4 py-3 text-center text-xs font-bold">
                              <span className={`px-2 py-1 rounded-full border ${account.type === 'Debit' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-red-100 text-red-800 border-red-200'}`}>
                                  {account.type === 'Debit' ? 'Débito' : 'Crédito'}
                              </span>
                          </td>
                          {showSuggestionCol && <td className="px-4 py-3 text-sm text-green-600 font-medium">{getSuggestionForAccount(account) || '-'}</td>}
                          <td className="px-4 py-3 text-right text-sm font-mono text-slate-600">{formatCurrency(account.initial_balance)}</td>
                          <td className="px-4 py-3 text-right text-sm text-blue-700 font-mono">{account.debit_value > 0 ? formatCurrency(account.debit_value) : '-'}</td>
                          <td className="px-4 py-3 text-right text-sm text-red-700 font-mono">{account.credit_value > 0 ? formatCurrency(account.credit_value) : '-'}</td>
                          <td className="px-4 py-3 text-right text-sm font-mono text-slate-800">{formatCurrency(account.final_balance)}</td>
                          <td className="px-4 py-3 text-center">{account.possible_inversion && !account.is_synthetic && <span className="text-yellow-600 font-bold text-lg">⚠️</span>}</td>
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