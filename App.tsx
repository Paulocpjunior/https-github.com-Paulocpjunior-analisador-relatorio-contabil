import React, { useState, useEffect } from 'react';
import HeaderInputs from './components/HeaderInputs';
import FileUploader from './components/FileUploader';
import AnalysisViewer from './components/AnalysisViewer';
import AnalysisHistory from './components/AnalysisHistory';
import ChatAssistant from './components/ChatAssistant';
import { HeaderData, AnalysisResult, HistoryItem } from './types';
import { analyzeDocument } from './services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const HISTORY_STORAGE_KEY = 'auditAI_history';
const CACHE_STORAGE_PREFIX = 'auditAI_cache_';
const THEME_STORAGE_KEY = 'auditAI_theme';
const MAX_HISTORY_ITEMS = 100; // Increased to allow lazy loading demonstration

const LoadingSpinner = () => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-fadeIn">
     <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center">
        <div className="relative flex items-center justify-center mb-6">
           <div className="animate-ping absolute inline-flex h-12 w-12 rounded-full bg-blue-500/20 opacity-75"></div>
           <div className="relative animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500"></div>
        </div>
        <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Analisando Documento...</h3>
        <p className="text-blue-500 font-medium animate-pulse">A IA está extraindo e validando os dados.</p>
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

  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (savedHistory) setHistory(JSON.parse(savedHistory));
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

  const saveToHistory = (result: AnalysisResult, header: HeaderData, fileName: string) => {
    const id = Date.now().toString();
    try { localStorage.setItem(`${CACHE_STORAGE_PREFIX}${id}`, JSON.stringify(result)); } catch (e) { console.warn("Cache full"); }
    const newItem: HistoryItem = { id, timestamp: new Date().toISOString(), headerData: { ...header }, fileName, summary: result.summary };
    const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    setHistory(updated);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  };

  const loadFromHistory = (item: HistoryItem) => {
      let fullResult = item.fullResult;
      if (!fullResult) {
          const cached = localStorage.getItem(`${CACHE_STORAGE_PREFIX}${item.id}`);
          if (cached) fullResult = JSON.parse(cached);
      }
      if (fullResult) {
          setHeaderData(item.headerData);
          setAnalysisResult(fullResult);
          setAnalysisTimestamp(item.timestamp);
          setSelectedFile({ file: { name: item.fileName } as File, base64: '', mimeType: '' });
          setError(null);
      } else { alert("Detalhes não encontrados no cache."); }
  };

  const handleStartAnalysis = async () => {
    if (!headerData.companyName || !headerData.collaboratorName) { setError("Preencha os dados da empresa."); return; }
    if (!selectedFile?.base64) { setError("Selecione um arquivo."); return; }
    setIsLoading(true); setError(null);
    try {
      // Use the explicitly processed mimeType (e.g., text/csv from Excel) or fallback to file.type
      const mime = selectedFile.mimeType || selectedFile.file.type;
      const result = await analyzeDocument(selectedFile.base64, mime);
      setAnalysisTimestamp(new Date().toISOString());
      setAnalysisResult(result);
      saveToHistory(result, headerData, selectedFile.file.name);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erro desconhecido na análise.");
    } finally { setIsLoading(false); }
  };

  const handleReset = () => { setAnalysisResult(null); setSelectedFile(null); setError(null); };

  // STRICT check: Must have base64 data to be considered ready
  const isReady = !isLoading && selectedFile !== null && selectedFile.base64.length > 0;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 pb-12 transition-colors duration-300">
      <AnalysisHistory 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)} 
        history={history} 
        onSelect={loadFromHistory} 
        onClear={() => setHistory([])}
        currentUser={headerData.collaboratorName} // Passing user context for filtering
      />
      
      <header className="bg-blue-600 dark:bg-blue-900 text-white py-4 shadow-md sticky top-0 z-10">
         <div className="max-w-5xl mx-auto px-4 flex justify-between items-center">
            <div>
                <h1 className="text-xl font-bold flex items-center"><span className="bg-white/20 p-1 rounded mr-2">AI</span> AuditAI</h1>
                <p className="text-[10px] text-blue-100 opacity-90 tracking-wide">
                    Sistema de Análise de Relatórios Contábeis - Desenvolvido BY SP Assessoria Contabil
                </p>
            </div>
            <div className="flex gap-2">
                <button onClick={toggleTheme} className="p-2 hover:bg-white/10 rounded-full">{darkMode ? '☀' : '🌙'}</button>
                <button onClick={() => setIsHistoryOpen(true)} className="p-2 hover:bg-white/10 rounded-full">Histórico</button>
                {analysisResult && <button onClick={handleReset} className="bg-white/20 px-3 py-1 rounded text-sm hover:bg-white/30">Nova</button>}
            </div>
         </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {isLoading && <LoadingSpinner />}
        {!analysisResult && (
           <div className={isLoading ? 'opacity-50 blur-sm pointer-events-none' : ''}>
              <HeaderInputs data={headerData} onChange={setHeaderData} disabled={isLoading} />
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">Upload do Documento</h2>
                  <FileUploader 
                    onFileSelected={(f, b, m) => { setSelectedFile({file: f, base64: b, mimeType: m || f.type}); setError(null); }} 
                    isLoading={isLoading} 
                    selectedFileName={selectedFile?.file.name} 
                  />
                  {error && <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded mb-4">{error}</div>}
                  
                  <button 
                    onClick={handleStartAnalysis} 
                    disabled={!isReady}
                    className={`w-full py-4 rounded-lg font-bold text-lg shadow-lg transition-all border-2
                        ${isReady 
                            ? 'bg-green-600 hover:bg-green-700 border-green-600 text-white transform hover:scale-[1.01] shadow-green-500/20' 
                            : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                     {isLoading ? 'Processando...' : isReady ? '✅ Iniciar Análise com IA' : 'Aguardando Arquivo...'}
                  </button>
              </div>
           </div>
        )}
        {analysisResult && !isLoading && (
            <div className="animate-fadeIn">
                <AnalysisViewer result={analysisResult} headerData={headerData} />
            </div>
        )}
      </main>
      
      {/* Floating Chat Bot */}
      <ChatAssistant />
    </div>
  );
};

export default App;