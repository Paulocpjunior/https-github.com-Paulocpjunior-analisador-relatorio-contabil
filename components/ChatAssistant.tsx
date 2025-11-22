import React, { useState, useRef, useEffect } from 'react';
import { chatWithFinancialAgent } from '../services/geminiService';

interface Message { role: 'user' | 'model'; text: string; }

const ChatAssistant: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, isOpen]);

    const handleSend = async () => {
        if (!input.trim()) return;
        const userMsg = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsLoading(true);

        try {
            const responseText = await chatWithFinancialAgent(messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })), userMsg);
            setMessages(prev => [...prev, { role: 'model', text: responseText || "Sem resposta." }]);
        } catch (error) { setMessages(prev => [...prev, { role: 'model', text: "Erro na conexão." }]); } 
        finally { setIsLoading(false); }
    };

    return (
        <>
            <button onClick={() => setIsOpen(!isOpen)} className="fixed bottom-6 right-6 bg-blue-600 text-white p-4 rounded-full shadow-lg z-50 hover:scale-105 transition-transform">{isOpen ? '✕' : '💬'}</button>
            {isOpen && (
                <div className="fixed bottom-24 right-6 w-80 h-96 bg-white dark:bg-slate-800 rounded-xl shadow-xl z-50 flex flex-col border dark:border-slate-700">
                    <div className="bg-blue-600 p-3 text-white font-bold rounded-t-xl">Assistente Contábil</div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50 dark:bg-slate-900/50">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`p-2 rounded max-w-[85%] text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white ml-auto' : 'bg-white dark:bg-slate-700 dark:text-white border'}`}>{msg.text}</div>
                        ))}
                        {isLoading && <div className="text-xs text-slate-500">Digitando...</div>}
                        <div ref={messagesEndRef} />
                    </div>
                    <div className="p-3 border-t dark:border-slate-700 flex gap-2">
                        <input type="text" className="flex-1 border rounded px-2 py-1 text-sm dark:bg-slate-700 dark:text-white" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder="Dúvida?" />
                        <button onClick={handleSend} disabled={isLoading} className="bg-blue-600 text-white px-3 rounded text-sm">Enviar</button>
                    </div>
                </div>
            )}
        </>
    );
};

export default ChatAssistant;
