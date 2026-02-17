
import React, { useState } from 'react';
import { ConsolidationResult } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
    data: ConsolidationResult;
    onBack: () => void;
    collaboratorName: string;
}

const ConsolidationViewer: React.FC<Props> = ({ data, onBack, collaboratorName }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    const formattedDate = new Date(data.generatedAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' });

    // Filter Logic
    const filteredRows = data.rows.filter(r => 
        r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        r.code.includes(searchTerm)
    );

    const handleExportPDF = () => {
        const doc = new jsPDF('l'); // Landscape for many columns
        const pageWidth = doc.internal.pageSize.width;

        // --- STANDARD HEADER (Reused logic, adapted for landscape) ---
        doc.setFillColor(15, 23, 42); 
        doc.rect(0, 0, pageWidth, 40, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text("SP ASSESSORIA CONTÁBIL", 14, 15);
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Relatório de Consolidação (Grupo Econômico)`, 14, 22);
        
        // Metadata
        doc.text(`Empresas: ${data.companies.length} Entidades`, 14, 30);
        doc.text(`Grupo Base: ${data.groupName}`, 14, 35);

        doc.text(`Emissão: ${formattedDate}`, pageWidth - 14, 30, { align: 'right' });
        doc.text(`Operador: ${collaboratorName || 'Não Identificado'}`, pageWidth - 14, 35, { align: 'right' });

        // Table Data Preparation
        const headRow = ['Código', 'Conta', ...data.companies.map(c => c.name.substring(0, 15) + '...'), 'TOTAL GRUPO'];
        const bodyRows = filteredRows.map(row => {
            const rowData = [
                row.code,
                row.name,
                ...data.companies.map(c => formatCurrency(row.values[c.id])),
                { content: formatCurrency(row.total), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }
            ];
            return rowData;
        });

        autoTable(doc, {
            startY: 50,
            head: [headRow],
            body: bodyRows as any[],
            styles: { fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [37, 99, 235], halign: 'center' },
            columnStyles: {
                0: { cellWidth: 20 }, // Code
                1: { cellWidth: 50 }, // Name
                // Dynamic columns will auto-size
            },
            didDrawPage: (d) => {
                 // Footer
                 const pageSize = doc.internal.pageSize;
                 const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
                 doc.setFontSize(8);
                 doc.setTextColor(150);
                 doc.text(`Página ${d.pageNumber} - Gerado por SP Assessoria System`, 14, pageHeight - 10);
                 doc.text(`${formattedDate}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
            }
        });

        doc.save(`Consolidado_Grupo_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    // Calculate Total Result for Summary Card
    const totalResult = data.rows.find(r => 
        r.name.toLowerCase().includes('lucro líquido') || 
        r.name.toLowerCase().includes('resultado do exercício') ||
        r.name.toLowerCase().includes('prejuízo líquido')
    )?.total || 0;

    return (
        <div className="space-y-6 animate-fadeIn pb-20">
            {/* Header / Summary */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded">GRUPO</span>
                        Consolidação de DREs
                    </h2>
                    <div className="flex gap-2 text-sm text-slate-500 mt-1">
                        <span>{data.companies.length} Empresas Selecionadas</span>
                        <span>•</span>
                        <span>{formattedDate}</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={onBack} className="px-4 py-2 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs">
                        Voltar
                    </button>
                    <button onClick={handleExportPDF} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-bold text-xs hover:bg-purple-700 shadow-lg shadow-purple-500/20">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Exportar Consolidação (PDF)
                    </button>
                </div>
            </div>

            {/* Matrix View */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-4 border-b dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                     <input 
                        type="text" 
                        placeholder="Filtrar contas consolidadas..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="p-2 text-sm rounded border w-64 dark:bg-slate-700 dark:text-white"
                    />
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        Resultado Aglutinado: <span className={totalResult >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(totalResult)}</span>
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
                                <tr key={idx} className={`hover:bg-slate-50 dark:hover:bg-slate-800 ${row.is_synthetic ? 'font-bold bg-slate-50/50' : ''}`}>
                                    <td className="p-3 font-mono text-xs text-slate-500 border-r dark:border-slate-700">{row.code}</td>
                                    <td className="p-3 border-r dark:border-slate-700 truncate max-w-xs" title={row.name}>{row.name}</td>
                                    {data.companies.map(c => (
                                        <td key={c.id} className="p-3 text-right font-mono text-slate-500 border-r dark:border-slate-700">
                                            {formatCurrency(row.values[c.id])}
                                        </td>
                                    ))}
                                    <td className={`p-3 text-right font-mono font-bold bg-purple-50/30 dark:bg-purple-900/10 ${row.total < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {formatCurrency(row.total)}
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

export default ConsolidationViewer;
