import React, { useState } from 'react';
import FileUploader, { UploadedFile } from './components/FileUploader';
import AnalysisViewer from './components/AnalysisViewer';
import ComparisonViewer from './components/ComparisonViewer';
import ConsolidationViewer from './components/ConsolidationViewer';
import ChatAssistant from './components/ChatAssistant';
import HeaderInputs from './components/HeaderInputs';
import { analyzeDocument } from './services/geminiService';
import { processConsolidation } from './services/consolidationService';

export default function App() {
  const [activeTab, setActiveTab] = useState<'analysis' | 'comparison' | 'consolidation'>('analysis');
  const [isGroupAnalysis, setIsGroupAnalysis] = useState(false);
  
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [analysisResults, setAnalysisResults] = useState<any[]>([]);
  const [consolidationResult, setConsolidationResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFilesSelected = (selectedFiles: any) => {
    setFiles(selectedFiles as UploadedFile[]);
    setError(null);
  };

  const handleProcessFiles = async () => {
    if (!files || files.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      if (isGroupAnalysis && files.length > 1) {
        // Fluxo de Holding / Grupo Econômico (Aglutinação de CNPJs)
        const results = [];
        for (const f of files) {
          const res = await analyzeDocument(f.base64, f.mimeType);
          results.push({ ...res, sourceFile: f.file.name });
        }
        setAnalysisResults(results);
        
        // Chama o serviço de consolidação que você já tem na pasta services
        const consolidated = await processConsolidation(results);
        setConsolidationResult(consolidated);
        setActiveTab('consolidation');

      } else {
        // Fluxo Simples / Comparação
        const results = [];
        for (const f of files) {
          const res = await analyzeDocument(f.base64, f.mimeType);
          results.push({ ...res, sourceFile: f.file.name });
        }
        setAnalysisResults(results);
        
        if (results.length > 1) {
          setActiveTab('comparison');
        } else {
          setActiveTab('analysis');
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ocorreu um erro ao processar os arquivos.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800">AuditaAI <span className="text-sm font-normal text-slate-500">| SP Assessoria</span></h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
          
          {/* Seletor de Holding / Grupo Econômico */}
          <div className="mb-6 flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div>
              <h3 className="font-semibold text-slate-800">Análise de Grupo Econômico (Holding)</h3>
              <p className="text-sm text-slate-500">Ative para aglutinar DREs de diferentes CNPJs em um único demonstrativo consolidado.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={isGroupAnalysis} onChange={() => setIsGroupAnalysis(!isGroupAnalysis)} disabled={isLoading} />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Uploader Integrado com a chave do Grupo */}
          <FileUploader 
            onFilesSelected={handleFilesSelected} 
            isLoading={isLoading} 
            isGroupAnalysis={isGroupAnalysis}
            selectedFileNames={files.map(f => f.file.name)} 
          />

          {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 text-sm font-medium">
              {error}
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button 
              onClick={handleProcessFiles} 
              disabled={files.length === 0 || isLoading}
              className={`px-6 py-3 rounded-xl font-bold text-white transition-all shadow-sm flex items-center gap-2
                ${files.length === 0 || isLoading ? 'bg-slate-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-md'}`}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Processando Auditoria...
                </>
              ) : 'Iniciar Análise Contábil'}
            </button>
          </div>
        </div>

        {/* Abas de Navegação (Aparecem após o processamento) */}
        {analysisResults.length > 0 && (
          <div className="mb-6 flex gap-2 border-b border-slate-200 pb-px">
            <button onClick={() => setActiveTab('analysis')} className={`px-4 py-2 font-medium text-sm rounded-t-lg transition-colors ${activeTab === 'analysis' ? 'bg-white border border-b-0 border-slate-200 text-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}>Análise Individual</button>
            {analysisResults.length > 1 && !isGroupAnalysis && (
              <button onClick={() => setActiveTab('comparison')} className={`px-4 py-2 font-medium text-sm rounded-t-lg transition-colors ${activeTab === 'comparison' ? 'bg-white border border-b-0 border-slate-200 text-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}>Comparação Horizontal</button>
            )}
            {isGroupAnalysis && consolidationResult && (
              <button onClick={() => setActiveTab('consolidation')} className={`px-4 py-2 font-medium text-sm rounded-t-lg transition-colors ${activeTab === 'consolidation' ? 'bg-white border border-b-0 border-slate-200 text-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}>Consolidação Holding</button>
            )}
          </div>
        )}

        {/* Roteamento de Visualização Baseado nos seus Componentes */}
        {activeTab === 'analysis' && analysisResults.length > 0 && (
          <div className="space-y-8">
            {analysisResults.map((res, idx) => (
              <AnalysisViewer key={idx} data={res} title={`Análise: ${res.sourceFile}`} />
            ))}
          </div>
        )}

        {activeTab === 'comparison' && analysisResults.length > 1 && (
          <ComparisonViewer results={analysisResults} />
        )}

        {activeTab === 'consolidation' && consolidationResult && (
          <ConsolidationViewer data={consolidationResult} />
        )}

      </main>

      {/* Assistente de Chat Flutuante */}
      {analysisResults.length > 0 && (
        <ChatAssistant contextData={analysisResults} />
      )}
    </div>
  );
}
