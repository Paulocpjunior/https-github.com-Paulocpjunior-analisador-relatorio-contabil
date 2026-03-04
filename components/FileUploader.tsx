import React, { useCallback, useState } from 'react';
import * as XLSX from 'xlsx';

export interface UploadedFile {
  file: File;
  base64: string;
  mimeType: string;
}

interface Props {
  onFilesSelected: (files: FileList | File[]) => void;
  isLoading: boolean;
  disabled?: boolean;
  isGroupAnalysis?: boolean;
  selectedFileNames?: string[];
}

const FileUploader: React.FC<Props> = ({
  onFilesSelected,
  isLoading,
  disabled,
  isGroupAnalysis,
  selectedFileNames
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading || isReading) return;
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, [isLoading, isReading]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setIsReading(true);
    setUploadProgress(0);

    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'text/plain'];

    const processedFiles: UploadedFile[] = [];
    let completed = 0;
    const totalFiles = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.pdf') && !file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
        alert(`Formato inválido no arquivo ${file.name}. Use PDF, Excel ou TXT (SPED).`);
        completed++;
        continue;
      }

      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      const isText = file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.csv');

      try {
        const uploadedFile = await new Promise<UploadedFile | null>((resolve, reject) => {
          if (isExcel) {
            const reader = new FileReader();
            reader.onload = (e) => {
              try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const csvOutput = XLSX.utils.sheet_to_csv(firstSheet, { FS: '|' });
                const base64 = btoa(unescape(encodeURIComponent(csvOutput)));
                resolve({ file, base64, mimeType: 'text/csv' });
              } catch (err) {
                console.error(`Excel Parse Error: ${file.name}`, err);
                resolve(null);
              }
            };
            reader.onerror = () => resolve(null);
            reader.readAsArrayBuffer(file);
          } else if (isText) {
            const reader = new FileReader();
            reader.onload = (e) => {
              try {
                const textContent = e.target!.result as string;
                const base64 = btoa(unescape(encodeURIComponent(textContent)));
                resolve({ file, base64, mimeType: 'text/plain' });
              } catch (err) {
                console.error(`Text Parse Error: ${file.name}`, err);
                resolve(null);
              }
            };
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
          } else {
            const reader = new FileReader();
            reader.onload = (e) => {
              if (e.target?.result && typeof e.target.result === 'string') {
                let mimeType = file.type;
                if (!mimeType && file.name.toLowerCase().endsWith('.pdf')) {
                  mimeType = 'application/pdf';
                }
                resolve({ file, base64: e.target.result.split(',')[1], mimeType });
              } else {
                resolve(null);
              }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }
        });

        if (uploadedFile) {
          processedFiles.push(uploadedFile);
        }
      } catch (e) {
        console.error(`Error processing file: ${file.name}`, e);
      }

      completed++;
      setUploadProgress(Math.round((completed / totalFiles) * 100));
    }

    onFilesSelected(processedFiles);
    setIsReading(false);
  }, [onFilesSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (isLoading || isReading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles, isLoading, isReading]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (isLoading || isReading) return;
    if (e.target.files && e.target.files.length > 0) processFiles(e.target.files);
  }, [processFiles, isLoading, isReading]);

  const isLocked = isLoading || isReading || disabled;

  return (
    <div className="mb-6">
      <label
        htmlFor="file-upload"
        className={`group relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl transition-all duration-300 ease-in-out
          ${isLocked ? 'cursor-wait opacity-80 bg-slate-50' : 'cursor-pointer'}
          ${dragActive ? 'border-blue-500 bg-blue-50 scale-[1.02]' : (selectedFileNames && selectedFileNames.length > 0) ? 'border-green-500 bg-green-50/30' : 'border-slate-300 bg-white hover:bg-slate-50 hover:border-blue-400'}
        `}
        onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center p-4 w-full h-full overflow-y-auto">

          {/* READING PROGRESS STATE */}
          {isReading && (
            <div className="w-3/4 max-w-md animate-fadeIn">
              <div className="flex justify-between mb-1">
                <span className="text-sm font-medium text-blue-700">Lendo e Processando...</span>
                <span className="text-sm font-medium text-blue-700">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2.5">
                <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
              </div>
              <p className="text-xs text-slate-400 mt-2">Convertendo arquivo para análise...</p>
            </div>
          )}

          {/* SUCCESS STATE */}
          {!isReading && selectedFileNames && selectedFileNames.length > 0 ? (
            <div className="animate-scaleIn flex flex-col items-center">
              <div className="bg-green-100 p-4 rounded-full mb-3 relative shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-green-600 relative z-10">
                  <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75-9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-green-800 mb-1">{selectedFileNames.length > 1 ? 'Uploads Completos!' : 'Upload Completo!'}</h3>
              <div className="flex flex-wrap items-center justify-center gap-2 max-h-20 overflow-y-auto mb-1">
                {selectedFileNames.map((name, i) => (
                  <span key={i} className="text-xs text-slate-600 font-medium bg-white px-2 py-1 border rounded-md shadow-sm truncate max-w-[150px]">{name}</span>
                ))}
              </div>
              <p className="text-xs text-slate-400 mb-4">{selectedFileNames.length} arquivo(s) pronto(s) para uso</p>

              <div className="flex items-center gap-2 text-sm text-blue-600 font-bold bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 mt-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                </span>
                Ação Necessária: Clique em "Iniciar Análise"
              </div>
            </div>
          ) : !isReading && (
            <>
              {/* DEFAULT STATE */}
              <div className="p-4 rounded-full bg-slate-100 mb-4 text-slate-400 group-hover:text-blue-500 group-hover:bg-blue-50 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
              </div>
              <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-blue-600 dark:text-blue-400">Clique para selecionar</span> ou arraste e solte {isGroupAnalysis ? 'os relatórios das empresas do grupo' : 'o balanço patrimonial, balancete ou DRE'} aqui
              </p>
            </>
          )}
        </div>
        <input id="file-upload" type="file" multiple className="hidden" accept=".pdf, .xlsx, .xls, .txt, .csv" onChange={handleChange} disabled={isLocked} />
      </label>
    </div>
  );
};

export default FileUploader;