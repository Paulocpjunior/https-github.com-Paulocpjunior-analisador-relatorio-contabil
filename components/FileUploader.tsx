import React, { useCallback, useState } from 'react';

interface Props {
  onFileSelected: (file: File, base64: string) => void;
  isLoading: boolean;
  selectedFileName?: string;
}

const FileUploader: React.FC<Props> = ({ onFileSelected, isLoading, selectedFileName }) => {
  const [dragActive, setDragActive] = useState(false);
  const [fileSize, setFileSize] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const formatBytes = (bytes: number) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const processFile = useCallback((file: File) => {
    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!validTypes.includes(file.type)) {
        alert("Formato inválido. Use PDF ou Excel.");
        return;
    }
    setFileSize(formatBytes(file.size));
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result && typeof e.target.result === 'string') {
        onFileSelected(file, e.target.result.split(',')[1]);
      }
    };
    reader.readAsDataURL(file);
  }, [onFileSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
  }, [processFile]);

  return (
    <div className="mb-6">
      <label
        htmlFor="file-upload"
        className={`group relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 ease-in-out
          ${isLoading ? 'opacity-60 cursor-wait' : ''}
          ${dragActive ? 'border-blue-500 bg-blue-50' : selectedFileName ? 'border-green-500 bg-green-50/50 ring-4 ring-green-500/10' : 'border-slate-300 bg-white hover:bg-slate-50'}
        `}
        onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center p-4">
          {selectedFileName ? (
             <div className="animate-fadeIn flex flex-col items-center">
               <div className="bg-green-100 p-3 rounded-full mb-3 relative">
                   <span className="absolute inset-0 rounded-full bg-green-400 opacity-25 animate-ping"></span>
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-green-600 relative z-10">
                        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                    </svg>
               </div>
               <h3 className="text-lg font-bold text-green-800 mb-1">Arquivo Carregado com Sucesso!</h3>
               <p className="text-slate-600 text-sm mb-4">{selectedFileName} <span className="text-slate-400">({fileSize})</span></p>
               <p className="text-blue-600 font-bold animate-pulse text-sm">⬇ Clique em "Iniciar Análise" abaixo para processar</p>
             </div>
          ) : (
             <>
              <div className="p-4 rounded-full bg-slate-100 mb-4 text-slate-400 group-hover:text-blue-500 group-hover:bg-blue-50 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
              </div>
              <p className="mb-2 text-lg text-slate-700 font-medium"><span className="text-blue-600 font-bold hover:underline">Clique para selecionar</span> ou arraste</p>
              <p className="text-sm text-slate-500">PDF ou Excel (Max 20MB)</p>
            </>
          )}
        </div>
        <input id="file-upload" type="file" className="hidden" accept=".pdf, .xlsx, .xls" onChange={handleChange} disabled={isLoading} />
      </label>
    </div>
  );
};

export default FileUploader;