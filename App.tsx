
import React, { useState, useEffect, useMemo } from 'react';
import HeaderInputs from './components/HeaderInputs';
import FileUploader from './components/FileUploader';
import AnalysisViewer from './components/AnalysisViewer';
import AnalysisHistory from './components/AnalysisHistory';
import ChatAssistant from './components/ChatAssistant';
import ComparisonViewer from './components/ComparisonViewer';
import ConsolidationViewer from './components/ConsolidationViewer';
import { HeaderData, AnalysisResult, HistoryItem, ComparisonResult, ComparisonRow, ConsolidationResult } from './types';
import { analyzeDocument } from './services/geminiService';
import { consolidateDREs } from './services/consolidationService';

const HISTORY_STORAGE_KEY = 'auditAI_history';
const CACHE_STORAGE_PREFIX = 'auditAI_cache_';
const THEME_STORAGE_KEY = 'auditAI_theme';
const MAX_HISTORY_ITEMS = 100;

const LoadingSpinner = () => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-fadeIn">
     <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center">
        <div className="relative flex items-center justify-center mb-6">
           <div className="animate-ping absolute inline-flex h-12 w-12 rounded-full bg-blue-500/20 opacity-75"></div>
           <div className="relative animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500"></div>
        </div>
        <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Analisando Documento...</h3>
        <p className="text-blue-500 font-medium animate-pulse">A IA da SP Assessoria está processando os dados.</p>
     </div>
  </div>
);

const App: React.FC = () => {
  const [headerData, setHeaderData] = useState<HeaderData>({ companyName: '', collaboratorName: '', cnpj: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<{file: File, base64: string, mimeType: string} | null>(null);
  const [analysisTimestamp, setAnalysisTimestamp] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [consolidationResult, setConsolidationResult] = useState<ConsolidationResult | null>(null);

  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (savedHistory) {
        try {
            setHistory(JSON.parse(savedHistory));
        } catch (e) {
            console.error("Failed to load history", e);
        }
    }
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        setDarkMode(true);
        document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) { document.documentElement.classList.add('dark'); localStorage.setItem(THEME_STORAGE_KEY, 'dark'); }
    else { document.documentElement.classList.remove('dark'); localStorage.setItem(THEME_STORAGE_KEY, 'light'); }
  };

  const getFullResult = (item: HistoryItem): AnalysisResult | null => {
      let fullResult = item.fullResult;
      if (!fullResult) {
          try {
            const cached = localStorage.getItem(`${CACHE_STORAGE_PREFIX}${item.id}`);
            if (cached) fullResult = JSON.parse(cached);
          } catch (e) {
            console.warn("Failed to retrieve cached result", e);
          }
      }
      return fullResult || null;
  };

  const saveToHistory = (result: AnalysisResult, header: HeaderData, fileName: string) => {
    const id = Date.now().toString();
    try { 
        localStorage.setItem(`${CACHE_STORAGE_PREFIX}${id}`, JSON.stringify(result)); 
    } catch (e) { 
        console.warn("Cache full, could not save detailed result", e); 
    }

    const newItem: HistoryItem = { 
        id, 
        timestamp: new Date().toISOString(), 
        headerData: { ...header }, 
        fileName, 
        summary: result.summary 
    };

    setHistory(prevHistory => {
        const updated = [newItem, ...prevHistory].slice(0, MAX_HISTORY_ITEMS);
        try {
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
            console.error("Failed to save history list", e);
        }
        return updated;
    });
  };

  const handleManualSave = () => {
    if (!headerData.companyName) return;
    
    // Create a dummy/empty result for the draft
    const draftResult: AnalysisResult = {
        summary: {
            document_type: 'Outro',
            period: 'Rascunho',
            total_debits: 0,
            total_credits: 0,
            is_balanced: true,
            discrepancy_amount: 0,
            observations: [],
        },
        accounts: [],
        spell_check: []
    };

    saveToHistory(draftResult, headerData, 'Rascunho Manual');
    alert('Informações salvas no histórico como rascunho!');
  };

  const deleteFromHistory = (id: string) => {
      setHistory(prev => {
          const updated = prev.filter(item => item.id !== id);
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
          localStorage.removeItem(`${CACHE_STORAGE_PREFIX}${id}`);
          return updated;
      });
  };

  const clearAllHistory = () => {
      history.forEach(item => localStorage.removeItem(`${CACHE_STORAGE_PREFIX}${item.id}`));
      setHistory([]);
      localStorage.removeItem(HISTORY_STORAGE_KEY);
  };

  const loadFromHistory = (item: HistoryItem) => {
      const fullResult = getFullResult(item);
      if (fullResult) {
          setHeaderData(item.headerData);
          setAnalysisResult(fullResult);
          setAnalysisTimestamp(item.timestamp);
          // If it's a draft, don't set a file
          if (item.fileName === 'Rascunho Manual') {
            setSelectedFile(null);
          } else {
            setSelectedFile({ file: { name: item.fileName } as File, base64: '', mimeType: '' });
          }
          setError(null);
          setComparisonResult(null); 
          setConsolidationResult(null);
          setIsHistoryOpen(false);
      } else { alert("Detalhes não encontrados no cache."); }
  };

  const handleComparison = (item1: HistoryItem, item2: HistoryItem) => {
      const res1 = getFullResult(item1);
      const res2 = getFullResult(item2);

      if (!res1 || !res2) {
          alert("Erro: Dados completos não encontrados para comparação.");
          return;
      }

      const rows: ComparisonRow[] = [];
      const map1 = new Map(res1.accounts.map(a => [a.account_code || a.account_name, a]));
      const map2 = new Map(res2.accounts.map(a => [a.account_code || a.account_name, a]));
      const allKeys = new Set([...map1.keys(), ...map2.keys()]);

      allKeys.forEach(key => {
          const acc1 = map1.get(key);
          const acc2 = map2.get(key);
          const name = acc2?.account_name || acc1?.account_name || 'Desconhecido';
          const code = acc2?.account_code || acc1?.account_code || '';
          const val1 = acc1 ? acc1.final_balance : 0;
          const val2 = acc2 ? acc2.final_balance : 0;
          const varAbs = val2 - val1;
          const varPct = val1 !== 0 ? (varAbs / Math.abs(val1)) * 100 : (val2 !== 0 ? 100 : 0);

          rows.push({
              code, name, val1, val2, varAbs, varPct,
              is_synthetic: (acc1?.is_synthetic || acc2?.is_synthetic) || false,
              level: acc1?.level || acc2?.level || 1
          });
      });

      rows.sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true}));

      setComparisonResult({
          period1Label: new Date(item1.timestamp).toLocaleDateString('pt-BR'),
          period2Label: new Date(item2.timestamp).toLocaleDateString('pt-BR'),
          rows,
          documentType: item1.summary.document_type
      });
      setAnalysisResult(null);
      setConsolidationResult(null);
      setIsHistoryOpen(false);
  };

  const handleConsolidation = (items: HistoryItem[]) => {
      // 1. Fetch all full results
      const fullData = items.map(item => ({ item, result: getFullResult(item) })).filter(d => d.result !== null) as {item: HistoryItem, result: AnalysisResult}[];

      if (fullData.length < 2) {
          alert("Erro: Não foi possível carregar os dados completos de todos os itens selecionados.");
          return;
      }

      const consolidated = consolidateDREs(fullData);
      setConsolidationResult(consolidated);
      setAnalysisResult(null);
      setComparisonResult(null);
      setIsHistoryOpen(false);
  };

  const handleStartAnalysis = async () => {
    if (!headerData.companyName || !headerData.collaboratorName) { setError("Preencha os dados da empresa e responsável."); return; }
    if (!selectedFile?.base64) { setError("Selecione um arquivo."); return; }
    setIsLoading(true); setError(null);
    try {
      const mime = selectedFile.mimeType || selectedFile.file.type;
      const result = await analyzeDocument(selectedFile.base64, mime);
      saveToHistory(result, headerData, selectedFile.file.name);
      setAnalysisTimestamp(new Date().toISOString());
      setAnalysisResult(result);
      setComparisonResult(null);
      setConsolidationResult(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erro desconhecido na análise.");
    } finally { setIsLoading(false); }
  };

  const handleReset = () => { 
      setAnalysisResult(null); 
      setComparisonResult(null); 
      setConsolidationResult(null);
      setSelectedFile(null); 
      setError(null); 
  };

  const previousAccounts = useMemo(() => {
    if (!analysisResult || !headerData.companyName) return undefined;
    const currentTs = analysisTimestamp ? new Date(analysisTimestamp).getTime() : Date.now();
    const previousItem = history.find(h => {
        const itemTs = new Date(h.timestamp).getTime();
        return itemTs < (currentTs - 1000) && 
               h.headerData.companyName.toLowerCase() === headerData.companyName.toLowerCase() &&
               h.summary.document_type === analysisResult.summary.document_type;
    });
    if (previousItem) {
        const full = getFullResult(previousItem);
        return full?.accounts;
    }
    return undefined;
  }, [analysisResult, history, headerData.companyName, analysisTimestamp]);

  const isReady = !isLoading && selectedFile !== null && selectedFile.base64.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-300">
      <AnalysisHistory 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)} 
        history={history} 
        onSelect={loadFromHistory} 
        onClear={clearAllHistory}
        onDeleteItem={deleteFromHistory}
        onCompare={handleComparison}
        onConsolidate={handleConsolidation}
        currentUser={headerData.collaboratorName} 
      />
      
      {/* HEADER INSTITUCIONAL */}
      <header className="bg-slate-900 border-b border-slate-800 py-3 sticky top-0 z-40 print:bg-white print:border-slate-200">
         <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
            <div className="flex items-center gap-4">
                <div className="bg-blue-600 p-2 rounded-lg shadow-lg">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                </div>
                <div>
                    <h1 className="text-lg font-black text-white tracking-wider print:text-slate-900">SP ASSESSORIA CONTÁBIL</h1>
                    <p className="text-[9px] text-blue-400 font-bold uppercase tracking-[0.2em] leading-none print:text-blue-600">Auditoria & Inteligência de Dados</p>
                </div>
            </div>
            <div className="flex items-center gap-3 print:hidden">
                <button onClick={toggleTheme} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">{darkMode ? '☀' : '🌙'}</button>
                <button onClick={() => setIsHistoryOpen(true)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 rounded-lg text-xs font-bold text-slate-300">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Histórico
                </button>
                {(analysisResult || comparisonResult || consolidationResult) && (
                    <button onClick={handleReset} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-700 shadow-md">Nova Análise</button>
                )}
            </div>
         </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {isLoading && <LoadingSpinner />}
        
        {!analysisResult && !comparisonResult && !consolidationResult && (
           <div className={isLoading ? 'opacity-50 blur-sm pointer-events-none' : 'space-y-8'}>
              <HeaderInputs 
                data={headerData} 
                onChange={setHeaderData} 
                onSave={handleManualSave}
                disabled={isLoading} 
              />
              
              <div className="bg-white dark:bg-slate-900 p-10 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-5">
                      <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M13 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V9l-7-7zm0 1.5L18.5 9H13V3.5zM6 20V4h6v6h6v10H6z"/></svg>
                  </div>
                  <div className="mb-8 text-center md:text-left">
                    <h2 className="text-3xl font-black text-slate-800 dark:text-white mb-2">Processamento de Documentos</h2>
                    <p className="text-slate-500 max-w-2xl">Carregue balanços, balancetes ou DRE para uma auditoria completa assistida por Inteligência Artificial exclusiva da SP Assessoria.</p>
                  </div>
                  
                  <FileUploader 
                    onFileSelected={(f, b, m) => { setSelectedFile({file: f, base64: b, mimeType: m || f.type}); setError(null); }} 
                    isLoading={isLoading} 
                    selectedFileName={selectedFile?.file.name} 
                  />
                  
                  {error && <div className="p-4 bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900/30 rounded-2xl mb-6 flex items-center gap-3 font-medium text-sm">
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      {error}
                  </div>}
                  
                  <button 
                    onClick={handleStartAnalysis} 
                    disabled={!isReady}
                    className={`w-full py-5 rounded-2xl font-black text-lg shadow-xl transition-all
                        ${isReady 
                            ? 'bg-blue-600 hover:bg-blue-700 text-white transform hover:scale-[1.01] shadow-blue-500/25 active:scale-95' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}`}
                  >
                     {isLoading ? 'Analisando Estrutura...' : isReady ? '🚀 Iniciar Auditoria SP Assessoria' : 'Carregue um arquivo para começar'}
                  </button>
              </div>
           </div>
        )}

        {analysisResult && !isLoading && !comparisonResult && !consolidationResult && (
            <div className="animate-fadeIn">
                <AnalysisViewer 
                    result={analysisResult} 
                    headerData={headerData} 
                    previousAccounts={previousAccounts}
                    analysisTimestamp={analysisTimestamp}
                />
            </div>
        )}

        {comparisonResult && !isLoading && !consolidationResult && (
            <div className="animate-fadeIn">
                <ComparisonViewer data={comparisonResult} onBack={() => { setComparisonResult(null); }} />
            </div>
        )}

        {consolidationResult && !isLoading && (
            <div className="animate-fadeIn">
                <ConsolidationViewer 
                    data={consolidationResult} 
                    onBack={() => setConsolidationResult(null)} 
                    collaboratorName={headerData.collaboratorName}
                />
            </div>
        )}
      </main>

      {/* RODAPÉ INSTITUCIONAL */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-6 mt-auto print:hidden">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="text-center md:text-left">
                  <p className="text-sm font-bold text-slate-800 dark:text-white">SP ASSESSORIA CONTÁBIL</p>
                  <p className="text-xs text-slate-500">Inteligência Contábil para o seu negócio.</p>
              </div>
              <div className="text-center md:text-right">
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                      desenvolvido by - SP Assessoria Contabil.
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                      © {new Date().getFullYear()} - Todos os direitos reservados.
                  </p>
              </div>
          </div>
      </footer>
      
      <ChatAssistant />
    </div>
  );
};

export default App;
