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
    const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    const onPieEnter = (_: any, index: number) => {
        setActiveIndex(index);
    };

    const dashboardData = useMemo(() => {
        if (!accounts || accounts.length === 0) return null;
        const analyticalAccounts = accounts.filter(a => !a.is_synthetic);

        const match = (acc: ExtractedAccount, codes: string[], terms: string[]) => {
            const c = acc.account_code || '';
            const n = acc.account_name.toLowerCase();
            return codes.some(prefix => c.startsWith(prefix)) || terms.some(term => n.includes(term));
        };

        const sum = (list: ExtractedAccount[]) => list.reduce((acc, item) => acc + Math.abs(item.final_balance), 0);

        // Balanço
        const ativos = analyticalAccounts.filter(a => match(a, ['1'], ['ativo', 'caixa', 'banco', 'cliente', 'estoque']));
        const passivos = analyticalAccounts.filter(a => match(a, ['2.1', '2.2'], ['passivo', 'fornecedor', 'imposto', 'empréstimo']));
        const patrimonio = analyticalAccounts.filter(a => match(a, ['2.3', '2.4', '2.5'], ['patrimônio', 'capital', 'reservas', 'lucro']));

        // Filter Logic: If users selected specific codes, use them. Otherwise Top 5.
        let targetReceitas = [];
        let targetDespesas = [];

        if (selectedCodes.length > 0) {
            const selected = analyticalAccounts.filter(a => selectedCodes.includes(a.account_code || ''));
            targetReceitas = selected.filter(a => a.account_code?.startsWith('3.1') || a.type === 'Credit');
            targetDespesas = selected.filter(a => !targetReceitas.includes(a));
        } else {
            targetReceitas = analyticalAccounts.filter(a => (a.account_code?.startsWith('3.1') || match(a, [], ['receita bruta', 'venda de', 'serviços prestados'])) && a.type === 'Credit')
                .sort((a, b) => Math.abs(b.final_balance) - Math.abs(a.final_balance)).slice(0, 5);

            targetDespesas = analyticalAccounts.filter(a => match(a, ['4', '3.2', '3.3'], ['despesa', 'custo', 'salário', 'imposto sobre', 'juros']))
                .sort((a, b) => Math.abs(b.final_balance) - Math.abs(a.final_balance)).slice(0, 7);
        }

        const bpPieData = [
            { name: 'Ativo', value: sum(ativos) },
            { name: 'Passivo', value: sum(passivos) },
            { name: 'Patrimônio', value: sum(patrimonio) }
        ].filter(d => d.value > 0);

        const revData = targetReceitas.map(r => ({ name: r.account_name.substring(0, 20) + (r.account_name.length > 20 ? '...' : ''), value: Math.abs(r.final_balance), full: r.account_name }));
        const expData = targetDespesas.map(d => ({ name: d.account_name.substring(0, 20) + (d.account_name.length > 20 ? '...' : ''), value: Math.abs(d.final_balance), full: d.account_name }));

        return { bpPieData, revData, expData, analyticalAccounts };
    }, [accounts, selectedCodes]);

    const filteredOptions = useMemo(() => {
        if (!dashboardData?.analyticalAccounts) return [];
        return dashboardData.analyticalAccounts.filter(a =>
            (a.account_name.toLowerCase().includes(searchTerm.toLowerCase()) || a.account_code?.includes(searchTerm)) &&
            !selectedCodes.includes(a.account_code || '')
        ).slice(0, 8);
    }, [dashboardData?.analyticalAccounts, searchTerm, selectedCodes]);

    const toggleAccount = (code: string) => {
        setSelectedCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
        setSearchTerm('');
    };

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

            {/* Account Selector UI */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-blue-100 dark:border-slate-700">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                    <div className="flex-1 w-full relative">
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 tracking-widest">Personalizar Visualização</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Busque por código ou nome da conta para adicionar ao gráfico..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-900 border-none rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all dark:text-white"
                            />
                            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        </div>

                        {searchTerm && (
                            <div className="absolute z-50 mt-2 w-full bg-white dark:bg-slate-800 shadow-2xl rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                                {filteredOptions.length > 0 ? filteredOptions.map(opt => (
                                    <button
                                        key={opt.account_code}
                                        onClick={() => toggleAccount(opt.account_code || '')}
                                        className="w-full px-4 py-3 text-left hover:bg-blue-50 dark:hover:bg-blue-900/30 flex justify-between items-center group transition-colors"
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-slate-700 dark:text-slate-200">{opt.account_name}</span>
                                            <span className="text-[10px] font-mono text-slate-400">{opt.account_code}</span>
                                        </div>
                                        <svg className="w-4 h-4 text-blue-500 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
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
                        {accounts?.filter(a => selectedCodes.includes(a.account_code || '')).map(a => (
                            <div key={a.account_code} className="bg-blue-600 text-white pl-3 pr-1 py-1 rounded-full flex items-center gap-2 shadow-md shadow-blue-500/20">
                                <span className="text-[10px] font-black">{a.account_name}</span>
                                <button onClick={() => toggleAccount(a.account_code || '')} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

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
