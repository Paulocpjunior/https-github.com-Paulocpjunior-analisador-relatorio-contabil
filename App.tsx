import React, { useState, useEffect } from 'react';
import HeaderInputs from './components/HeaderInputs';
import FileUploader from './components/FileUploader';
import AnalysisViewer from './components/AnalysisViewer';
import { HeaderData, AnalysisResult } from './types';
import { analyzeDocument } from './services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const LoadingSpinner = () => {
  const [message, setMessage] = useState("Lendo documento...");
  
  useEffect(() => {
    const messages = [
      "Lendo documento...",
      "Identificando colunas...",
      "Extraindo contas contábeis...",
      "Verificando ortografia...",
      "Validando totais e balanço..."
    ];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setMessage(messages[i]);
    }, 2500); // Change message every 2.5 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-fadeIn">
       <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-full mx-4 border border-slate-100">
          <div className="relative flex items-center justify-center mb-6">
             <div className="animate-ping absolute inline-flex h-12 w-12 rounded-full bg-blue-500/20 opacity-75"></div>
             <div className="relative animate-spin rounded-full h-16 w-16 border-t-4 border-blue-500"></div>
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">Analisando com IA</h3>
          <p className="text-blue-500 font-medium text-center animate-pulse min-h-[24px]">
              {message}
          </p>
          <p className="text-slate-400 text-xs text-center mt-4">
              Isso pode levar alguns segundos dependendo do tamanho do arquivo.
          </p>
       </div>
    </div>
  );
};

const App: React.FC = () => {
  const [headerData, setHeaderData] = useState<HeaderData>({
    companyName: '',
    collaboratorName: '',
    cnpj: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  // New state to hold the selected file before analysis
  const [selectedFile, setSelectedFile] = useState<{file: File, base64: string} | null>(null);

  const handleFileSelected = (file: File, base64: string) => {
    setError(null);
    setSelectedFile({ file, base64 });
    // Reset previous results if any when a new file is picked
    setAnalysisResult(null);
  };

  const handleStartAnalysis = async () => {
    // Basic validation - ensure at least company is provided along with collaborator
    if (!headerData.companyName.trim() || !headerData.collaboratorName.trim()) {
      setError("Por favor, preencha as informações da Empresa/Cliente e do Colaborador antes de iniciar a análise.");
      window.scrollTo(0, 0);
      return;
    }

    if (!selectedFile) {
      setError("Por favor, selecione um arquivo para analisar.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await analyzeDocument(selectedFile.base64, selectedFile.file.type);
      setAnalysisResult(result);
    } catch (err: any) {
      let errorMessage = "Falha ao analisar o documento. Tente novamente.";
      if (err.message && err.message.includes("API Key")) {
        errorMessage = "Erro de configuração: Chave da API não encontrada.";
      } else if (err.message) {
        errorMessage = `Erro: ${err.message}`;
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
      setAnalysisResult(null);
      setSelectedFile(null);
      setError(null);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const generatePDF = (applyCorrections: boolean) => {
    if (!analysisResult) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // --- Header ---
    doc.setFillColor(15, 23, 42); // Primary color (slate-900)
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text("AuditAI - Relatório de Análise", 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(200, 200, 200);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);

    // --- Info Section ---
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    
    let curY = 50;
    doc.text(`Cliente: ${headerData.companyName}`, 14, curY);
    curY += 8;
    if (headerData.cnpj) {
        doc.text(`CNPJ: ${headerData.cnpj}`, 14, curY);
        curY += 8;
    }
    doc.text(`Responsável: ${headerData.collaboratorName}`, 14, curY);
    curY += 8;
    doc.text(`Arquivo Analisado: ${selectedFile?.file.name || 'N/A'}`, 14, curY);
    curY += 8;
    doc.text(`Tipo de Documento: ${analysisResult.summary.document_type}`, 14, curY);
    curY += 6; // Extra spacing before line

    // --- Summary Section ---
    doc.setDrawColor(200, 200, 200);
    doc.line(14, curY, pageWidth - 14, curY);
    curY += 10;

    doc.setFontSize(14);
    doc.text("Resumo Financeiro", 14, curY);
    curY += 10;
    doc.setFontSize(11);
    doc.text(`Total Débitos: ${formatCurrency(analysisResult.summary.total_debits)}`, 14, curY);
    curY += 8;
    doc.text(`Total Créditos: ${formatCurrency(analysisResult.summary.total_credits)}`, 14, curY);
    curY += 8;
    
    const balanceText = analysisResult.summary.is_balanced ? "BALANCEADO" : "DESBALANCEADO";
    doc.setTextColor(analysisResult.summary.is_balanced ? 0 : 220, analysisResult.summary.is_balanced ? 128 : 0, 0);
    doc.text(`Status: ${balanceText}`, 14, curY);
    curY += 8;
    
    if (!analysisResult.summary.is_balanced) {
        doc.setTextColor(220, 0, 0);
        doc.text(`Diferença: ${formatCurrency(analysisResult.summary.discrepancy_amount)}`, 14, curY);
        curY += 8;
    }
    doc.setTextColor(0, 0, 0);
    curY += 10;

    // --- Observations ---
    if (analysisResult.summary.observations.length > 0) {
        doc.setFontSize(14);
        doc.text("Observações da IA", 14, curY);
        curY += 8;
        doc.setFontSize(10);
        analysisResult.summary.observations.forEach((obs) => {
            const splitText = doc.splitTextToSize(`• ${obs}`, pageWidth - 28);
            // Check if we need a new page
            if (curY + (splitText.length * 5) > doc.internal.pageSize.getHeight() - 20) {
                doc.addPage();
                curY = 20;
            }
            doc.text(splitText, 14, curY);
            curY += (splitText.length * 5) + 2;
        });
        curY += 10;
    }

    // --- Accounts Table ---
    // Check for new page before table starts if space is low
    if (curY > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage();
        curY = 20;
    }

    doc.setFontSize(14);
    const tableTitle = applyCorrections ? "Detalhamento de Contas (Com Correções Ortográficas)" : "Detalhamento de Contas (Original)";
    doc.text(tableTitle, 14, curY);
    curY += 5;

    const tableColumn = ["Código", "Conta", "Débito", "Crédito", "Tipo"];
    
    // Prepare data, optionally applying corrections
    let accountsData = analysisResult.accounts;
    if (applyCorrections && analysisResult.spell_check.length > 0) {
        accountsData = accountsData.map(acc => {
            let correctedName = acc.account_name;
            // Apply all spell check suggestions to the name
            analysisResult.spell_check.forEach(sc => {
                // Escape special regex characters in the original term to match literally
                const escapedOriginal = sc.original_term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedOriginal, 'gi');
                correctedName = correctedName.replace(regex, sc.suggested_correction);
            });
            return { ...acc, account_name: correctedName };
        });
    }

    const tableRows = accountsData.map(acc => [
        acc.account_code || '',
        acc.account_name,
        acc.debit_value > 0 ? formatCurrency(acc.debit_value) : '',
        acc.credit_value > 0 ? formatCurrency(acc.credit_value) : '',
        acc.type === 'Debit' ? 'Devedora' : acc.type === 'Credit' ? 'Credora' : '?'
    ]);

    // Add total row
    tableRows.push([
        '',
        'TOTAIS',
        formatCurrency(analysisResult.summary.total_debits),
        formatCurrency(analysisResult.summary.total_credits),
        ''
    ]);

    autoTable(doc, {
        startY: curY,
        head: [tableColumn],
        body: tableRows,
        headStyles: { fillColor: [15, 23, 42] },
        styles: { fontSize: 9 },
        footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
        margin: { top: 20 } // useful if table splits across pages
    });

    const filenameCompany = headerData.companyName || 'Relatorio';
    const suffix = applyCorrections ? '_Corrigido' : '';
    doc.save(`AuditAI-${filenameCompany.replace(/\s+/g, '_')}${suffix}.pdf`);
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-12">
      {/* Top Navigation Bar */}
      <header className="bg-blue-600 text-white py-4 shadow-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Replaced SVG with user logo image */}
            <img 
              src="https://placehold.co/80x80/1e40af/ffffff?text=LOGO" 
              alt="Logo" 
              className="w-12 h-12 object-contain rounded-md bg-white/10 p-1" 
            />
            <div className="flex flex-col">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <h1 className="text-xl font-bold tracking-tight leading-none">AuditAI</h1>
                    <span className="text-[11px] md:text-xs text-blue-200 font-medium leading-tight">Desenvolvido By SP Assessoria Contábil</span>
                </div>
                <span className="text-sm font-normal text-blue-100 leading-tight mt-0.5">Análise Contábil Inteligente</span>
            </div>
          </div>
          <div className="flex space-x-3">
             {analysisResult && (
                <>
                     {/* Standard Export */}
                     <button
                        onClick={() => generatePDF(false)}
                        className="text-sm bg-blue-800 hover:bg-blue-700 text-white py-2 px-3 rounded-md transition-colors flex items-center font-medium"
                        title="Exportar exatamente como lido do documento"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-2 md:mr-1 lg:mr-2">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className="hidden md:inline">PDF Original</span><span className="md:hidden">PDF</span>
                     </button>

                     {/* Corrected Export (only if there are suggestions) */}
                     {analysisResult.spell_check.length > 0 && (
                        <button
                            onClick={() => generatePDF(true)}
                            className="text-sm bg-green-600 hover:bg-green-500 text-white py-2 px-3 rounded-md transition-colors flex items-center font-medium ml-2"
                            title="Exportar com as sugestões de correção ortográfica aplicadas"
                        >
                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mr-2 md:mr-1 lg:mr-2">
                               <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                             </svg>
                            <span className="hidden md:inline">PDF Corrigido</span><span className="md:hidden">Corrigido</span>
                        </button>
                     )}
                     
                    <button
                      onClick={handleReset}
                      className="text-sm text-white/80 hover:text-white py-2 px-4 rounded-md hover:bg-white/10 transition-colors ml-4"
                    >
                      Nova Análise
                    </button>
                </>
             )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {isLoading && <LoadingSpinner />}

        {!analysisResult && (
          <div className={`transition-all duration-500 ${isLoading ? 'opacity-50 pointer-events-none blur-sm' : 'opacity-100'}`}>
             <HeaderInputs data={headerData} onChange={setHeaderData} disabled={isLoading} />
             
             <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2 text-blue-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  Upload do Documento Contábil
                </h2>
                
                <FileUploader 
                    onFileSelected={handleFileSelected} 
                    isLoading={isLoading} 
                    selectedFileName={selectedFile?.file.name}
                />

                {error && (
                  <div className="mt-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm flex items-center animate-shake">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 mr-2 flex-shrink-0">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </div>
                )}

                <div className="mt-6">
                  <button
                    onClick={handleStartAnalysis}
                    disabled={isLoading || !selectedFile}
                    className={`w-full py-3 px-4 rounded-lg font-bold text-white text-lg flex items-center justify-center transition-all
                      ${isLoading || !selectedFile 
                        ? 'bg-slate-400 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl active:scale-[0.99]'
                      }`}
                  >
                    {isLoading ? (
                       'Processando...'
                    ) : (
                       <>
                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 mr-2">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                         </svg>
                         Iniciar Análise com IA
                       </>
                    )}
                  </button>
                </div>
             </div>
          </div>
        )}

        {analysisResult && !isLoading && (
           <AnalysisViewer result={analysisResult} />
        )}
      </main>
    </div>
  );
};

export default App;
