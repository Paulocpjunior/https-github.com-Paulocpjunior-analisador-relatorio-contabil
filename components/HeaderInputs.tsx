import React, { useState } from 'react';
import { HeaderData } from '../types';

interface Props {
  data: HeaderData;
  onChange: (data: HeaderData) => void;
  disabled?: boolean;
}

const HeaderInputs: React.FC<Props> = ({ data, onChange, disabled }) => {
  const [cnpjError, setCnpjError] = useState(false);

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onChange({ ...data, [name]: value });
  };

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 14) value = value.slice(0, 14);
    
    value = value.replace(/^(\d{2})(\d)/, '$1.$2');
    value = value.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
    value = value.replace(/\.(\d{3})(\d)/, '.$1/$2');
    value = value.replace(/(\d{4})(\d)/, '$1-$2');
    
    onChange({ ...data, cnpj: value });
    
    // Validate only if completely typed or empty
    if (value.replace(/\D/g, '').length === 14 || value === '') {
        setCnpjError(!validateCNPJ(value));
    } else {
        // Don't show error while typing until it's full length
        setCnpjError(false);
    }
  };

  const handleCnpjBlur = () => {
      // On blur, mark as error if not empty and invalid (including incomplete)
      setCnpjError(!validateCNPJ(data.cnpj));
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2 text-accent">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
        </svg>
        Informações da Auditoria
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="cnpj" className={`block text-sm font-bold mb-1 ${cnpjError ? 'text-red-600' : 'text-blue-600'}`}>
            CNPJ <span className={`${cnpjError ? 'text-red-400' : 'text-blue-400'} font-normal text-xs`}>(Opcional)</span>
          </label>
          <input
            type="text"
            id="cnpj"
            name="cnpj"
            value={data.cnpj}
            onChange={handleCnpjChange}
            onBlur={handleCnpjBlur}
            disabled={disabled}
            placeholder="00.000.000/0000-00"
            maxLength={18}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 transition-colors disabled:bg-slate-100 disabled:cursor-not-allowed font-medium
                ${cnpjError 
                    ? 'border-red-500 focus:ring-red-500 focus:border-red-500 bg-red-50 text-red-900 placeholder-red-300' 
                    : 'border-blue-700 focus:ring-blue-500 focus:border-blue-500 bg-blue-600 text-white placeholder-blue-200'
                }`}
          />
          {cnpjError && (
              <p className="text-red-500 text-xs mt-1">CNPJ inválido</p>
          )}
        </div>
        <div>
          <label htmlFor="companyName" className="block text-sm font-bold text-blue-600 mb-1">
            Empresa / Cliente
          </label>
          <input
            type="text"
            id="companyName"
            name="companyName"
            value={data.companyName}
            onChange={handleChange}
            disabled={disabled}
            placeholder="Ex: Cliente Exemplo LTDA"
            className="w-full px-4 py-2 border border-blue-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-slate-100 disabled:cursor-not-allowed bg-blue-600 text-white placeholder-blue-200 font-medium"
          />
        </div>
        <div>
          <label htmlFor="collaboratorName" className="block text-sm font-bold text-blue-600 mb-1">
            Colaborador Responsável
          </label>
          <input
            type="text"
            id="collaboratorName"
            name="collaboratorName"
            value={data.collaboratorName}
            onChange={handleChange}
            disabled={disabled}
            placeholder="Ex: João Silva"
            className="w-full px-4 py-2 border border-blue-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors disabled:bg-slate-100 disabled:cursor-not-allowed bg-blue-600 text-white placeholder-blue-200 font-medium"
          />
        </div>
      </div>
    </div>
  );
};

export default HeaderInputs;
