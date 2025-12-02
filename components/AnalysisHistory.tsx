import React, { useState, useMemo, useEffect } from 'react';
import { HistoryItem } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onClear: () => void;
  onCompare?: (item1: HistoryItem, item2: HistoryItem) => void; // New Prop
  currentUser?: string;
}

const ITEMS_PER_PAGE = 10;

const AnalysisHistory: React.FC<Props> = ({ isOpen, onClose, history, onSelect, onClear, onCompare, currentUser }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all');
  const [itemsToShow, setItemsToShow] = useState(ITEMS_PER_PAGE);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Reset pagination when filter or modal state changes
  useEffect(() => {
    setItemsToShow(ITEMS_PER_PAGE);
    if (!isOpen) {
        setIsCompareMode(false);
        setSelectedIds([]);
    }
  }, [isOpen, searchTerm, viewMode]);

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  const filteredHistory = useMemo(() => {
    let data = history;

    if (viewMode === 'mine' && currentUser) {
        data = data.filter(item => 
            item.headerData.collaboratorName && 
            item.headerData.collaboratorName.toLowerCase().trim() === currentUser.toLowerCase().trim()
        );
    }

    if (!searchTerm.trim()) {
      return data;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return data.filter(item =>
      (item.headerData.collaboratorName && item.headerData.collaboratorName.toLowerCase().includes(lowercasedFilter)) ||
      (item.headerData.companyName && item.headerData.companyName.toLowerCase().includes(lowercasedFilter)) ||
      (item.fileName && item.fileName.toLowerCase().includes(lowercasedFilter)) ||
      formatDate(item.timestamp).includes(lowercasedFilter)
    );
  }, [history, searchTerm, viewMode, currentUser]);

  const displayedItems = useMemo(() => {
    return filteredHistory.slice(0, itemsToShow);
  }, [filteredHistory, itemsToShow]);

  const handleLoadMore = () => {
    setItemsToShow(prev => prev + ITEMS_PER_PAGE);
  };

  const toggleSelection = (id: string, docType: string) => {
      if (selectedIds.includes(id)) {
          setSelectedIds(prev => prev.filter(item => item !== id));
      } else {
          if (selectedIds.length < 2) {
              // Check compatibility
              if (selectedIds.length === 1) {
                  const firstItem = history.find(h => h.id === selectedIds[0]);
                  if (firstItem && firstItem.summary.document_type !== docType) {
                      alert("Para comparar, selecione documentos do mesmo tipo (ex: Balanço com Balanço).");
                      return;
                  }
              }
              setSelectedIds(prev => [...prev, id]);
          } else {
              alert("Selecione apenas 2 itens para comparação.");
          }
      }
  };

  const executeComparison = () => {
      if (selectedIds.length !== 2 || !onCompare) return;
      const item1 = history.find(h => h.id === selectedIds[0]);
      const item2 = history.find(h => h.id === selectedIds[1]);
      if (item1 && item2) {
          // Sort by timestamp to ensure correct Order (Old -> New)
          const sorted = [item1, item2].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          onCompare(sorted[0], sorted[1]);
          onClose();
      }
  };

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className={`absolute inset-y-0 right-0 max-w-md w-full bg-white dark:bg-slate-800 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="px-6 py-4 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Histórico de Consultas
          </h2>
          <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* FILTERS */}
        <div className="px-4 pt-4 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-center justify-between mb-3">
                <label className="flex items-center cursor-pointer select-none">
                    <div className="relative">
                        <input type="checkbox" className="sr-only" checked={isCompareMode} onChange={e => { setIsCompareMode(e.target.checked); setSelectedIds([]); }} />
                        <div className={`block w-10 h-6 rounded-full transition-colors ${isCompareMode ? 'bg-purple-600' : 'bg-slate-300'}`}></div>
                        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isCompareMode ? 'transform translate-x-4' : ''}`}></div>
                    </div>
                    <span className="ml-2 text-sm font-bold text-slate-700 dark:text-slate-300">Modo Comparação</span>
                </label>
                {isCompareMode && selectedIds.length === 2 && (
                    <button onClick={executeComparison} className="bg-purple-600 text-white text-xs px-3 py-1.5 rounded-full font-bold animate-pulse">
                        Comparar (2)
                    </button>
                )}
            </div>

            <div className="flex bg-slate-200 dark:bg-slate-700 rounded-lg p-1 mb-3">
                <button 
                    onClick={() => setViewMode('all')} 
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                        viewMode === 'all' 
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' 
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                    }`}
                >
                    Todas
                </button>
                <button 
                    onClick={() => setViewMode('mine')} 
                    disabled={!currentUser}
                    title={!currentUser ? "Defina um colaborador na tela inicial" : ""}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                        viewMode === 'mine' 
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' 
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                >
                    Meus Relatórios
                </button>
            </div>
            
            <div className="relative mb-2">
                <input
                type="text"
                placeholder="Filtrar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-3 pr-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
            </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50 dark:bg-slate-800/50">
          {history.length === 0 ? (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
              <p>Nenhuma análise salva.</p>
            </div>
          ) : filteredHistory.length === 0 ? (
             <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                <p>Nenhum resultado encontrado.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedItems.map((item) => (
                <div 
                  key={item.id}
                  onClick={() => {
                      if (isCompareMode) {
                          toggleSelection(item.id, item.summary.document_type);
                      } else {
                          onSelect(item); 
                          onClose();
                      }
                  }}
                  className={`bg-white dark:bg-slate-700 p-4 rounded-lg border shadow-sm cursor-pointer transition-all group relative ${
                      selectedIds.includes(item.id) 
                      ? 'border-purple-500 ring-2 ring-purple-500 ring-offset-2' 
                      : 'border-slate-200 dark:border-slate-600 hover:border-blue-400'
                  }`}
                >
                  {isCompareMode && (
                      <div className={`absolute top-2 right-2 w-5 h-5 rounded border flex items-center justify-center ${selectedIds.includes(item.id) ? 'bg-purple-600 border-purple-600' : 'border-slate-400'}`}>
                          {selectedIds.includes(item.id) && <span className="text-white text-xs">✓</span>}
                      </div>
                  )}

                  {/* Row 1: Company & Date */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 mr-2">
                        <p className="font-bold text-slate-800 dark:text-white text-sm leading-tight">
                            {item.headerData.companyName || 'Não informada'}
                        </p>
                    </div>
                    <div className="text-right">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-600 px-2 py-1 rounded whitespace-nowrap block">
                            {formatDate(item.timestamp)}
                        </span>
                    </div>
                  </div>

                  {/* Row 3: File & Details */}
                  <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-600 pt-3">
                     <span className="text-xs text-slate-500 truncate max-w-[60%]">{item.fileName}</span>
                     <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                            {item.summary.document_type.split(' ')[0]}
                        </span>
                     </div>
                  </div>
                </div>
              ))}
              
              {filteredHistory.length > itemsToShow && (
                  <button onClick={handleLoadMore} className="w-full py-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-medium text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
                    Carregar mais...
                  </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isCompareMode && history.length > 0 && (
          <div className="p-4 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
            <button onClick={onClear} className="w-full py-2 px-4 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md text-sm font-medium transition-colors">
              Limpar Cache
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisHistory;