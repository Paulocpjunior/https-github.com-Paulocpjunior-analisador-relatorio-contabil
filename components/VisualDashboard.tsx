import React, { useMemo, useState } from 'react';
import { AnalysisResult, ExtractedAccount } from '../types';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, Sector
} from 'recharts';

interface Props {
    result: AnalysisResult;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const PIE_COLORS = { Ativo: '#3b82f6', Passivo: '#ef4444', Patrimonio: '#10b981' };

const renderActiveShape = (props: any) => {
    const RADIAN = Math.PI / 180;
    const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
    const sin = Math.sin(-RADIAN * midAngle);
    const cos = Math.cos(-RADIAN * midAngle);
    const sx = cx + (outerRadius + 10) * cos;
    const sy = cy + (outerRadius + 10) * sin;
    const mx = cx + (outerRadius + 30) * cos;
    const my = cy + (outerRadius + 30) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 22;
    const ey = my;
    const textAnchor = cos >= 0 ? 'start' : 'end';

    return (
        <g>
            <text x={cx} y={cy} dy={8} textAnchor="middle" fill={fill} className="text-xs font-bold">
                {payload.name}
            </text>
            <Sector
                cx={cx}
                cy={cy}
                innerRadius={innerRadius}
                outerRadius={outerRadius + 8}
                startAngle={startAngle}
                endAngle={endAngle}
                fill={fill}
            />
            <Sector
                cx={cx}
                cy={cy}
                startAngle={startAngle}
                endAngle={endAngle}
                innerRadius={outerRadius + 10}
                outerRadius={outerRadius + 14}
                fill={fill}
            />
            <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
            <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
            <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} textAnchor={textAnchor} fill="#333" className="text-[10px] dark:text-slate-200">{`R$ ${value.toLocaleString('pt-BR')}`}</text>
            <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey} dy={14} textAnchor={textAnchor} fill="#999" className="text-[10px]">
                {`(${(percent * 100).toFixed(1)}%)`}
            </text>
        </g>
    );
};

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white dark:bg-slate-800 p-3 shadow-lg rounded-xl border border-slate-100 dark:border-slate-700">
                <p className="font-bold text-slate-700 dark:text-slate-200 text-sm mb-1">{label || payload[0].payload.name}</p>
                <p className="text-blue-600 dark:text-blue-400 font-mono text-xs font-black">
                    R$ {payload[0].value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
            </div>
        );
    }
    return null;
};

const VisualDashboard: React.FC<Props> = ({ result }) => {
    const { accounts } = result || {};
    const [activeIndex, setActiveIndex] = useState(0);

    const onPieEnter = (_: any, index: number) => {
        setActiveIndex(index);
    };

    const dashboardData = useMemo(() => {
        if (!accounts || accounts.length === 0) return null;
        const activeData = accounts.filter(a => !a.is_synthetic);
        const match = (acc: ExtractedAccount, codes: string[], terms: string[]) => {
            const c = acc.account_code || '';
            const n = acc.account_name.toLowerCase();
            return codes.some(prefix => c.startsWith(prefix)) || terms.some(term => n.includes(term));
        };

        const sum = (list: ExtractedAccount[]) => list.reduce((acc, item) => acc + Math.abs(item.final_balance), 0);

        // Balanço
        const ativos = activeData.filter(a => match(a, ['1'], ['ativo', 'caixa', 'banco', 'cliente', 'estoque']));
        const passivos = activeData.filter(a => match(a, ['2.1', '2.2'], ['passivo', 'fornecedor', 'imposto', 'empréstimo']));
        const patrimonio = activeData.filter(a => match(a, ['2.3', '2.4', '2.5'], ['patrimônio', 'capital', 'reservas', 'lucro']));

        // DRE Top 5 Receitas e Despesas (Analíticas)
        const receitas = activeData.filter(a => (a.account_code?.startsWith('3.1') || match(a, [], ['receita bruta', 'venda de', 'serviços prestados'])) && a.type === 'Credit')
            .sort((a, b) => Math.abs(b.final_balance) - Math.abs(a.final_balance)).slice(0, 5);

        const despesas = activeData.filter(a => match(a, ['4', '3.2', '3.3'], ['despesa', 'custo', 'salário', 'imposto sobre', 'juros']))
            .sort((a, b) => Math.abs(b.final_balance) - Math.abs(a.final_balance)).slice(0, 7);

        const bpPieData = [
            { name: 'Ativo', value: sum(ativos) },
            { name: 'Passivo', value: sum(passivos) },
            { name: 'Patrimônio', value: sum(patrimonio) }
        ].filter(d => d.value > 0);

        const revData = receitas.map(r => ({ name: r.account_name.substring(0, 20) + (r.account_name.length > 20 ? '...' : ''), value: Math.abs(r.final_balance), full: r.account_name }));
        const expData = despesas.map(d => ({ name: d.account_name.substring(0, 20) + (d.account_name.length > 20 ? '...' : ''), value: Math.abs(d.final_balance), full: d.account_name }));

        return { bpPieData, revData, expData };
    }, [accounts]);

    if (!dashboardData) return <div className="p-4 text-center text-slate-500">Dados insuficientes para gerar gráficos.</div>;

    return (
        <div className="space-y-6 animate-fadeIn">
            <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
                Inteligência Visual
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* PIE CHART: ESTRUTURA PATRIMONIAL */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 h-[400px] flex flex-col">
                    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase mb-4 text-center tracking-wider">Distribuição Patrimonial</h4>
                    <div className="flex-1 w-full min-h-0 relative">
                        {dashboardData.bpPieData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        activeIndex={activeIndex}
                                        activeShape={renderActiveShape}
                                        data={dashboardData.bpPieData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={90}
                                        dataKey="value"
                                        onMouseEnter={onPieEnter}
                                        stroke="none"
                                    >
                                        {dashboardData.bpPieData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={(PIE_COLORS as any)[entry.name] || COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">Balanço não identificado</div>}
                    </div>
                </div>

                {/* BAR CHART: MAIORES DESPESAS */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 h-[400px] flex flex-col">
                    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase mb-4 text-center tracking-wider text-red-500">Top Maiores Despesas/Custos</h4>
                    <div className="flex-1 w-full min-h-0">
                        {dashboardData.expData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    layout="vertical"
                                    data={dashboardData.expData}
                                    margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} width={100} />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                    <Bar dataKey="value" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20}>
                                        {dashboardData.expData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={'#ef4444'} className="hover:opacity-80 transition-opacity cursor-pointer" />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">Despesas não identificadas</div>}
                    </div>
                </div>

                {/* BAR CHART: MAIORES RECEITAS */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 h-[300px] flex flex-col lg:col-span-2">
                    <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase mb-4 text-center tracking-wider text-emerald-500">Top Receitas Operacionais</h4>
                    <div className="flex-1 w-full min-h-0">
                        {dashboardData.revData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dashboardData.revData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} angle={-15} textAnchor="end" height={60} />
                                    <YAxis hide />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                    <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={60}>
                                        {dashboardData.revData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={'#10b981'} className="hover:opacity-80 transition-opacity cursor-pointer" />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">Receitas não identificadas</div>}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default VisualDashboard;
