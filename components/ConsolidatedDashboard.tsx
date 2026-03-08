import React, { useMemo } from 'react';
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

    const dashboardData = useMemo(() => {
        if (!data || !data.rows || data.rows.length === 0) return null;

        // Match helper (Analytical level)
        const activeRows = data.rows.filter(r => !r.is_synthetic);
        const match = (row: ConsolidatedRow, codes: string[], terms: string[]) => {
            const c = row.code || '';
            const n = row.name.toLowerCase();
            return codes.some(prefix => c.startsWith(prefix)) || terms.some(term => n.includes(term));
        };

        // --- PIE CHART: GROUP REVENUE CONTRIBUTION ---
        // Find Total Revenue Row (Synthetic usually 3.1 or 3.1.1 or top level)
        const revRows = data.rows.filter(r => r.code.startsWith('3.1') && r.is_synthetic).sort((a, b) => b.total - a.total);
        const mainRevRow = revRows[0]; // Assume highest logical grouping is Total Revenue

        let revenuePie = [];
        if (mainRevRow) {
            revenuePie = data.companies.map((c, idx) => ({
                name: c.name.split(' ')[0], // short name
                value: Math.abs(mainRevRow.values[c.id] || 0),
                color: COMPANY_COLORS[idx % COMPANY_COLORS.length]
            })).filter(d => d.value > 0);
        }

        // --- BAR CHART: TOP EXPENSES BY COMPANY ---
        const expenses = activeRows.filter(a => match(a, ['4', '3.2', '3.3'], ['despesa', 'custo', 'salário', 'imposto sobre', 'juros']))
            .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 5);

        const expChartData = expenses.map(row => {
            const chartEntry: any = { name: row.name.substring(0, 15) + '...', full: row.name };
            data.companies.forEach(c => {
                chartEntry[c.name] = Math.abs(row.values[c.id] || 0);
            });
            return chartEntry;
        });

        // --- BAR CHART: TOP REVENUES BY COMPANY ---
        const revenues = activeRows.filter(a => (a.code?.startsWith('3.1') || match(a, [], ['receita', 'venda', 'serviços'])))
            .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 5);

        const revChartData = revenues.map(row => {
            const chartEntry: any = { name: row.name.substring(0, 15) + '...', full: row.name };
            data.companies.forEach(c => {
                chartEntry[c.name] = Math.abs(row.values[c.id] || 0);
            });
            return chartEntry;
        });

        return { revenuePie, expChartData, revChartData, mainRevRowName: mainRevRow?.name };
    }, [data]);

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
