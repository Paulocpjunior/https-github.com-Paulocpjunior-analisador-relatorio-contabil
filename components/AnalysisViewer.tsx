
import React, { useState, useMemo, useEffect } from 'react';
import { AnalysisResult, ExtractedAccount, HeaderData } from '../types';
import { generateFinancialInsight, generateCMVAnalysis, generateSpedComplianceCheck } from '../services/geminiService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
  result: AnalysisResult;
  headerData: HeaderData;
  previousAccounts?: ExtractedAccount[];
  analysisTimestamp?: string | null;
}

const AnalysisViewer: React.FC<Props> = ({ result, headerData, previousAccounts, analysisTimestamp }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewTab, setViewTab] = useState<'dashboard' | 'bp' | 'dre' | 'list'>('dashboard');
  const [activeOpinionTab, setActiveOpinionTab] = useState<'financial' | 'costs' | 'compliance'>('financial');
  
  const formattedDate = analysisTimestamp 
    ? new Date(analysisTimestamp).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' })
    : new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' });

  const [opinions, setOpinions] = useState({ financial: '', costs: '', compliance: '' });
  const [loadingOpinions, setLoadingOpinions] = useState({ financial: false, costs: false, compliance: false });

  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const { summary, accounts = [], spell_check = [] } = result || {};

  // --- LOGIC: STRUCTURE BUILDER ---
  
  const financialStructure = useMemo(() => {
      const activeData = accounts.filter(a => !a.is_synthetic);

      // Helper to match account by code OR name keywords
      const match = (acc: ExtractedAccount, codes: string[], terms: string[]) => {
          const c = acc.account_code || '';
          const n = acc.account_name.toLowerCase();
          return codes.some(prefix => c.startsWith(prefix)) || terms.some(term => n.includes(term));
      };

      // --- BALANÇO PATRIMONIAL ---
      const balanco = {
          ativoCirculante: activeData.filter(a => match(a, ['1.1'], ['circulante', 'caixa', 'banco', 'cliente', 'estoque', 'adiantamento'])),
          ativoNaoCirculante: activeData.filter(a => match(a, ['1.2', '1.3', '1.4'], ['não circulante', 'nao circulante', 'imobilizado', 'intangivel', 'investimento'])),
          passivoCirculante: activeData.filter(a => match(a, ['2.1'], ['circulante', 'fornecedor', 'imposto', 'salario', 'obrigação'])),
          passivoNaoCirculante: activeData.filter(a => match(a, ['2.2'], ['não circulante', 'nao circulante', 'longo prazo', 'financiamento'])),
          patrimonioLiquido: activeData.filter(a => match(a, ['2.3', '2.4'], ['patrimônio', 'patrimonio', 'capital', 'reservas', 'lucros acumulados', 'prejuízos acumulados']))
      };

      // Sums
      const sum = (list: ExtractedAccount[]) => list.reduce((acc, item) => acc + Math.abs(item.final_balance), 0);
      
      const bpTotals = {
          ac: sum(balanco.ativoCirculante),
          anc: sum(balanco.ativoNaoCirculante),
          pc: sum(balanco.passivoCirculante),
          pnc: sum(balanco.passivoNaoCirculante),
          pl: sum(balanco.patrimonioLiquido)
      };
      
      const totalAtivo = bpTotals.ac + bpTotals.anc;
      const totalPassivo = bpTotals.pc + bpTotals.pnc + bpTotals.pl;
      
      if (bpTotals.pl === 0 && Math.abs(totalAtivo - totalPassivo) > 1) {
          bpTotals.pl = totalAtivo - (bpTotals.pc + bpTotals.pnc);
      }

      // --- DRE (INCOME STATEMENT) ---
      const dre = {
          receitaBruta: activeData.filter(a => (a.account_code?.startsWith('3.1') || match(a, [], ['receita bruta', 'venda de', 'faturamento', 'serviços prestados'])) && a.type === 'Credit'),
          deducoes: activeData.filter(a => match(a, [], ['imposto sobre', 'devoluç', 'cancelamento', 'abatimento']) || (a.account_name.includes('Simples') && a.type === 'Debit')),
          custos: activeData.filter(a => match(a, ['3.2', '3.3'], ['custo', 'cmv', 'cpv', 'csv'])),
          despesasOp: activeData.filter(a => (a.account_code?.startsWith('3') || a.account_code?.startsWith('4')) && match(a, ['4'], ['despesa', 'salário', 'aluguel', 'energia', 'água', 'luz', 'telefone', 'honorários', 'pro labore']) && !match(a, [], ['custo', 'cmv', 'imposto sobre', 'financeir'])),
          financeiro: activeData.filter(a => match(a, [], ['juros', 'financeira', 'bancária', 'iof', 'desconto', 'variação cambial']))
      };

      const dreTotals = {
          receitaBruta: sum(dre.receitaBruta),
          deducoes: sum(dre.deducoes),
          custos: sum(dre.custos),
          despesas: sum(dre.despesasOp),
          financeiro: sum(dre.financeiro)
      };
      
      const recLiq = dreTotals.receitaBruta - dreTotals.deducoes;
      const lucroBruto = recLiq - dreTotals.custos;
      const resultadoOp = lucroBruto - dreTotals.despesas - dreTotals.financeiro;

      return { balanco, bpTotals, dre, dreTotals, calculatedResult: resultadoOp };
  }, [accounts]);

  // --- ACTIONS ---

  const handlePrint = () => window.print();

  const handleShare = async () => {
    const shareData = {
        title: `Auditoria: ${headerData.companyName}`,
        text: `Relatório de Análise Contábil - SP Assessoria.\nEmpresa: ${headerData.companyName}\nOperador: ${headerData.collaboratorName}\nData: ${formattedDate}\nResultado: ${formatCurrency(financialStructure.calculatedResult)}`,
        url: window.location.href
    };
    try {
        if (navigator.share) await navigator.share(shareData);
        else { await navigator.clipboard.writeText(shareData.text); alert("Dados copiados para a área de transferência!"); }
    } catch (err) { console.error(err); }
  };

  // Shared Header Logic for PDFs
  const drawPDFHeader = (doc: jsPDF, pageWidth: number) => {
      doc.setFillColor(15, 23, 42); // Primary Color
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("SP ASSESSORIA CONTÁBIL", 14, 15);
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Relatório de Auditoria Digital`, 14, 22);
      
      // Metadata Column 1
      doc.text(`Cliente: ${headerData.companyName}`, 14, 30);
      doc.text(`CNPJ: ${headerData.cnpj}`, 14, 35);

      // Metadata Column 2 (Right Aligned context)
      doc.text(`Emissão: ${formattedDate}`, 120, 30);
      doc.text(`Operador: ${headerData.collaboratorName || 'Não Identificado'}`, 120, 35);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;

    drawPDFHeader(doc, pageWidth);
    
    let y = 50;

    // Summary Section
    doc.setTextColor(0,0,0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo Executivo do Resultado (D.R.E.)", 14, y);
    y += 10;

    // Explicit DRE Columns as requested
    const tableBody: any[] = [];
    
    const addSection = (title: string, items: ExtractedAccount[], total: number) => {
        // Section Header
        tableBody.push([{ 
            content: title.toUpperCase(), 
            colSpan: 4, 
            styles: { fontStyle: 'bold', fillColor: [240, 240, 240], textColor: [0,0,0] } 
        }]);
        
        // Items
        items.forEach(acc => {
            tableBody.push([
                acc.account_name,
                acc.debit_value > 0 ? formatCurrency(acc.debit_value) : '-',
                acc.credit_value > 0 ? formatCurrency(acc.credit_value) : '-',
                { 
                    content: formatCurrency(acc.final_balance), 
                    styles: { textColor: acc.final_balance < 0 ? [220, 50, 50] : [0, 0, 0] } 
                }
            ]);
        });
        
        // Section Total
        tableBody.push([
            { content: `Total ${title}`, colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
            { content: formatCurrency(total), styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } }
        ]);
    };

    addSection('Receita Bruta', financialStructure.dre.receitaBruta, financialStructure.dreTotals.receitaBruta);
    addSection('Deduções', financialStructure.dre.deducoes, -financialStructure.dreTotals.deducoes);
    addSection('Custos (CMV)', financialStructure.dre.custos, -financialStructure.dreTotals.custos);
    addSection('Despesas Operacionais', financialStructure.dre.despesasOp, -financialStructure.dreTotals.despesas);
    addSection('Resultado Financeiro', financialStructure.dre.financeiro, -financialStructure.dreTotals.financeiro);
    
    // Final Result Row
    tableBody.push([
        { content: 'RESULTADO LÍQUIDO DO EXERCÍCIO', colSpan: 3, styles: { fillColor: [15, 23, 42], textColor: [255,255,255], fontStyle: 'bold', halign: 'right', fontSize: 10 } },
        { content: formatCurrency(financialStructure.calculatedResult), styles: { fillColor: [15, 23, 42], textColor: [255,255,255], fontStyle: 'bold', fontSize: 10 } }
    ]);

    autoTable(doc, {
        startY: y,
        head: [['Conta / Descrição', 'Débito', 'Crédito', 'Lucro/Prejuízo']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], halign: 'center' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 30, halign: 'right' },
            2: { cellWidth: 30, halign: 'right' },
            3: { cellWidth: 35, halign: 'right', fontStyle: 'bold' }
        },
        didDrawPage: (data) => {
            // Footer on every page
            const pageSize = doc.internal.pageSize;
            const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`Página ${data.pageNumber} - Gerado por SP Assessoria System`, 14, pageHeight - 10);
            doc.text(`${formattedDate}`, pageWidth - 40, pageHeight - 10, { align: 'right' });
        }
    });

    doc.save(`DRE_${headerData.companyName}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleExportOpinionPDF = () => {
      const currentOpinion = opinions[activeOpinionTab];
      if (!currentOpinion) {
          alert("O parecer ainda não foi gerado. Aguarde a conclusão da análise da IA.");
          return;
      }

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const marginX = 14;
      const marginBottom = 20; // Space for footer

      // Helper for Footer
      const drawFooter = (pageNum: number, totalPages: number) => {
           doc.setFontSize(8);
           doc.setTextColor(150);
           doc.text(`Página ${pageNum} de ${totalPages} - Gerado por SP Assessoria System`, marginX, pageHeight - 10);
           doc.text(`${formattedDate}`, pageWidth - marginX, pageHeight - 10, { align: 'right' });
      };
      
      // Page 1 Setup
      drawPDFHeader(doc, pageWidth);

      let y = 50;

      // Title based on active tab
      const titles: Record<string, string> = {
          'financial': 'Parecer de Saúde Financeira e Contábil',
          'costs': 'Análise de Custos e CMV (IFRS)',
          'compliance': 'Auditoria Fiscal e Compliance SPED'
      };
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(titles[activeOpinionTab] || 'Parecer Contábil', marginX, y);
      
      y += 10;
      
      // Content Text Processing
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(20);
      
      // Split text into lines that fit the width
      const splitText = doc.splitTextToSize(currentOpinion, pageWidth - (marginX * 2));
      const lineHeight = 6;
      
      // Loop through lines to handle pagination
      for (let i = 0; i < splitText.length; i++) {
          // Check if we reached the bottom margin
          if (y > pageHeight - marginBottom) {
              doc.addPage();
              drawPDFHeader(doc, pageWidth); // Re-draw header on new pages
              y = 50; // Reset Y position
          }
          doc.text(splitText[i], marginX, y);
          y += lineHeight;
      }
      
      // Apply Footers to ALL pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
          doc.setPage(i);
          drawFooter(i, totalPages);
      }

      doc.save(`Parecer_${activeOpinionTab}_${headerData.companyName}.pdf`);
  };

  // --- OPINIONS FETCH ---
  const fetchOpinion = async (type: 'financial' | 'costs' | 'compliance') => {
      if (opinions[type] || loadingOpinions[type]) return;
      setLoadingOpinions(prev => ({ ...prev, [type]: true }));
      try {
          let res = '';
          if (type === 'financial') res = await generateFinancialInsight(result, "Parecer financeiro completo.", 5);
          else if (type === 'costs') res = await generateCMVAnalysis(result, "IFRS");
          else res = await generateSpedComplianceCheck(result);
          setOpinions(prev => ({ ...prev, [type]: res }));
      } catch (e) { console.error(e); }
      finally { setLoadingOpinions(prev => ({ ...prev, [type]: false })); }
  };

  useEffect(() => { fetchOpinion(activeOpinionTab); }, [activeOpinionTab]);

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    if (!searchTerm) return accounts;
    const s = searchTerm.toLowerCase();
    return accounts.filter(a => a.account_name.toLowerCase().includes(s) || (a.account_code && a.account_code.toLowerCase().includes(s)));
  }, [accounts, searchTerm]);

  // --- RENDERERS ---

  const findCorrection = (name: string) => {
      if (!spell_check || spell_check.length === 0) return null;
      return spell_check.find(s => name.toLowerCase().includes(s.original_term.toLowerCase()));
  };

  // Improved DRE Row Renderer
  const renderDRERow = (account: ExtractedAccount) => {
      const correction = findCorrection(account.account_name);
      // Visual Alert for Inversions
      const isInverted = account.possible_inversion;

      return (
          <tr key={account.account_code || Math.random()} className={`text-xs border-b dark:border-slate-800 transition-colors ${isInverted ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 border-l-4 border-l-amber-500' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
              <td className="pl-4 pr-2 py-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 flex-wrap">
                        {isInverted && (
                            <span title="Possível inversão de natureza" className="text-amber-500">⚠️</span>
                        )}
                        <span className={correction ? "line-through opacity-50 decoration-red-500" : "font-medium text-slate-700 dark:text-slate-300"}>
                            {account.account_name}
                        </span>
                        {correction && (
                            <span className="text-[10px] text-amber-600 bg-amber-50 px-1 border border-amber-200 rounded">
                                {correction.suggested_correction}
                            </span>
                        )}
                    </div>
                    {account.account_code && <span className="text-[10px] text-slate-400 font-mono mt-0.5">{account.account_code}</span>}
                  </div>
              </td>
              <td className="px-2 py-3 text-right font-mono text-slate-500 border-r dark:border-slate-700">
                  {account.debit_value > 0 ? formatCurrency(account.debit_value) : '-'}
              </td>
              <td className="px-2 py-3 text-right font-mono text-slate-500 border-r dark:border-slate-700">
                  {account.credit_value > 0 ? formatCurrency(account.credit_value) : '-'}
              </td>
              <td className={`px-4 py-3 text-right font-mono font-bold ${account.final_balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCurrency(account.final_balance)}
              </td>
          </tr>
      );
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-20">
      
      {/* HEADER ACTIONS (Global for All Tabs) */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
              <h2 className="text-2xl font-black text-slate-800 dark:text-white">{headerData.companyName}</h2>
              <div className="flex gap-3 text-sm text-slate-500 flex-wrap">
                  <span className="font-mono">{headerData.cnpj}</span>
                  <span>•</span>
                  <span>Operador: <strong>{headerData.collaboratorName}</strong></span>
                  <span>•</span>
                  <span>{formattedDate}</span>
              </div>
          </div>
          {/* GLOBAL FUNCTIONAL BUTTONS */}
          <div className="flex gap-2 print:hidden">
              <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg font-bold text-xs hover:bg-slate-200 text-slate-700 dark:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  Imprimir
              </button>
              <button onClick={handleShare} className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg font-bold text-xs hover:bg-slate-200 text-slate-700 dark:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                  Compartilhar
              </button>
              <button onClick={handleExportPDF} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-transform active:scale-95">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Exportar PDF
              </button>
          </div>
      </div>

      {/* TABS NAVIGATION */}
      <div className="flex overflow-x-auto gap-2 pb-2 print:hidden">
          {[
              { id: 'dashboard', label: '📊 Dashboard', desc: 'Visão Geral' },
              { id: 'dre', label: '📉 D.R.E.', desc: 'Resultado (4 Colunas)' },
              { id: 'bp', label: '⚖️ Balanço', desc: 'Patrimonial' },
              { id: 'list', label: '📑 Razão', desc: 'Lista Completa' },
          ].map(tab => (
              <button
                  key={tab.id}
                  onClick={() => setViewTab(tab.id as any)}
                  className={`flex-1 min-w-[140px] p-4 rounded-xl border text-left transition-all ${
                      viewTab === tab.id 
                      ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30' 
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
              >
                  <span className="block font-black text-sm uppercase tracking-wide">{tab.label}</span>
                  <span className={`text-xs ${viewTab === tab.id ? 'text-blue-100' : 'text-slate-400'}`}>{tab.desc}</span>
              </button>
          ))}
      </div>

      {/* === DASHBOARD TAB === */}
      {viewTab === 'dashboard' && (
          <div className="space-y-6 animate-fadeIn">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                        <p className="text-xs font-bold text-slate-400 uppercase">Receita Bruta Est.</p>
                        <p className="text-xl font-black text-blue-600 mt-1">{formatCurrency(financialStructure.dreTotals.receitaBruta)}</p>
                    </div>
                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                        <p className="text-xs font-bold text-slate-400 uppercase">Total Ativo</p>
                        <p className="text-xl font-black text-slate-800 dark:text-white mt-1">{formatCurrency(financialStructure.bpTotals.ac + financialStructure.bpTotals.anc)}</p>
                    </div>
                    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                        <p className="text-xs font-bold text-slate-400 uppercase">Patrimônio Líquido</p>
                        <p className="text-xl font-black text-emerald-600 mt-1">{formatCurrency(financialStructure.bpTotals.pl)}</p>
                    </div>
                    {/* RESULTADO EVIDENCIADO */}
                    <div className={`p-5 rounded-2xl shadow-md border-2 transform transition-transform hover:scale-105 ${financialStructure.calculatedResult >= 0 ? 'bg-gradient-to-br from-green-50 to-white border-green-200 dark:from-green-900/40 dark:to-slate-800 dark:border-green-800' : 'bg-gradient-to-br from-red-50 to-white border-red-200 dark:from-red-900/40 dark:to-slate-800 dark:border-red-800'}`}>
                        <p className={`text-xs font-bold uppercase flex items-center gap-1 ${financialStructure.calculatedResult >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {financialStructure.calculatedResult >= 0 ? '📈 Lucro do Período' : '📉 Prejuízo do Período'}
                        </p>
                        <p className={`text-2xl font-black mt-1 ${financialStructure.calculatedResult >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {formatCurrency(financialStructure.calculatedResult)}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                     {/* OPINION SECTION */}
                     <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
                        <div className="flex flex-col md:flex-row border-b dark:border-slate-700">
                            <div className="flex-1 flex">
                                <button onClick={() => setActiveOpinionTab('financial')} className={`flex-1 p-4 text-xs font-bold uppercase ${activeOpinionTab === 'financial' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400'}`}>Saúde Financeira</button>
                                <button onClick={() => setActiveOpinionTab('costs')} className={`flex-1 p-4 text-xs font-bold uppercase ${activeOpinionTab === 'costs' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400'}`}>Custos (CMV)</button>
                                <button onClick={() => setActiveOpinionTab('compliance')} className={`flex-1 p-4 text-xs font-bold uppercase ${activeOpinionTab === 'compliance' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400'}`}>Fiscal/SPED</button>
                            </div>
                            <div className="p-2 flex items-center justify-end border-l border-slate-100 dark:border-slate-700">
                                <button 
                                    onClick={handleExportOpinionPDF}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                                    title="Baixar este parecer em PDF para enviar ao cliente"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    Exportar Parecer
                                </button>
                            </div>
                        </div>
                        <div className="p-6 min-h-[200px]">
                            {loadingOpinions[activeOpinionTab] ? (
                                <div className="flex flex-col items-center justify-center h-full space-y-3">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-600"></div>
                                    <p className="text-xs text-slate-400 animate-pulse">Gerando análise com IA...</p>
                                </div>
                            ) : (
                                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                                    {opinions[activeOpinionTab]}
                                </p>
                            )}
                        </div>
                     </div>

                     {/* CHART */}
                     <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4">
                         <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 text-center">Estrutura Patrimonial</h3>
                         <div className="h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={[
                                    { name: 'Ativo', Circulante: financialStructure.bpTotals.ac, Fixo: financialStructure.bpTotals.anc },
                                    { name: 'Passivo', Circulante: financialStructure.bpTotals.pc, Fixo: financialStructure.bpTotals.pnc + financialStructure.bpTotals.pl }
                                ]}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" tick={{fontSize: 10}} />
                                    <YAxis hide />
                                    <Tooltip formatter={(val: number) => formatCurrency(val)} />
                                    <Legend />
                                    <Bar dataKey="Circulante" stackId="a" fill="#3b82f6" barSize={40} />
                                    <Bar dataKey="Fixo" stackId="a" fill="#1e40af" barSize={40} />
                                </BarChart>
                            </ResponsiveContainer>
                         </div>
                     </div>
                </div>
          </div>
      )}

      {/* === DRE TAB (UPDATED LAYOUT WITH 4 COLUMNS) === */}
      {viewTab === 'dre' && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden animate-fadeIn">
             
             {/* DRE Specific Toolbar */}
             <div className="bg-slate-50 dark:bg-slate-900/50 p-4 border-b dark:border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
                 <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                     D.R.E.
                     <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase">Visualização Detalhada (4 Colunas)</span>
                 </h3>
             </div>

             {/* DRE TABLE */}
             <div className="overflow-x-auto">
                 <table className="w-full text-sm">
                     <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-xs uppercase font-bold sticky top-0 z-10">
                         <tr>
                             <th className="px-4 py-3 text-left w-1/2">Conta / Descrição</th>
                             <th className="px-2 py-3 text-right bg-slate-200/50 dark:bg-slate-800">Débito</th>
                             <th className="px-2 py-3 text-right bg-slate-200/50 dark:bg-slate-800">Crédito</th>
                             <th className="px-4 py-3 text-right">Lucro/Prejuízo (Saldo)</th>
                         </tr>
                     </thead>
                     <tbody className="divide-y dark:divide-slate-700">
                         {/* Receitas */}
                         <tr className="bg-slate-50 dark:bg-slate-900/30 font-bold text-blue-700 dark:text-blue-400">
                             <td className="px-4 py-2" colSpan={3}>1. RECEITA OPERACIONAL BRUTA</td>
                             <td className="px-4 py-2 text-right">{formatCurrency(financialStructure.dreTotals.receitaBruta)}</td>
                         </tr>
                         {financialStructure.dre.receitaBruta.map(a => renderDRERow(a))}

                         {/* Deduções */}
                         <tr className="bg-slate-50 dark:bg-slate-900/30 font-bold text-slate-600 dark:text-slate-400">
                             <td className="px-4 py-2" colSpan={3}>2. (-) DEDUÇÕES DA RECEITA</td>
                             <td className="px-4 py-2 text-right text-red-500">({formatCurrency(financialStructure.dreTotals.deducoes)})</td>
                         </tr>
                         {financialStructure.dre.deducoes.map(a => renderDRERow(a))}

                         {/* Receita Líquida */}
                         <tr className="bg-blue-50 dark:bg-blue-900/20 font-black text-slate-800 dark:text-white border-t border-b border-blue-100 dark:border-blue-900">
                             <td className="px-4 py-3 text-right uppercase" colSpan={3}>(=) Receita Líquida</td>
                             <td className="px-4 py-3 text-right">{formatCurrency(financialStructure.dreTotals.receitaBruta - financialStructure.dreTotals.deducoes)}</td>
                         </tr>

                         {/* Custos */}
                         <tr className="bg-slate-50 dark:bg-slate-900/30 font-bold text-slate-600 dark:text-slate-400">
                             <td className="px-4 py-2" colSpan={3}>3. (-) CUSTOS (CMV/CPV/CSP)</td>
                             <td className="px-4 py-2 text-right text-red-500">({formatCurrency(financialStructure.dreTotals.custos)})</td>
                         </tr>
                         {financialStructure.dre.custos.map(a => renderDRERow(a))}

                         {/* Lucro Bruto */}
                         <tr className="bg-emerald-50 dark:bg-emerald-900/20 font-black text-emerald-800 dark:text-emerald-300 border-t border-b border-emerald-100 dark:border-emerald-900">
                             <td className="px-4 py-3 text-right uppercase" colSpan={3}>(=) Lucro Bruto</td>
                             <td className="px-4 py-3 text-right">{formatCurrency(financialStructure.dreTotals.receitaBruta - financialStructure.dreTotals.deducoes - financialStructure.dreTotals.custos)}</td>
                         </tr>

                         {/* Despesas */}
                         <tr className="bg-slate-50 dark:bg-slate-900/30 font-bold text-slate-600 dark:text-slate-400">
                             <td className="px-4 py-2" colSpan={3}>4. (-) DESPESAS OPERACIONAIS</td>
                             <td className="px-4 py-2 text-right text-red-500">({formatCurrency(financialStructure.dreTotals.despesas)})</td>
                         </tr>
                         {financialStructure.dre.despesasOp.map(a => renderDRERow(a))}

                         {/* Financeiro */}
                         <tr className="bg-slate-50 dark:bg-slate-900/30 font-bold text-slate-600 dark:text-slate-400">
                             <td className="px-4 py-2" colSpan={3}>5. (-) RESULTADO FINANCEIRO</td>
                             <td className="px-4 py-2 text-right text-red-500">({formatCurrency(financialStructure.dreTotals.financeiro)})</td>
                         </tr>
                         {financialStructure.dre.financeiro.map(a => renderDRERow(a))}

                         {/* Resultado Final - EVIDENCIADO */}
                         <tr className={`text-lg font-black border-t-4 border-slate-900 ${financialStructure.calculatedResult >= 0 ? 'bg-green-100 dark:bg-green-900 text-green-900 dark:text-white' : 'bg-red-100 dark:bg-red-900 text-red-900 dark:text-white'}`}>
                             <td className="px-4 py-5 text-right uppercase tracking-wider" colSpan={3}>
                                 {financialStructure.calculatedResult >= 0 ? '(=) LUCRO LÍQUIDO DO PERÍODO' : '(=) PREJUÍZO LÍQUIDO DO PERÍODO'}
                             </td>
                             <td className="px-4 py-5 text-right">{formatCurrency(financialStructure.calculatedResult)}</td>
                         </tr>
                     </tbody>
                 </table>
             </div>
          </div>
      )}

      {/* === BALANÇO TAB === */}
      {viewTab === 'bp' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">
              {/* ATIVO */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="bg-blue-600 p-4 text-white font-bold flex justify-between">
                      <span>ATIVO</span>
                      <span>{formatCurrency(financialStructure.bpTotals.ac + financialStructure.bpTotals.anc)}</span>
                  </div>
                  <div className="p-4 space-y-4">
                      <div>
                          <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300 border-b dark:border-slate-600 pb-2 mb-2">
                              <span>Circulante</span>
                              <span>{formatCurrency(financialStructure.bpTotals.ac)}</span>
                          </div>
                          <div className="space-y-1">
                              {financialStructure.balanco.ativoCirculante.slice(0, 8).map((a, i) => (
                                  <div key={i} className="flex justify-between text-xs text-slate-500">
                                      <span className="truncate pr-2">{a.account_name}</span>
                                      <span>{formatCurrency(a.final_balance)}</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                      <div>
                          <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300 border-b dark:border-slate-600 pb-2 mb-2">
                              <span>Não Circulante</span>
                              <span>{formatCurrency(financialStructure.bpTotals.anc)}</span>
                          </div>
                          <div className="space-y-1">
                             {financialStructure.balanco.ativoNaoCirculante.slice(0, 8).map((a, i) => (
                                  <div key={i} className="flex justify-between text-xs text-slate-500">
                                      <span className="truncate pr-2">{a.account_name}</span>
                                      <span>{formatCurrency(a.final_balance)}</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>

              {/* PASSIVO */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="bg-red-600 p-4 text-white font-bold flex justify-between">
                      <span>PASSIVO + PL</span>
                      <span>{formatCurrency(financialStructure.bpTotals.pc + financialStructure.bpTotals.pnc + financialStructure.bpTotals.pl)}</span>
                  </div>
                   <div className="p-4 space-y-4">
                      <div>
                          <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300 border-b dark:border-slate-600 pb-2 mb-2">
                              <span>Circulante</span>
                              <span>{formatCurrency(financialStructure.bpTotals.pc)}</span>
                          </div>
                          <div className="space-y-1">
                             {financialStructure.balanco.passivoCirculante.slice(0, 8).map((a, i) => (
                                  <div key={i} className="flex justify-between text-xs text-slate-500">
                                      <span className="truncate pr-2">{a.account_name}</span>
                                      <span>{formatCurrency(a.final_balance)}</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                      <div>
                          <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300 border-b dark:border-slate-600 pb-2 mb-2">
                              <span>Não Circulante</span>
                              <span>{formatCurrency(financialStructure.bpTotals.pnc)}</span>
                          </div>
                           <div className="space-y-1">
                             {financialStructure.balanco.passivoNaoCirculante.slice(0, 8).map((a, i) => (
                                  <div key={i} className="flex justify-between text-xs text-slate-500">
                                      <span className="truncate pr-2">{a.account_name}</span>
                                      <span>{formatCurrency(a.final_balance)}</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                      <div>
                          <div className="flex justify-between font-bold text-emerald-600 border-b dark:border-slate-600 pb-2 mb-2">
                              <span>Patrimônio Líquido</span>
                              <span>{formatCurrency(financialStructure.bpTotals.pl)}</span>
                          </div>
                           <div className="space-y-1">
                             {financialStructure.balanco.patrimonioLiquido.map((a, i) => (
                                  <div key={i} className="flex justify-between text-xs text-slate-500">
                                      <span className="truncate pr-2">{a.account_name}</span>
                                      <span>{formatCurrency(a.final_balance)}</span>
                                  </div>
                              ))}
                              {financialStructure.balanco.patrimonioLiquido.length === 0 && (
                                  <div className="flex justify-between text-xs text-slate-400 italic">
                                      <span>Resultado do Período (Implícito)</span>
                                      <span>{formatCurrency(financialStructure.bpTotals.pl)}</span>
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* === LIST VIEW (Original) === */}
      {viewTab === 'list' && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-fadeIn">
            <div className="px-6 py-4 border-b dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                <h3 className="font-bold text-slate-700 dark:text-slate-300">Lista Completa de Contas</h3>
                <input 
                    type="text" 
                    placeholder="Filtrar..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="p-2 text-xs rounded border dark:bg-slate-700 dark:text-white"
                />
            </div>
            <div className="overflow-auto max-h-[600px]">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 dark:bg-slate-900 sticky top-0 z-10">
                        <tr>
                            <th className="p-3">Código</th>
                            <th className="p-3">Conta</th>
                            <th className="p-3 text-right">Saldo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-slate-700">
                        {filteredAccounts.map((account, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                                <td className="p-3 text-xs font-mono text-slate-500">{account.account_code}</td>
                                <td className="p-3">{account.account_name}</td>
                                <td className={`p-3 text-right font-mono ${account.final_balance < 0 ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}`}>
                                    {formatCurrency(account.final_balance)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}
      
      <div className="bg-slate-900 py-3 px-8 text-right border-t border-slate-800 rounded-b-lg">
             <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em]">desenvolvido by - SP Assessoria Contabil.</span>
      </div>
    </div>
  );
};

export default AnalysisViewer;
