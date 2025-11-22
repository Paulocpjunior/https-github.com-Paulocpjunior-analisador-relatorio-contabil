export interface HeaderData {
  companyName: string;
  collaboratorName: string;
  cnpj: string;
}

export interface ExtractedAccount {
  account_code: string | null;
  account_name: string;
  initial_balance: number; // SDO.ANTERIOR
  debit_value: number;
  credit_value: number;
  final_balance: number; // SDO.ATUAL
  total_value: number; // Usually matches final_balance or max(debit, credit) for fallback
  type: 'Debit' | 'Credit' | 'Unknown';
  possible_inversion: boolean;
  ifrs18_category?: 'Operacional' | 'Investimento' | 'Financiamento' | null;
  level: number; // Hierarchy level (1, 2, 3...)
  is_synthetic: boolean; // True if it is a Group/Sub-group, False if Analytical
}

export interface SpellCheck {
  original_term: string;
  suggested_correction: string;
  confidence: 'High' | 'Medium' | 'Low';
}

export interface AnalysisSummary {
  document_type: 'Balanço Patrimonial' | 'Balancete' | 'DRE' | 'Outro';
  period: string; // New field for extracted date range
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
  fullResult?: AnalysisResult; // Optional to allow optimizing localStorage usage
}