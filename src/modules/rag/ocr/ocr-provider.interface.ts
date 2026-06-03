export type RagOcrProviderName =
  | 'tesseract'
  | 'google_vision'
  | 'aws_textract'
  | 'azure_document_intelligence'
  | 'none';

export type RagOcrPageStatus = 'completed' | 'failed' | 'skipped' | 'low_confidence';

export interface RagOcrProgress {
  totalPages: number;
  processedPages: number;
  completedPages: number;
  failedPages: number;
  lowConfidencePages: number;
  currentBatchStart?: number;
  currentBatchEnd?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  lastError?: string;
}

export interface RagOcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  warnings: string[];
  processingTimeMs?: number;
  status?: RagOcrPageStatus;
}

export interface RagOcrExtractOptions {
  language?: string;
  maxPages?: number;
  batchSize?: number;
  pageTimeoutMs?: number;
  jobTimeoutMs?: number;
  minConfidence?: number;
  onProgress?: (progress: RagOcrProgress, page?: RagOcrPageResult) => void | Promise<void>;
}

export interface RagOcrExtractResult {
  text: string;
  pageCount: number;
  totalPages?: number;
  pages: RagOcrPageResult[];
  averageConfidence: number;
  provider: RagOcrProviderName;
  language: string;
  extractionMethod: 'ocr';
  warnings: string[];
  progress?: RagOcrProgress;
}

export interface RagOcrProvider {
  readonly providerName: RagOcrProviderName;
  readonly isConfigured: boolean;
  extractTextFromPdf(filePath: string, options?: RagOcrExtractOptions): Promise<RagOcrExtractResult>;
  extractTextFromImage(
    filePath: string,
    options?: RagOcrExtractOptions
  ): Promise<RagOcrExtractResult>;
}
