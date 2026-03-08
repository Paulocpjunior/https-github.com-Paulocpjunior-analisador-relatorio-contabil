import React, { useMemo, useState } from 'react';
import { ConsolidationResult, ConsolidatedRow } from '../types';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, Sector
} from 'recharts';

interface Props {
    data: ConsolidationResult;
}

// Fixed color palette for up to 10 companies
const COMPANY_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white dark:bg-slate-800 p-4 shadow-xl rounded-xl border border-slate-100 dark:border-slate-700">
                <p className="font-bold text-slate-700 dark:text-slate-200 text-sm mb-2 pb-2 border-b dark:border-slate-700">{label}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={index} className="flex justify-between items-center gap-6 mb-1">
                        <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: entry.color }}>
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                            {entry.name}
                        </span>
                        <span className="font-mono text-xs font-black dark:text-slate-300">
                            R$ {entry.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const ConsolidatedDashboard: React.FC<Props> = ({ data }) => {
    const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    const dashboardData = useMemo(() => {
        if (!data || !data.rows || data.rows.length === 0) return null;

        const analyticalRows = data.rows.filter(r => !r.is_synthetic);
        const match = (row: ConsolidatedRow, codes: string[], terms: string[]) => {
            const c = row.code || '';
            const n = row.name.toLowerCase();
            return codes.some(prefix => c.startsWith(prefix)) || terms.some(term => n.includes(term));
        };

        // --- PIE CHART: GROUP REVENUE CONTRIBUTION ---
        const revRows = data.rows.filter(r => r.code.startsWith('3.1') && r.is_synthetic).sort((a, b) => b.total - a.total);
        const mainRevRow = revRows[0];

        let revenuePie = [];
        if (mainRevRow) {
            revenuePie = data.companies.map((c, idx) => ({
                name: c.name.split(' ')[0],
                value: Math.abs(mainRevRow.values[c.id] || 0),
                color: COMPANY_COLORS[idx % COMPANY_COLORS.length]
            })).filter(d => d.value > 0);
        }

        // --- FILTER LOGIC ---
        let targetReceitas: ConsolidatedRow[] = [];
        let targetDespesas: ConsolidatedRow[] = [];

        if (selectedCodes.length > 0) {
            const selected = analyticalRows.filter(r => selectedCodes.includes(r.code));
            targetReceitas = selected.filter(r => r.code.startsWith('3.1') || r.name.toLowerCase().includes('receita') || r.name.toLowerCase().includes('venda'));
            targetDespesas = selected.filter(r => !targetReceitas.includes(r));
        } else {
            targetDespesas = analyticalRows.filter(a => match(a, ['4', '3.2', '3.3'], ['despesa', 'custo', 'salário', 'imposto sobre', 'juros']))
                .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 5);

            targetReceitas = analyticalRows.filter(a => (a.code?.startsWith('3.1') || match(a, [], ['receita', 'venda', 'serviços'])))
                .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 5);
        }

        const expChartData = targetDespesas.map(row => {
            const chartEntry: any = { name: row.name.substring(0, 15) + '...', full: row.name };
            data.companies.forEach(c => {
                chartEntry[c.name] = Math.abs(row.values[c.id] || 0);
            });
            return chartEntry;
        });

        const revChartData = targetReceitas.map(row => {
            const chartEntry: any = { name: row.name.substring(0, 15) + '...', full: row.name };
            data.companies.forEach(c => {
                chartEntry[c.name] = Math.abs(row.values[c.id] || 0);
            });
            return chartEntry;
        });

        return { revenuePie, expChartData, revChartData, mainRevRowName: mainRevRow?.name, analyticalRows };
    }, [data, selectedCodes]);

    const filteredOptions = useMemo(() => {
        if (!dashboardData?.analyticalRows) return [];
        return dashboardData.analyticalRows.filter(r =>
            (r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.code.includes(searchTerm)) &&
            !selectedCodes.includes(r.code)
        ).slice(0, 8);
    }, [dashboardData?.analyticalRows, searchTerm, selectedCodes]);

    const toggleAccount = (code: string) => {
        setSelectedCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
        setSearchTerm('');
    };

    if (!dashboardData) return <div className="p-4 text-center text-slate-500">Dados insuficientes para gerar gráficos do Grupo.</div>;

    const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
        const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
        const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);
        if (percent < 0.05) return null;
        return (
            <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-[10px] font-bold">
                {`${(percent * 100).toFixed(0)}%`}
            </text>
        );
    };

    return (
        <div className="space-y-6 animate-fadeIn mt-6">
            <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
                Dashboard do Grupo Econômico
            </h3>

            {/* Account Selector UI */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-purple-100 dark:border-slate-700">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                    <div className="flex-1 w-full relative">
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 tracking-widest">Personalizar Visualização do Grupo</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Selecione contas para comparar entre todas as empresas..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-900 border-none rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-purple-500 transition-all dark:text-white"
                            />
                            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </div>

                        {searchTerm && (
                            <div className="absolute z-50 mt-2 w-full bg-white dark:bg-slate-800 shadow-2xl rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                                {filteredOptions.length > 0 ? filteredOptions.map(opt => (
                                    <button
                                        key={opt.code}
                                        onClick={() => toggleAccount(opt.code)}
                                        className="w-full px-4 py-3 text-left hover:bg-purple-50 dark:hover:bg-purple-900/30 flex justify-between items-center group transition-colors"
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-slate-700 dark:text-slate-200">{opt.name}</span>
                                            <span className="text-[10px] font-mono text-slate-400">{opt.code}</span>
                                        </div>
                                        <svg className="w-4 h-4 text-purple-500 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                                    </button>
                                )) : <div className="p-4 text-center text-xs text-slate-400">Nenhuma conta encontrada.</div>}
                            </div>
                        )}
                    </div>

                    <div className="flex-shrink-0">
                        {selectedCodes.length > 0 && (
                            <button
                                onClick={() => setSelectedCodes([])}
                                className="text-[10px] font-black text-red-500 hover:text-red-700 p-2 uppercase"
                            >
                                Limpar Seleção
                            </button>
                        )}
                    </div>
                </div>

                {selectedCodes.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {data.rows.filter(r => selectedCodes.includes(r.code)).map(r => (
                            <div key={r.code} className="bg-purple-600 text-white pl-3 pr-1 py-1 rounded-full flex items-center gap-2 shadow-md shadow-purple-500/20">
                                <span className="text-[10px] font-black">{r.name}</span>
                                <button onClick={() => toggleAccount(r.code)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* PIE CHART: REVENUE CONTRIBUTION */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 h-[400px] flex flex-col">
                    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase mb-2 text-center tracking-wider text-purple-600">Representatividade no Grupo</h4>
                    <p className="text-[10px] text-slate-400 text-center uppercase mb-4 break-words">Base: {dashboardData.mainRevRowName || 'Receita Total'}</p>
                    <div className="flex-1 w-full min-h-0 relative">
                        {dashboardData.revenuePie.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={dashboardData.revenuePie}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={renderCustomizedLabel}
                                        outerRadius={100}
                                        dataKey="value"
                                        stroke="rgba(255,255,255,0.2)"
                                    >
                                        {dashboardData.revenuePie.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">Dados insuficientes para compor gráfico de Pizza.</div>}
                    </div>
                </div>

                {/* BAR CHART: TOP EXPENSES COMPARE */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 h-[400px] flex flex-col">
                    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase mb-4 text-center tracking-wider text-red-500">Comparativo: Top 5 Custos e Despesas</h4>
                    <div className="flex-1 w-full min-h-0">
                        {dashboardData.expChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    layout="vertical"
                                    data={dashboardData.expChartData}
                                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} width={120} />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                                    {data.companies.map((c, idx) => (
                                        <Bar key={c.id} dataKey={c.name} fill={COMPANY_COLORS[idx % COMPANY_COLORS.length]} radius={[0, 4, 4, 0]} maxBarSize={15} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">Sem despesas comparáveis</div>}
                    </div>
                </div>

                {/* BAR CHART: TOP REVENUES COMPARE */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 h-[350px] flex flex-col lg:col-span-2">
                    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase mb-4 text-center tracking-wider text-emerald-500">Comparativo: Top 5 Faturamentos / Receitas</h4>
                    <div className="flex-1 w-full min-h-0">
                        {dashboardData.revChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={dashboardData.revChartData}
                                    margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                                    <YAxis hide />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                                    {data.companies.map((c, idx) => (
                                        <Bar key={c.id} dataKey={c.name} fill={COMPANY_COLORS[idx % COMPANY_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">Sem receitas comparáveis</div>}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default ConsolidatedDashboard;
