import React, { useCallback, useState } from 'react';

interface Props {
  onFileSelected: (file: File, base64: string) => void;
  isLoading: boolean;
  selectedFileName?: string;
}

const FileUploader: React.FC<Props> = ({ onFileSelected, isLoading, selectedFileName }) => {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const processFile = useCallback((file: File) => {
    const validTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel' // .xls
    ];

    if (!validTypes.includes(file.type)) {
        alert("Formato de arquivo não suportado. Por favor use apenas PDF ou Excel (.xlsx/.xls).");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result && typeof e.target.result === 'string') {
        const base64 = e.target.result.split(',')[1];
        onFileSelected(file, base64);
      }
    };
    reader.readAsDataURL(file);
  }, [onFileSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [processFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  }, [processFile]);

  return (
    <div className="mb-2">
      <label
        htmlFor="file-upload"
        className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl cursor-pointer transition-all
          ${dragActive ? 'border-accent bg-blue-50' : selectedFileName ? 'border-green-50 bg-green-50' : 'border-slate-300 bg-white hover:bg-slate-50'}
          ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center p-4">
          {selectedFileName ? (
             <>
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 mb-4 text-green-600">
                 <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
               </svg>
               <p className="text-lg font-semibold text-green-800 mb-1">Arquivo Selecionado!</p>
               <p className="text-base font-medium text-slate-700 bg-white px-4 py-2 rounded-md border border-slate-200 shadow-sm max-w-xs truncate">
                 {selectedFileName}
               </p>
               <p className="text-sm text-slate-500 mt-4">Clique ou arraste para trocar de arquivo</p>
             </>
          ) : (
             <>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-12 h-12 mb-4 ${dragActive ? 'text-accent' : 'text-slate-400'}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p className="mb-2 text-lg text-slate-700">
                <span className="font-semibold">Clique para selecionar</span> ou arraste e solte
              </p>
              <p className="text-sm text-slate-500">
                PDF ou Excel (MÁX. 20MB)
              </p>
            </>
          )}
        </div>
        <input
          id="file-upload"
          type="file"
          className="hidden"
          accept=".pdf, .xlsx, .xls"
          onChange={handleChange}
          disabled={isLoading}
        />
      </label>
    </div>
  );
};

export default FileUploader;