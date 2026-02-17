
import React, { useState } from 'react';
import { HeaderData } from '../types';

interface Props {
  data: HeaderData;
  onChange: (data: HeaderData) => void;
  onSave?: () => void;
  disabled?: boolean;
}

const HeaderInputs: React.FC<Props> = ({ data, onChange, onSave, disabled }) => {
  const [cnpjError, setCnpjError] = useState(false);
  const [isLoadingCnpj, setIsLoadingCnpj] = useState(false);

  const validateCNPJ = (cnpj: string) => {
    const numbers = cnpj.replace(/\D/g, '');

    if (numbers === '') return true; // Optional
    if (numbers.length !== 14) return false;

    // Eliminate known invalid lists
    if (/^(\d)\1+$/.test(numbers)) return false;

    // Validates first digit
    let length = numbers.length - 2
    let numbers_substr = numbers.substring(0, length);
    const digits = numbers.substring(length);
    let sum = 0;
    let pos = length - 7;
    for (let i = length; i >= 1; i--) {
      sum += parseInt(numbers_substr.charAt(length - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result !== parseInt(digits.charAt(0))) return false;

    // Validates second digit
    length = length + 1;
    numbers_substr = numbers.substring(0, length);
    sum = 0;
    pos = length - 7;
    for (let i = length; i >= 1; i--) {
      sum += parseInt(numbers_substr.charAt(length - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result !== parseInt(digits.charAt(1))) return false;

    return true;
  };

  const fetchCompanyData = async (cnpj: string) => {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    
    // Basic validation before fetching
    if (cleanCnpj.length !== 14 || !validateCNPJ(cleanCnpj)) {
        return;
    }

    setIsLoadingCnpj(true);
    try {
        // Using BrasilAPI (Free, no key required)
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
        
        if (!response.ok) {
            throw new Error('CNPJ não encontrado ou erro na API');
        }

        const companyData = await response.json();
        
        // Prioritize Razão Social, fallback to Nome Fantasia
        const companyName = companyData.razao_social || companyData.nome_fantasia || '';

        if (companyName) {
            onChange({
                ...data,
                cnpj: cnpj, // Keep current masked value
                companyName: companyName
            });
            setCnpjError(false);
        }
    } catch (error) {
        console.warn("Erro ao buscar CNPJ:", error);
        // We don't block the user, just don't autofill
        setCnpjError(true); 
    } finally {
        setIsLoadingCnpj(false);
    }
  };

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 14) value = value.slice(0, 14);
    
    const rawValue = value; // Keep raw for length check

    // Masking
    value = value.replace(/^(\d{2})(\d)/, '$1.$2');
    value = value.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
    value = value.replace(/\.(\d{3})(\d)/, '.$1/$2');
    value = value.replace(/(\d{4})(\d)/, '$1-$2');
    
    // Update state immediately with mask
    onChange({ ...data, cnpj: value });
    
    // Validate only if completely typed or empty
    if (rawValue.length === 14) {
        const isValid = validateCNPJ(rawValue);
        setCnpjError(!isValid);
        if (isValid) {
            fetchCompanyData(rawValue);
        }
    } else if (value === '') {
        setCnpjError(false);
    } else {
        // Don't show error while typing until it's full length
        setCnpjError(false);
    }
  };

  const handleCnpjBlur = () => {
      // On blur, mark as error if not empty and invalid (including incomplete)
      setCnpjError(!validateCNPJ(data.cnpj));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onChange({ ...data, [name]: value });
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 mb-6 transition-colors relative">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center justify-between">
        <span className="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2 text-accent">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
            </svg>
            Informações da Auditoria
        </span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="cnpj" className={`block text-sm font-bold mb-1 ${cnpjError ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
            CNPJ <span className={`${cnpjError ? 'text-red-400' : 'text-blue-400 dark:text-blue-300'} font-normal text-xs`}>(Busca Automática)</span>
          </label>
          <div className="relative">
            <input
                type="text"
                id="cnpj"
                name="cnpj"
                value={data.cnpj}
                onChange={handleCnpjChange}
                onBlur={handleCnpjBlur}
                disabled={disabled || isLoadingCnpj}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 transition-colors disabled:bg-slate-100 disabled:cursor-not-allowed font-medium
                    ${cnpjError 
                        ? 'border-red-500 focus:ring-red-500 focus:border-red-500 bg-red-50 text-red-900 placeholder-red-300 dark:bg-red-900/20 dark:text-red-200' 
                        : 'border-blue-700 focus:ring-blue-500 focus:border-blue-500 bg-blue-600 text-white placeholder-blue-200 dark:bg-blue-900/50 dark:border-blue-500'
                    }`}
            />
            {isLoadingCnpj && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            )}
          </div>
          {cnpjError && (
              <p className="text-red-500 text-xs mt-1">CNPJ inválido ou não encontrado.</p>
          )}
        </div>
        <div>
          <label htmlFor="companyName" className="block text-sm font-bold text-blue-600 dark:text-blue-400 mb-1">
            Empresa / Cliente
          </label>
          <input
            type="text"
            id="companyName"
            name="companyName"
            value={data.companyName}
            onChange={handleChange}
            disabled={disabled || isLoadingCnpj}
            placeholder="Ex: Cliente Exemplo LTDA"
            className="w-full px-4 py-2 border border-blue-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-slate-100 disabled:cursor-not-allowed bg-blue-600 text-white placeholder-blue-200 font-medium dark:bg-blue-900/50 dark:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="collaboratorName" className="block text-sm font-bold text-blue-600 dark:text-blue-400 mb-1">
            Colaborador Responsável
          </label>
          <div className="flex gap-2">
            <input
                type="text"
                id="collaboratorName"
                name="collaboratorName"
                value={data.collaboratorName}
                onChange={handleChange}
                disabled={disabled}
                placeholder="Ex: João Silva"
                className="w-full px-4 py-2 border border-blue-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-slate-100 disabled:cursor-not-allowed bg-blue-600 text-white placeholder-blue-200 font-medium dark:bg-blue-900/50 dark:border-blue-500"
            />
          </div>
        </div>
      </div>
      {onSave && (
        <div className="mt-4 flex justify-end">
            <button 
                onClick={onSave}
                disabled={disabled || !data.companyName}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                Salvar Rascunho
            </button>
        </div>
      )}
    </div>
  );
};

export default HeaderInputs;
