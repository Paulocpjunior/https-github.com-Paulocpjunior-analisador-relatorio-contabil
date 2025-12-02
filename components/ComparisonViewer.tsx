import React, { useState } from 'react';
import { ComparisonResult } from '../types';
import { generateComparisonAnalysis } from '../services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
    data: ComparisonResult;
    onBack: () => void;
}

const ComparisonViewer: React.FC<Props> = ({ data, onBack }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [hideZero, setHideZero] = useState(true);
    const [analysisText, setAnalysisText] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const filteredRows = data.rows.filter(row => {
        const matchesSearch = row.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                              row.code.includes(searchTerm);
        const matchesZero = hideZero ? (row.val1 !== 0 || row.val2 !== 0) : true;
        return matchesSearch && matchesZero;
    });

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    const formatPct = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);

    const handleAnalyze = async () => {
        setIsAnalyzing(true);
        try {
            const result = await generateComparisonAnalysis(data.rows, data.period1Label, data.period2Label);
            setAnalysisText(result);
        } catch (e) {
            setAnalysisText("Erro ao gerar análise.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleExportPDF = () => {
        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.text(`Comparativo: ${data.period1Label} vs ${data.period2Label}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Tipo: ${data.documentType}`, 14, 28);

        autoTable(doc, {
            startY: 35,
            head: [['Código', 'Conta', data.period1Label, data.period2Label, 'Var $', 'Var %']],
            body: filteredRows.map(r => [
                r.code, 
                r.name, 
                formatCurrency(r.val1), 
                formatCurrency(r.val2), 
                formatCurrency(r.varAbs), 
                formatPct(r.varPct)
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [37, 99, 235] }
        });

        if (analysisText) {
            doc.addPage();
            doc.setFontSize(14);
            doc.text("Análise de Variações (IA)", 14, 20);
            doc.setFontSize(10);
            const splitText = doc.splitTextToSize(analysisText, 180);
            doc.text(splitText, 14, 30);
        }

        doc.save('comparativo_financeiro.pdf');
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col md:flex-row justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border dark:border-slate-700">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">Análise Comparativa (Horizontal)</h2>
                    <p className="text-sm text-slate-500">{data.period1Label} vs {data.period2Label}</p>
                </div>
                <div className="flex gap-2 mt-4 md:mt-0">
                    <button onClick={onBack} className="px-4 py-2 border rounded hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300">Voltar</button>
                    <button onClick={handleExportPDF} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Exportar PDF</button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border dark:border-slate-700 overflow-hidden">
                    <div className="p-4 border-b dark:border-slate-700 flex justify-between items-center gap-4">
                        <input 
                            type="text" 
                            placeholder="Buscar conta..." 
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="flex-1 p-2 border rounded text-sm dark:bg-slate-700 dark:text-white"
                        />
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
                            <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} />
                            Ocultar Zerados
                        </label>
                    </div>
                    <div className="overflow-auto max-h-[600px]">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-900 sticky top-0">
                                <tr>
                                    <th className="p-3 text-left">Conta</th>
                                    <th className="p-3 text-right">{data.period1Label}</th>
                                    <th className="p-3 text-right">{data.period2Label}</th>
                                    <th className="p-3 text-right">Var ($)</th>
                                    <th className="p-3 text-right">Var (%)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-slate-700">
                                {filteredRows.map((row, idx) => (
                                    <tr key={idx} className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 ${row.is_synthetic ? 'font-bold bg-slate-50/50 dark:bg-slate-800' : ''}`}>
                                        <td className="p-3 truncate max-w-xs" title={row.name}>
                                            <span className="font-mono text-xs text-slate-500 mr-2">{row.code}</span>
                                            {row.name}
                                        </td>
                                        <td className="p-3 text-right font-mono">{formatCurrency(row.val1)}</td>
                                        <td className="p-3 text-right font-mono">{formatCurrency(row.val2)}</td>
                                        <td className={`p-3 text-right font-mono ${row.varAbs > 0 ? 'text-green-600' : row.varAbs < 0 ? 'text-red-600' : ''}`}>
                                            {formatCurrency(row.varAbs)}
                                        </td>
                                        <td className={`p-3 text-right font-mono ${row.varPct > 0 ? 'text-green-600' : row.varPct < 0 ? 'text-red-600' : ''}`}>
                                            {formatPct(row.varPct)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border dark:border-slate-700 p-6 flex flex-col">
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <span>🧠</span> Análise IA de Variações
                    </h3>
                    
                    {!analysisText ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                            <p className="text-slate-500 mb-4 text-sm">Gere insights automáticos sobre as principais variações entre os períodos.</p>
                            <button 
                                onClick={handleAnalyze} 
                                disabled={isAnalyzing}
                                className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-bold"
                            >
                                {isAnalyzing ? 'Analisando...' : 'Gerar Análise de Variação'}
                            </button>
                        </div>
                    ) : (
                        <div className="prose dark:prose-invert text-sm max-w-none overflow-y-auto max-h-[500px]">
                            <pre className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-300">{analysisText}</pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ComparisonViewer;