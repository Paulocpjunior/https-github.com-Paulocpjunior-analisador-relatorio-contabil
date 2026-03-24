import React, { useState, useMemo } from 'react';
import { ConsolidationResult } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ConsolidatedDashboard from './ConsolidatedDashboard';

interface Props {
    data: ConsolidationResult;
    onBack: () => void;
    collaboratorName: string;
}

// Detecta o tipo de documento com base nos códigos de conta presentes
export const detectDocType = (data: ConsolidationResult): 'BALANCETE' | 'DRE' | 'BALANÇO' | 'CONSOLIDAÇÃO' => {
    const codes = data.rows.map(r => r.code).filter(Boolean);
    const hasAssets    = codes.some(c => /^1[.\-]/.test(c) || c === '1');
    const hasLiab      = codes.some(c => /^2[.\-]/.test(c) || c === '2');
    const hasRevenue   = codes.some(c => /^3[.\-]/.test(c) || c === '3');
    const hasExpense   = codes.some(c => /^[456][.\-]/.test(c));
    const hasCash      = codes.some(c => /^1\.1\.1/.test(c));

    if (hasAssets && hasLiab && hasCash) return 'BALANCETE';
    if (hasAssets && hasLiab && !hasRevenue) return 'BALANÇO';
    if (hasRevenue && hasExpense && !hasAssets) return 'DRE';
    return 'CONSOLIDAÇÃO';
};

const DOC_LABELS: Record<string, { title: string; badge: string; color: string }> = {
    BALANCETE:    { title: 'Consolidação de Balancetes',    badge: 'BALANCETE', color: 'bg-blue-600'   },
    DRE:          { title: 'Consolidação de DREs',          badge: 'DRE',       color: 'bg-green-600'  },
    'BALANÇO':    { title: 'Consolidação de Balanços',      badge: 'BALANÇO',   color: 'bg-indigo-600' },
    CONSOLIDAÇÃO: { title: 'Consolidação do Grupo',         badge: 'GRUPO',     color: 'bg-purple-600' },
};

const ConsolidationViewer: React.FC<Props> = ({ data, onBack, collaboratorName }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [viewTab, setViewTab] = useState<'dashboard' | 'table'>('table');

    const docType = useMemo(() => detectDocType(data), [data]);
    const label   = DOC_LABELS[docType] ?? DOC_LABELS['CONSOLIDAÇÃO'];

    const formatCurrency = (value: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

    const formattedDate = new Date(data.generatedAt).toLocaleString('pt-BR', {
        dateStyle: 'long', timeStyle: 'medium'
    });

    const filteredRows = data.rows.filter(r =>
        r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.code.includes(searchTerm)
    );

    // KPI summary: soma das contas sintéticas de nível 1
    const kpis = useMemo(() => {
        if (docType === 'BALANCETE' || docType === 'BALANÇO') {
            const ativo    = data.rows.find(r => r.code === '1' || r.name.toUpperCase() === 'ATIVO');
            const passivo  = data.rows.find(r => r.code === '2' || r.name.toUpperCase() === 'PASSIVO');
            const pl       = data.rows.find(r => r.code === '3' || r.name.toUpperCase().includes('PATRIMÔNIO'));
            return [
                { label: 'Ativo Total',          value: ativo?.total    ?? 0, color: 'text-blue-600'   },
                { label: 'Passivo Total',         value: passivo?.total  ?? 0, color: 'text-red-600'    },
                { label: 'Patrimônio Líquido',    value: pl?.total       ?? 0, color: 'text-emerald-600'},
                { label: 'Empresas Consolidadas', value: data.companies.length, isCount: true, color: 'text-purple-600' },
            ];
        }
        const receita  = data.rows.find(r => r.code === '3' || r.name.toUpperCase().includes('RECEITA BRUTA'));
        const despesa  = data.rows.find(r => r.code === '4' || r.name.toUpperCase().includes('CUSTO'));
        const resultado = data.rows.find(r =>
            r.name.toLowerCase().includes('lucro líquido') ||
            r.name.toLowerCase().includes('resultado do exercício') ||
            r.name.toLowerCase().includes('prejuízo líquido')
        );
        return [
            { label: 'Receita Total',         value: receita?.total   ?? 0, color: 'text-emerald-600' },
            { label: 'Despesas/Custos',        value: despesa?.total   ?? 0, color: 'text-red-600'     },
            { label: 'Resultado do Período',   value: resultado?.total ?? 0, color: resultado && resultado.total >= 0 ? 'text-emerald-600' : 'text-red-600' },
            { label: 'Empresas Consolidadas',  value: data.companies.length, isCount: true, color: 'text-purple-600' },
        ];
    }, [data, docType]);

    const handleExportPDF = () => {
        const doc = new jsPDF('l');
        const pageWidth = doc.internal.pageSize.width;

        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('SP ASSESSORIA CONTÁBIL', 14, 15);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Relatório de Consolidação — ${label.title} (Grupo Econômico)`, 14, 22);
        doc.text(`Empresas: ${data.companies.length} Entidades`, 14, 30);
        doc.text(`Grupo Base: ${data.groupName}`, 14, 35);
        doc.text(`Emissão: ${formattedDate}`, pageWidth - 14, 30, { align: 'right' });
        doc.text(`Operador: ${collaboratorName || 'Não Identificado'}`, pageWidth - 14, 35, { align: 'right' });

        const headRow = ['Código', 'Conta', ...data.companies.map(c => c.name.substring(0, 15) + '...'), 'TOTAL GRUPO'];
        const bodyRows = filteredRows.map(row => [
            row.code,
            row.name,
            ...data.companies.map(c => formatCurrency(row.values[c.id] ?? 0)),
            { content: formatCurrency(row.total), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }
        ]);

        autoTable(doc, {
            startY: 50,
            head: [headRow],
            body: bodyRows as any[],
            styles: { fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [37, 99, 235], halign: 'center' },
            columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 50 } },
            didDrawPage: (d) => {
                const pageHeight = doc.internal.pageSize.height;
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text(`Página ${d.pageNumber} — SP Assessoria System`, 14, pageHeight - 10);
                doc.text(formattedDate, pageWidth - 14, pageHeight - 10, { align: 'right' });
            }
        });

        doc.save(`Consolidado_${docType}_Grupo_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    return (
        <div className="space-y-6 animate-fadeIn pb-20">

            {/* Header */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <span className={`${label.color} text-white text-xs px-2 py-1 rounded`}>{label.badge}</span>
                        {label.title}
                    </h2>
                    <div className="flex gap-2 text-sm text-slate-500 mt-1">
                        <span>{data.companies.length} Empresas Selecionadas</span>
                        <span>•</span>
                        <span>{formattedDate}</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={onBack}
                        className="px-4 py-2 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs"
                    >
                        Voltar
                    </button>
                    <button
                        onClick={handleExportPDF}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-bold text-xs hover:bg-purple-700 shadow-lg shadow-purple-500/20"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Exportar Consolidação (PDF)
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {kpis.map((kpi, i) => (
                    <div key={i} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{kpi.label}</p>
                        <p className={`text-lg font-black ${kpi.color}`}>
                            {kpi.isCount
                                ? `${kpi.value} empresas`
                                : formatCurrency(kpi.value as number)
                            }
                        </p>
                    </div>
                ))}
            </div>

            {/* Tab Toggle */}
            <div className="flex overflow-x-auto gap-2 pb-2 print:hidden">
                <button
                    onClick={() => setViewTab('table')}
                    className={`flex-1 min-w-[200px] p-4 rounded-xl border text-left transition-all ${
                        viewTab === 'table'
                            ? 'bg-purple-600 border-purple-600 text-white shadow-lg shadow-purple-500/30'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                >
                    <span className="block font-black text-sm uppercase tracking-wide">📑 Matriz de Consolidação</span>
                    <span className={`text-xs ${viewTab === 'table' ? 'text-purple-100' : 'text-slate-400'}`}>Tabela Completa</span>
                </button>
                <button
                    onClick={() => setViewTab('dashboard')}
                    className={`flex-1 min-w-[200px] p-4 rounded-xl border text-left transition-all ${
                        viewTab === 'dashboard'
                            ? 'bg-purple-600 border-purple-600 text-white shadow-lg shadow-purple-500/30'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                >
                    <span className="block font-black text-sm uppercase tracking-wide">📊 Resumo / Gráficos</span>
                    <span className={`text-xs ${viewTab === 'dashboard' ? 'text-purple-100' : 'text-slate-400'}`}>Análise Visual do Grupo</span>
                </button>
            </div>

            {/* Matrix View */}
            {viewTab === 'table' && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="p-4 border-b dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50 dark:bg-slate-900/50">
                        <input
                            type="text"
                            placeholder="Filtrar contas consolidadas..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="p-2 text-sm rounded border w-64 dark:bg-slate-700 dark:text-white"
                        />
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                            {filteredRows.length} contas · {data.companies.length} empresas
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-bold sticky top-0 z-10">
                                <tr>
                                    <th className="p-3 border-r dark:border-slate-700 min-w-[100px]">Código</th>
                                    <th className="p-3 border-r dark:border-slate-700 min-w-[200px]">Conta</th>
                                    {data.companies.map(c => (
                                        <th key={c.id} className="p-3 text-right border-r dark:border-slate-700 min-w-[140px] bg-slate-50 dark:bg-slate-800">
                                            <div className="truncate w-full" title={c.name}>{c.name}</div>
                                            <div className="text-[9px] font-mono font-normal text-slate-400">{c.cnpj}</div>
                                        </th>
                                    ))}
                                    <th className="p-3 text-right bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 min-w-[140px]">
                                        TOTAL GRUPO
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-slate-700">
                                {filteredRows.map((row, idx) => (
                                    <tr
                                        key={idx}
                                        className={`hover:bg-slate-50 dark:hover:bg-slate-800 ${row.is_synthetic ? 'font-bold bg-slate-50/50 dark:bg-slate-900/30' : ''}`}
                                    >
                                        <td className="p-3 font-mono text-xs text-slate-500 border-r dark:border-slate-700">{row.code}</td>
                                        <td className={`p-3 border-r dark:border-slate-700 truncate max-w-xs ${row.is_synthetic ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`} title={row.name}>
                                            {row.is_synthetic ? '' : ''}
                                            {row.name}
                                        </td>
                                        {data.companies.map(c => (
                                            <td key={c.id} className="p-3 text-right font-mono text-xs text-slate-500 border-r dark:border-slate-700">
                                                {formatCurrency(row.values[c.id] ?? 0)}
                                            </td>
                                        ))}
                                        <td className={`p-3 text-right font-mono text-xs font-bold bg-purple-50/30 dark:bg-purple-900/10 ${row.total < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-200'}`}>
                                            {formatCurrency(row.total)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Dashboard View */}
            {viewTab === 'dashboard' && (
                <ConsolidatedDashboard data={data} docType={docType} />
            )}
        </div>
    );
};

export default ConsolidationViewer;
