export interface HeaderData {
  companyName: string;
  collaboratorName: string;
  cnpj: string;
}

export interface ExtractedAccount {
  account_code: string | null;
  account_name: string;
  debit_value: number;
  credit_value: number;
  total_value: number;
  type: 'Debit' | 'Credit' | 'Unknown';
  possible_inversion: boolean;
  ifrs18_category?: 'Operacional' | 'Investimento' | 'Financiamento' | null;
}

export interface SpellCheck {
  original_term: string;
  suggested_correction: string;
  confidence: 'High' | 'Medium' | 'Low';
}

export interface AnalysisSummary {
  document_type: 'Balanço Patrimonial' | 'Balancete' | 'DRE' | 'Outro';
  total_debits: number;
  total_credits: number;
  is_balanced: boolean;
  discrepancy_amount: number;
  observations: string[];
}

// The complete structured response we expect from Gemini
export interface AnalysisResult {
  summary: AnalysisSummary;
  accounts: ExtractedAccount[];
  spell_check: SpellCheck[];
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  headerData: HeaderData;
  fileName: string;
  summary: AnalysisSummary;
  fullResult: AnalysisResult;
}