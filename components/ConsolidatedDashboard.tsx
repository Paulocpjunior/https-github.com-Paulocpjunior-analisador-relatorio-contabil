import React, { useMemo, useState } from 'react';
import { ConsolidationResult, ConsolidatedRow } from '../types';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

interface Props {
    data: ConsolidationResult;
    docType: 'BALANCETE' | 'DRE' | 'BALANÇO' | 'CONSOLIDAÇÃO';
}

const COMPANY_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtShort = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000)     return `R$ ${(v / 1_000).toFixed(0)}K`;
    return fmt(v);
};

const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-slate-800 p-3 shadow-xl rounded-xl border border-slate-100 dark:border-slate-700 max-w-xs">
            <p className="font-bold text-slate-700 dark:text-slate-200 text-xs mb-2 pb-2 border-b dark:border-slate-600 break-words">{label}</p>
            {payload.map((entry: any, i: number) => (
                <div key={i} className="flex justify-between items-center gap-4 mb-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold truncate" style={{ color: entry.color }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                        {entry.name}
                    </span>
                    <span className="font-mono text-[10px] font-black dark:text-slate-300 whitespace-nowrap">
                        {fmt(entry.value)}
                    </span>
                </div>
            ))}
        </div>
    );
};

const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.05) return null;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * Math.PI / 180);
    const y = cy + r * Math.sin(-midAngle * Math.PI / 180);
    return (
        <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 10, fontWeight: 700 }}>
            {`${(percent * 100).toFixed(0)}%`}
        </text>
    );
};

// Picks the best synthetic row for a given code prefix
const findSynth = (rows: ConsolidatedRow[], prefix: string): ConsolidatedRow | undefined =>
    rows.filter(r => r.is_synthetic && r.code && (r.code === prefix || r.code.startsWith(prefix + '.')))
        .sort((a, b) => a.code.length - b.code.length)[0];

const ConsolidatedDashboard: React.FC<Props> = ({ data, docType }) => {
    const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const isBalancete = docType === 'BALANCETE' || docType === 'BALANÇO';

    // ── Derived data ──────────────────────────────────────────────────────────
    const dashboardData = useMemo(() => {
        if (!data?.rows?.length) return null;
        const analytical = data.rows.filter(r => !r.is_synthetic);

        if (isBalancete) {
            // 1. PIE: Ativo Total por empresa
            const ativoRow = findSynth(data.rows, '1') ?? data.rows.find(r => r.name.toUpperCase() === 'ATIVO');
            const ativoPie = data.companies.map((c, i) => ({
                name: c.name.split(' ')[0],
                value: Math.abs(ativoRow?.values[c.id] ?? 0),
                color: COMPANY_COLORS[i % COMPANY_COLORS.length]
            })).filter(d => d.value > 0);

            // 2. BAR horizontal: top contas Ativo Circulante por empresa
            const ativoCircRows = analytical
                .filter(r => r.code?.startsWith('1.1.'))
                .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
                .slice(0, 6);
            const ativoCircBar = ativoCircRows.map(row => {
                const entry: any = { name: row.name.length > 20 ? row.name.substring(0, 20) + '…' : row.name, full: row.name };
                data.companies.forEach(c => { entry[c.name] = Math.abs(row.values[c.id] ?? 0); });
                return entry;
            });

            // 3. BAR vertical: Ativo vs Passivo vs PL por empresa
            const ativoSynth   = findSynth(data.rows, '1');
            const passivoSynth = findSynth(data.rows, '2');
            const plSynth      = findSynth(data.rows, '3') ?? data.rows.find(r => r.name.toUpperCase().includes('PATRIMÔNIO'));
            const structureBar = data.companies.map((c, i) => ({
                name: c.name.split(' ')[0],
                Ativo:   Math.abs(ativoSynth?.values[c.id]   ?? 0),
                Passivo: Math.abs(passivoSynth?.values[c.id] ?? 0),
                'Pat. Líquido': Math.abs(plSynth?.values[c.id] ?? 0),
            }));

            // 4. Summary table: grupos principais
            const summaryGroups = [
                { code: '1',   label: 'ATIVO TOTAL',              row: findSynth(data.rows, '1')   },
                { code: '1.1', label: 'Ativo Circulante',          row: findSynth(data.rows, '1.1') },
                { code: '1.2', label: 'Ativo Não Circulante',      row: findSynth(data.rows, '1.2') },
                { code: '2',   label: 'PASSIVO TOTAL',             row: findSynth(data.rows, '2')   },
                { code: '2.1', label: 'Passivo Circulante',        row: findSynth(data.rows, '2.1') },
                { code: '2.2', label: 'Passivo Não Circulante',    row: findSynth(data.rows, '2.2') },
                { code: '3',   label: 'PATRIMÔNIO LÍQUIDO',        row: plSynth                     },
            ].filter(g => g.row && Math.abs(g.row.total) > 0);

            return { kind: 'balancete' as const, ativoPie, ativoCircBar, structureBar, summaryGroups, analytical };
        } else {
            // DRE ─────────────────────────────────────────────────────────────
            const revSynth = findSynth(data.rows, '3.1') ?? findSynth(data.rows, '3');
            const revPie   = data.companies.map((c, i) => ({
                name: c.name.split(' ')[0],
                value: Math.abs(revSynth?.values[c.id] ?? 0),
                color: COMPANY_COLORS[i % COMPANY_COLORS.length]
            })).filter(d => d.value > 0);

            const topExp = analytical
                .filter(r => /^[456]/.test(r.code ?? '') || ['despesa','custo','imposto'].some(w => r.name.toLowerCase().includes(w)))
                .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 5);
            const expBar = topExp.map(row => {
                const entry: any = { name: row.name.length > 20 ? row.name.substring(0, 20) + '…' : row.name };
                data.companies.forEach(c => { entry[c.name] = Math.abs(row.values[c.id] ?? 0); });
                return entry;
            });

            const topRev = analytical
                .filter(r => /^3\.1/.test(r.code ?? '') || ['receita','venda','faturamento'].some(w => r.name.toLowerCase().includes(w)))
                .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 5);
            const revBar = topRev.map(row => {
                const entry: any = { name: row.name.length > 20 ? row.name.substring(0, 20) + '…' : row.name };
                data.companies.forEach(c => { entry[c.name] = Math.abs(row.values[c.id] ?? 0); });
                return entry;
            });

            const summaryGroups = [
                { code: '3',   label: 'RECEITA TOTAL',      row: findSynth(data.rows, '3')   },
                { code: '3.1', label: 'Receita Bruta',      row: findSynth(data.rows, '3.1') },
                { code: '4',   label: 'CUSTOS TOTAIS',      row: findSynth(data.rows, '4')   },
                { code: '5',   label: 'DESPESAS TOTAIS',    row: findSynth(data.rows, '5')   },
            ].filter(g => g.row && Math.abs(g.row.total) > 0);

            return { kind: 'dre' as const, revPie, revPieName: revSynth?.name, expBar, revBar, summaryGroups, analytical };
        }
    }, [data, isBalancete, selectedCodes]);

    // ── Account selector ──────────────────────────────────────────────────────
    const filteredOptions = useMemo(() => {
        if (!dashboardData?.analytical) return [];
        return dashboardData.analytical
            .filter(r =>
                (r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.code.includes(searchTerm)) &&
                !selectedCodes.includes(r.code)
            ).slice(0, 8);
    }, [dashboardData?.analytical, searchTerm, selectedCodes]);

    const toggleAccount = (code: string) => {
        setSelectedCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
        setSearchTerm('');
    };

    const customBarData = useMemo(() => {
        if (!selectedCodes.length || !dashboardData) return null;
        const selected = data.rows.filter(r => selectedCodes.includes(r.code));
        return selected.map(row => {
            const entry: any = { name: row.name.length > 22 ? row.name.substring(0, 22) + '…' : row.name, full: row.name };
            data.companies.forEach(c => { entry[c.name] = Math.abs(row.values[c.id] ?? 0); });
            return entry;
        });
    }, [selectedCodes, data, dashboardData]);

    if (!dashboardData) return (
        <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            Dados insuficientes para gerar gráficos do Grupo.
        </div>
    );

    return (
        <div className="space-y-6 animate-fadeIn mt-4">

            {/* Section title */}
            <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
                {isBalancete ? 'Análise do Balancete Consolidado' : 'Análise das DREs Consolidadas'}
            </h3>

            {/* Summary table */}
            {dashboardData.summaryGroups.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-x-auto">
                    <div className="p-4 border-b dark:border-slate-700">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            {isBalancete ? 'Resumo — Estrutura Patrimonial por Empresa' : 'Resumo — Resultado por Empresa'}
                        </p>
                    </div>
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900">
                            <tr>
                                <th className="p-3 text-left font-bold text-slate-600 dark:text-slate-400 border-r dark:border-slate-700 min-w-[180px]">Grupo</th>
                                {data.companies.map(c => (
                                    <th key={c.id} className="p-3 text-right font-bold text-slate-600 dark:text-slate-400 border-r dark:border-slate-700 min-w-[130px]">
                                        <div className="truncate" title={c.name}>{c.name}</div>
                                    </th>
                                ))}
                                <th className="p-3 text-right font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 min-w-[130px]">
                                    TOTAL GRUPO
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-slate-700">
                            {dashboardData.summaryGroups.map((g, i) => {
                                const isHeader = ['1','2','3','4','5'].includes(g.code);
                                return (
                                    <tr key={i} className={`${isHeader ? 'font-bold bg-slate-50/60 dark:bg-slate-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                                        <td className="p-3 border-r dark:border-slate-700 text-slate-700 dark:text-slate-300">
                                            {!isHeader && <span className="text-slate-300 dark:text-slate-600 mr-2">└</span>}
                                            {g.label}
                                        </td>
                                        {data.companies.map(c => (
                                            <td key={c.id} className="p-3 text-right font-mono text-slate-600 dark:text-slate-400 border-r dark:border-slate-700">
                                                {fmt(g.row?.values[c.id] ?? 0)}
                                            </td>
                                        ))}
                                        <td className={`p-3 text-right font-mono font-bold bg-purple-50/30 dark:bg-purple-900/10 ${(g.row?.total ?? 0) < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>
                                            {fmt(g.row?.total ?? 0)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Account Selector */}
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-purple-100 dark:border-slate-700">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">
                    Comparar Contas Específicas Entre Empresas
                </label>
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Buscar conta pelo nome ou código..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-purple-500 dark:text-white"
                    />
                    <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {searchTerm && filteredOptions.length > 0 && (
                        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 shadow-2xl rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                            {filteredOptions.map(opt => (
                                <button
                                    key={opt.code}
                                    onClick={() => toggleAccount(opt.code)}
                                    className="w-full px-4 py-2.5 text-left hover:bg-purple-50 dark:hover:bg-purple-900/30 flex justify-between items-center group"
                                >
                                    <div>
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">{opt.name}</span>
                                        <span className="text-[10px] font-mono text-slate-400">{opt.code} · {fmtShort(opt.total)}</span>
                                    </div>
                                    <svg className="w-4 h-4 text-purple-500 opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                                    </svg>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {selectedCodes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                        {data.rows.filter(r => selectedCodes.includes(r.code)).map(r => (
                            <div key={r.code} className="bg-purple-600 text-white pl-3 pr-1 py-1 rounded-full flex items-center gap-1.5 text-[10px] font-black">
                                {r.name}
                                <button onClick={() => toggleAccount(r.code)} className="p-0.5 hover:bg-white/20 rounded-full">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                        <button onClick={() => setSelectedCodes([])} className="text-[10px] font-black text-red-400 hover:text-red-600 uppercase ml-1">
                            Limpar
                        </button>
                    </div>
                )}
            </div>

            {/* Custom comparison chart when accounts are selected */}
            {customBarData && customBarData.length > 0 && (
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-purple-100 dark:border-slate-700">
                    <h4 className="text-xs font-black text-purple-600 uppercase tracking-widest mb-4 text-center">
                        Comparativo das Contas Selecionadas
                    </h4>
                    <div style={{ height: Math.max(250, customBarData.length * 60) }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart layout="vertical" data={customBarData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                <XAxis type="number" hide tickFormatter={fmtShort} />
                                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} width={140} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(139,92,246,0.05)' }} />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                                {data.companies.map((c, i) => (
                                    <Bar key={c.id} dataKey={c.name} fill={COMPANY_COLORS[i % COMPANY_COLORS.length]} radius={[0, 4, 4, 0]} maxBarSize={16} />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Charts grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* PIE */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 h-[380px] flex flex-col">
                    <h4 className="text-xs font-black text-purple-600 uppercase tracking-widest mb-1 text-center">
                        {isBalancete ? 'Participação — Ativo Total por Empresa' : 'Participação — Receita por Empresa'}
                    </h4>
                    <div className="flex-1 min-h-0">
                        {(() => {
                            const pieData = dashboardData.kind === 'balancete' ? dashboardData.ativoPie : dashboardData.revPie;
                            return pieData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%" cy="50%"
                                            outerRadius={110}
                                            labelLine={false}
                                            label={renderPieLabel}
                                            dataKey="value"
                                            stroke="rgba(255,255,255,0.15)"
                                        >
                                            {pieData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(v: number) => fmt(v)} />
                                        <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">
                                    Dados insuficientes para o gráfico de pizza.
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {/* BAR horizontal */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 h-[380px] flex flex-col">
                    <h4 className="text-xs font-black uppercase tracking-widest mb-4 text-center text-blue-600">
                        {isBalancete ? 'Top Contas — Ativo Circulante por Empresa' : 'Top 5 — Custos e Despesas'}
                    </h4>
                    <div className="flex-1 min-h-0">
                        {(() => {
                            const barData = dashboardData.kind === 'balancete' ? dashboardData.ativoCircBar : dashboardData.expBar;
                            return barData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart layout="vertical" data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                        <XAxis type="number" hide />
                                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} width={130} />
                                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                                        <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                                        {data.companies.map((c, i) => (
                                            <Bar key={c.id} dataKey={c.name} fill={COMPANY_COLORS[i % COMPANY_COLORS.length]} radius={[0, 4, 4, 0]} maxBarSize={14} />
                                        ))}
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">
                                    Sem dados comparáveis.
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {/* BAR vertical full-width */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 h-[350px] flex flex-col lg:col-span-2">
                    <h4 className="text-xs font-black uppercase tracking-widest mb-4 text-center text-emerald-600">
                        {isBalancete ? 'Estrutura Patrimonial por Empresa — Ativo · Passivo · PL' : 'Top 5 — Faturamentos / Receitas por Empresa'}
                    </h4>
                    <div className="flex-1 min-h-0">
                        {(() => {
                            const barData = dashboardData.kind === 'balancete' ? dashboardData.structureBar : dashboardData.revBar;
                            if (!barData?.length) return (
                                <div className="flex items-center justify-center h-full text-xs text-slate-400 italic">Sem dados suficientes.</div>
                            );
                            if (dashboardData.kind === 'balancete') {
                                // Grouped bar: Ativo, Passivo, PL per company
                                return (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                                            <YAxis hide tickFormatter={fmtShort} />
                                            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => fmt(v)} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }} />
                                            <Bar dataKey="Ativo"         fill="#3b82f6" radius={[4,4,0,0]} maxBarSize={40} />
                                            <Bar dataKey="Passivo"       fill="#ef4444" radius={[4,4,0,0]} maxBarSize={40} />
                                            <Bar dataKey="Pat. Líquido"  fill="#10b981" radius={[4,4,0,0]} maxBarSize={40} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                );
                            }
                            return (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                                        <YAxis hide />
                                        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                        <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }} />
                                        {data.companies.map((c, i) => (
                                            <Bar key={c.id} dataKey={c.name} fill={COMPANY_COLORS[i % COMPANY_COLORS.length]} radius={[4,4,0,0]} maxBarSize={40} />
                                        ))}
                                    </BarChart>
                                </ResponsiveContainer>
                            );
                        })()}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default ConsolidatedDashboard;
