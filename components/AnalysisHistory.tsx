
import React, { useState, useMemo, useEffect } from 'react';
import { HistoryItem } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onClear: () => void;
  onDeleteItem?: (id: string) => void;
  onCompare?: (item1: HistoryItem, item2: HistoryItem) => void;
  onConsolidate?: (items: HistoryItem[]) => void;
  currentUser?: string;
}

const ITEMS_PER_PAGE = 8;

const HistoryListItem = React.memo(({ 
    item, 
    isSelected, 
    isSelectionMode, 
    onClick,
    onDelete 
}: { 
    item: HistoryItem, 
    isSelected: boolean, 
    isSelectionMode: boolean, 
    onClick: () => void,
    onDelete: (e: React.MouseEvent) => void
}) => {
    const dateStr = new Date(item.timestamp).toLocaleString('pt-BR', { 
        day: '2-digit', month: '2-digit', year: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
    });

    const docTypeColors: Record<string, string> = {
        'Balanço Patrimonial': 'bg-blue-100 text-blue-700 border-blue-200',
        'DRE': 'bg-emerald-100 text-emerald-700 border-emerald-200',
        'Balancete': 'bg-purple-100 text-purple-700 border-purple-200',
        'Outro': 'bg-slate-100 text-slate-700 border-slate-200'
    };

    return (
        <div 
            onClick={onClick}
            className={`group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer shadow-sm ${
                isSelected 
                ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/30 dark:bg-blue-900/10' 
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-slate-500'
            }`}
        >
            {isSelectionMode && (
                <div className={`absolute top-3 right-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isSelected ? 'bg-blue-600 border-blue-600 shadow-lg shadow-blue-500/30' : 'border-slate-300 dark:border-slate-600'
                }`}>
                    {isSelected && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
            )}

            {!isSelectionMode && (
                <button 
                    onClick={onDelete}
                    className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Excluir do histórico"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            )}

            <div className="mb-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${docTypeColors[item.summary.document_type] || docTypeColors['Outro']}`}>
                    {item.summary.document_type}
                </span>
                <p className="font-bold text-slate-800 dark:text-white mt-1.5 leading-tight truncate pr-8" title={item.headerData.companyName}>
                    {item.headerData.companyName || 'Empresa não Identificada'}
                </p>
                <p className="text-[10px] text-slate-400 font-mono mt-0.5">{item.headerData.cnpj || 'CNPJ não inf.'}</p>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    {dateStr}
                </div>
                <div className="flex items-center gap-1.5 max-w-[100px] truncate">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    {item.headerData.collaboratorName || 'Sistema'}
                </div>
            </div>
        </div>
    );
});

const AnalysisHistory: React.FC<Props> = ({ 
    isOpen, 
    onClose, 
    history, 
    onSelect, 
    onClear, 
    onDeleteItem,
    onCompare,
    onConsolidate, 
    currentUser 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all');
  const [itemsToShow, setItemsToShow] = useState(ITEMS_PER_PAGE);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) {
        setIsSelectionMode(false);
        setSelectedIds([]);
        setSearchTerm('');
    }
  }, [isOpen]);

  const filteredHistory = useMemo(() => {
    let data = [...history];

    if (viewMode === 'mine' && currentUser) {
        data = data.filter(item => 
            item.headerData.collaboratorName?.toLowerCase().trim() === currentUser.toLowerCase().trim()
        );
    }

    if (searchTerm.trim()) {
        const s = searchTerm.toLowerCase();
        data = data.filter(item =>
          item.headerData.companyName?.toLowerCase().includes(s) ||
          item.fileName?.toLowerCase().includes(s) ||
          item.summary.document_type.toLowerCase().includes(s)
        );
    }
    return data;
  }, [history, searchTerm, viewMode, currentUser]);

  const displayedItems = filteredHistory.slice(0, itemsToShow);

  const toggleSelection = (id: string, docType: string) => {
      if (selectedIds.includes(id)) {
          setSelectedIds(prev => prev.filter(item => item !== id));
      } else {
          // Check consistency: Consolidation requires same DocType (ideally DRE)
          if (selectedIds.length > 0) {
              const firstItem = history.find(h => h.id === selectedIds[0]);
              if (firstItem && firstItem.summary.document_type !== docType) {
                  alert("Para comparar ou consolidar, selecione documentos do mesmo tipo (ex: Todos DRE).");
                  return;
              }
          }
          setSelectedIds(prev => [...prev, id]);
      }
  };

  const handleItemClick = (item: HistoryItem) => {
      if (isSelectionMode) {
          toggleSelection(item.id, item.summary.document_type);
      } else {
          onSelect(item);
      }
  };

  const handleAction = (action: 'compare' | 'consolidate') => {
      if (action === 'compare') {
          if (selectedIds.length !== 2) return;
          const i1 = history.find(h => h.id === selectedIds[0]);
          const i2 = history.find(h => h.id === selectedIds[1]);
          if (i1 && i2 && onCompare) {
              const sorted = [i1, i2].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
              onCompare(sorted[0], sorted[1]);
          }
      } else if (action === 'consolidate') {
          if (selectedIds.length < 2) return;
          const items = selectedIds.map(id => history.find(h => h.id === id)).filter(Boolean) as HistoryItem[];
          if (onConsolidate) onConsolidate(items);
      }
  };

  return (
    <div className={`fixed inset-0 z-50 transition-all duration-300 ${isOpen ? 'visible' : 'invisible'}`}>
      <div 
        className={`absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <div className={`absolute inset-y-0 right-0 max-w-md w-full bg-slate-50 dark:bg-slate-900 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        {/* HEADER */}
        <div className="px-6 py-5 bg-white dark:bg-slate-800 border-b dark:border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Histórico de Auditoria
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Gerencie e compare suas análises salvas</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        {/* SEARCH AND FILTERS */}
        <div className="p-4 bg-white dark:bg-slate-800 border-b dark:border-slate-700 space-y-4">
            <div className="relative">
                <input 
                    type="text" 
                    placeholder="Filtrar por empresa, tipo ou arquivo..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-900 border-transparent focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl text-sm transition-all" 
                />
                <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>

            <div className="flex gap-2">
                <div className="flex bg-slate-100 dark:bg-slate-900 rounded-lg p-1 flex-1">
                    <button 
                        onClick={() => setViewMode('all')} 
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'all' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-500'}`}
                    >
                        Todas
                    </button>
                    <button 
                        onClick={() => setViewMode('mine')} 
                        disabled={!currentUser}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'mine' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-500 disabled:opacity-40'}`}
                    >
                        Minhas
                    </button>
                </div>
                
                <button 
                    onClick={() => { setIsSelectionMode(!isSelectionMode); setSelectedIds([]); }}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                        isSelectionMode ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                >
                    {isSelectionMode ? 'Cancelar Seleção' : 'Selecionar'}
                </button>
            </div>
        </div>

        {/* LIST */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <h3 className="text-slate-800 dark:text-white font-bold">Nenhuma análise encontrada</h3>
                <p className="text-sm text-slate-500 mt-1">Realize uma nova análise para vê-la aqui ou altere seus filtros.</p>
            </div>
          ) : (
            <>
              {displayedItems.map((item) => (
                <HistoryListItem 
                    key={item.id} 
                    item={item} 
                    isSelected={selectedIds.includes(item.id)} 
                    isSelectionMode={isSelectionMode} 
                    onClick={() => handleItemClick(item)}
                    onDelete={(e) => {
                        e.stopPropagation();
                        if(confirm('Tem certeza que deseja excluir esta análise permanentemente?')) {
                            onDeleteItem?.(item.id);
                        }
                    }}
                />
              ))}
              
              {filteredHistory.length > itemsToShow && (
                <button 
                    onClick={() => setItemsToShow(prev => prev + ITEMS_PER_PAGE)}
                    className="w-full py-3 text-sm font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/10 rounded-xl transition-all"
                >
                    Carregar mais registros
                </button>
              )}
            </>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="p-4 bg-white dark:bg-slate-800 border-t dark:border-slate-700">
            {isSelectionMode ? (
                <div className="space-y-3">
                     <div className="grid grid-cols-2 gap-2">
                        <button 
                            onClick={() => handleAction('compare')}
                            disabled={selectedIds.length !== 2}
                            className={`py-3 px-2 rounded-xl font-bold text-xs shadow-lg transition-all border ${
                                selectedIds.length === 2 
                                ? 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50' 
                                : 'bg-slate-100 text-slate-400 border-transparent cursor-not-allowed'
                            }`}
                        >
                            Comparar Horizontal (2)
                        </button>
                        <button 
                            onClick={() => handleAction('consolidate')}
                            disabled={selectedIds.length < 2}
                            className={`py-3 px-2 rounded-xl font-bold text-xs shadow-lg transition-all ${
                                selectedIds.length >= 2 
                                ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-purple-500/20' 
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            Aglutinar / Consolidar ({selectedIds.length})
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex gap-2">
                    <button 
                        onClick={onClear} 
                        className="flex-1 py-2.5 px-4 bg-red-50 dark:bg-red-900/10 text-red-600 border border-red-100 dark:border-red-900/30 hover:bg-red-100 rounded-xl text-xs font-bold transition-all"
                    >
                        Limpar Tudo
                    </button>
                    <button 
                        onClick={onClose} 
                        className="flex-1 py-2.5 px-4 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 rounded-xl text-xs font-bold transition-all"
                    >
                        Fechar
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default AnalysisHistory;
