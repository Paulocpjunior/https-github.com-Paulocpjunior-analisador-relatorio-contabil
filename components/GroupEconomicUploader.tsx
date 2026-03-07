import React, { useState, useRef, useCallback } from 'react';
import { AnalysisResult } from '../types';
import { analyzeDocument } from '../services/geminiService';

export type CompanyRole = 'Controladora' | 'Subsidiária' | 'Coligada' | 'Filial';

export interface CompanyEntry {
    id: string;
    name: string;
    cnpj: string;
    role: CompanyRole;
    file: File | null;
    base64: string;
    mimeType: string;
    status: 'idle' | 'loading' | 'done' | 'error';
    result: AnalysisResult | null;
    errorMsg: string;
}

interface Props {
    onConsolidate: (entries: CompanyEntry[]) => void;
    onCancel: () => void;
    collaboratorName: string;
}

const ROLE_COLORS: Record<CompanyRole, string> = {
    'Controladora': 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300',
    'Subsidiária':  'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300',
    'Coligada':     'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300',
    'Filial':       'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300',
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

const formatCNPJ = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, '$1.$2')
            .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d)/, '.$1/$2')
            .replace(/(\d{4})(\d)/, '$1-$2');
};

const GroupEconomicUploader: React.FC<Props> = ({ onConsolidate, onCancel, collaboratorName }) => {
    const [groupName, setGroupName] = useState('');
    const [entries, setEntries] = useState<CompanyEntry[]>([
        { id: '1', name: '', cnpj: '', role: 'Controladora', file: null, base64: '', mimeType: '', status: 'idle', result: null, errorMsg: '' },
        { id: '2', name: '', cnpj: '', role: 'Subsidiária',  file: null, base64: '', mimeType: '', status: 'idle', result: null, errorMsg: '' },
    ]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [globalError, setGlobalError] = useState('');
    const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const updateEntry = (id: string, patch: Partial<CompanyEntry>) =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));

    const addEntry = () => setEntries(prev => [...prev, {
        id: Date.now().toString(), name: '', cnpj: '', role: 'Subsidiária',
        file: null, base64: '', mimeType: '', status: 'idle', result: null, errorMsg: ''
    }]);

    const removeEntry = (id: string) => setEntries(prev => prev.filter(e => e.id !== id));

    const handleFileChange = useCallback(async (id: string, file: File) => {
        try {
            const base64 = await fileToBase64(file);
            updateEntry(id, { file, base64, mimeType: file.type, status: 'idle', errorMsg: '' });
        } catch {
            updateEntry(id, { errorMsg: 'Erro ao ler o arquivo.' });
        }
    }, []);

    const handleDrop = useCallback((id: string, e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFileChange(id, file);
    }, [handleFileChange]);

    const canProcess = entries.length >= 2 &&
        entries.every(e => e.name.trim() && e.file && e.base64) &&
        groupName.trim();

    const handleProcess = async () => {
        if (!canProcess) {
            setGlobalError('Preencha nome do grupo, nome e arquivo de todas as empresas.');
            return;
        }
        setGlobalError('');
        setIsProcessing(true);

        const updated = [...entries];
        for (let i = 0; i < updated.length; i++) {
            const entry = updated[i];
            updateEntry(entry.id, { status: 'loading' });
            try {
                const result = await analyzeDocument(entry.base64, entry.mimeType);
                updated[i] = { ...entry, result, status: 'done' };
                updateEntry(entry.id, { result, status: 'done' });
            } catch (err: any) {
                updated[i] = { ...entry, status: 'error', errorMsg: err.message || 'Erro na análise.' };
                updateEntry(entry.id, { status: 'error', errorMsg: err.message || 'Erro na análise.' });
            }
        }

        setIsProcessing(false);

        const successful = updated.filter(e => e.status === 'done');
        if (successful.length < 2) {
            setGlobalError('É necessário ao menos 2 empresas analisadas com sucesso para consolidar.');
            return;
        }

        onConsolidate(successful);
    };

    const doneCount  = entries.filter(e => e.status === 'done').length;
    const errorCount = entries.filter(e => e.status === 'error').length;
    const loadingIdx = entries.findIndex(e => e.status === 'loading');

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="bg-gradient-to-br from-purple-900 via-slate-900 to-blue-900 p-8 rounded-3xl shadow-2xl relative overflow-hidden">
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-4 right-12 w-40 h-40 rounded-full bg-purple-400 blur-3xl"/>
                    <div className="absolute bottom-0 left-8 w-32 h-32 rounded-full bg-blue-400 blur-2xl"/>
                </div>
                <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className="bg-purple-500/30 border border-purple-400/40 text-purple-200 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                                Novo Módulo
                            </span>
                        </div>
                        <h2 className="text-2xl font-black text-white mb-1">Análise de Grupo Econômico</h2>
                        <p className="text-slate-400 text-sm max-w-lg">
                            Envie documentos de múltiplas empresas do grupo. A IA analisa cada uma individualmente e gera um relatório consolidado unificado.
                        </p>
                    </div>
                    <button onClick={onCancel} className="text-slate-400 hover:text-white text-sm font-medium flex items-center gap-2 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                        Voltar
                    </button>
                </div>
            </div>

            {/* Nome do Grupo */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                    Nome do Grupo Econômico / Holding
                </label>
                <input
                    type="text"
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder="Ex: Grupo SP Holdings, Holding XYZ..."
                    className="w-full md:w-1/2 px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-semibold bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={isProcessing}
                />
            </div>

            {/* Cards das Empresas */}
            <div className="space-y-4">
                {entries.map((entry, idx) => (
                    <div key={entry.id}
                        className={`bg-white dark:bg-slate-800 rounded-2xl shadow-sm border transition-all duration-300
                            ${entry.status === 'done'    ? 'border-green-300 dark:border-green-700' :
                              entry.status === 'error'   ? 'border-red-300 dark:border-red-700' :
                              entry.status === 'loading' ? 'border-purple-300 dark:border-purple-600 shadow-purple-100 dark:shadow-purple-900/20' :
                                                           'border-slate-200 dark:border-slate-700'}`}
                    >
                        {/* Card Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black
                                    ${entry.status === 'done'    ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400' :
                                      entry.status === 'error'   ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400' :
                                      entry.status === 'loading' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400' :
                                                                    'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                                    {entry.status === 'done'    ? '✓' :
                                     entry.status === 'error'   ? '✗' :
                                     entry.status === 'loading' ? '⟳' : idx + 1}
                                </div>
                                <span className="font-bold text-slate-700 dark:text-slate-200 text-sm">
                                    {entry.name || `Empresa ${idx + 1}`}
                                </span>
                                {entry.status === 'loading' && (
                                    <span className="text-xs text-purple-500 animate-pulse font-medium">Analisando com IA...</span>
                                )}
                                {entry.status === 'done' && (
                                    <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                                        {entry.result?.accounts.length} contas extraídas
                                    </span>
                                )}
                            </div>
                            {entries.length > 2 && !isProcessing && (
                                <button onClick={() => removeEntry(entry.id)}
                                    className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                </button>
                            )}
                        </div>

                        {/* Card Body */}
                        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Nome */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Nome da Empresa *</label>
                                <input
                                    type="text"
                                    value={entry.name}
                                    onChange={e => updateEntry(entry.id, { name: e.target.value })}
                                    placeholder="Razão Social"
                                    disabled={isProcessing}
                                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                                />
                            </div>

                            {/* CNPJ */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">CNPJ</label>
                                <input
                                    type="text"
                                    value={entry.cnpj}
                                    onChange={e => updateEntry(entry.id, { cnpj: formatCNPJ(e.target.value) })}
                                    placeholder="00.000.000/0000-00"
                                    disabled={isProcessing}
                                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400 font-mono"
                                />
                            </div>

                            {/* Tipo */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Tipo de Entidade</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {(['Controladora', 'Subsidiária', 'Coligada', 'Filial'] as CompanyRole[]).map(role => (
                                        <button
                                            key={role}
                                            onClick={() => updateEntry(entry.id, { role })}
                                            disabled={isProcessing}
                                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all
                                                ${entry.role === role ? ROLE_COLORS[role] : 'bg-slate-50 dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-600 hover:border-slate-400'}`}
                                        >
                                            {role}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Upload */}
                            <div className="md:col-span-3">
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                    Documento Contábil * <span className="normal-case font-normal text-slate-400">(PDF, CSV, XLSX, imagem)</span>
                                </label>
                                {entry.file ? (
                                    <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-600">
                                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{entry.file.name}</p>
                                            <p className="text-xs text-slate-400">{(entry.file.size / 1024).toFixed(0)} KB</p>
                                        </div>
                                        {!isProcessing && (
                                            <button onClick={() => { updateEntry(entry.id, { file: null, base64: '', status: 'idle' }); }}
                                                className="text-slate-400 hover:text-red-500 transition-colors">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={e => handleDrop(entry.id, e)}
                                        onClick={() => fileRefs.current[entry.id]?.click()}
                                        className="border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl p-5 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-all"
                                    >
                                        <svg className="w-6 h-6 text-slate-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                                        <p className="text-xs text-slate-500">Arraste ou <span className="text-purple-600 font-bold">clique para selecionar</span></p>
                                    </div>
                                )}
                                <input
                                    ref={el => { fileRefs.current[entry.id] = el; }}
                                    type="file"
                                    accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg"
                                    className="hidden"
                                    onChange={e => { if (e.target.files?.[0]) handleFileChange(entry.id, e.target.files[0]); }}
                                    disabled={isProcessing}
                                />
                            </div>

                            {/* Error Message */}
                            {entry.errorMsg && (
                                <div className="md:col-span-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-2">
                                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                                    {entry.errorMsg}
                                </div>
                            )}
                        </div>

                        {/* Progress bar */}
                        {entry.status === 'loading' && (
                            <div className="px-6 pb-4">
                                <div className="w-full h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-purple-500 rounded-full animate-pulse" style={{ width: '70%' }}/>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Add Company */}
            {!isProcessing && (
                <button onClick={addEntry}
                    className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-slate-500 dark:text-slate-400 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-all font-bold text-sm flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                    Adicionar Empresa ao Grupo
                </button>
            )}

            {/* Progress Summary */}
            {isProcessing && (
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-purple-500"/>
                        <span className="font-bold text-purple-700 dark:text-purple-300 text-sm">
                            Processando {loadingIdx + 1} de {entries.length}...
                        </span>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-500">
                        <span className="text-green-600 font-bold">✓ {doneCount} concluídas</span>
                        {errorCount > 0 && <span className="text-red-500 font-bold">✗ {errorCount} com erro</span>}
                        <span>{entries.length - doneCount - errorCount - (loadingIdx >= 0 ? 1 : 0)} pendentes</span>
                    </div>
                    <div className="mt-3 w-full bg-purple-100 dark:bg-purple-900/40 rounded-full h-2 overflow-hidden">
                        <div
                            className="h-full bg-purple-500 rounded-full transition-all duration-500"
                            style={{ width: `${((doneCount + errorCount) / entries.length) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Global Error */}
            {globalError && (
                <div className="p-4 bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-2xl text-sm font-medium">
                    {globalError}
                </div>
            )}

            {/* Action Button */}
            <button
                onClick={handleProcess}
                disabled={!canProcess || isProcessing}
                className={`w-full py-5 rounded-2xl font-black text-lg shadow-xl transition-all
                    ${canProcess && !isProcessing
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white transform hover:scale-[1.01] shadow-purple-500/25 active:scale-95'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}`}
            >
                {isProcessing
                    ? `🔄 Analisando empresa ${loadingIdx + 1} de ${entries.length}...`
                    : `🏢 Analisar e Consolidar ${entries.length} Empresa${entries.length > 1 ? 's' : ''}`}
            </button>
        </div>
    );
};

export default GroupEconomicUploader;
