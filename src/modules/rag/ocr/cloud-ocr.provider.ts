import { ApiError } from '@common/errors/ApiError';
import { StatusCodes } from 'http-status-codes';

import type {
  RagOcrExtractOptions,
  RagOcrExtractResult,
  RagOcrProvider,
  RagOcrProviderName
} from './ocr-provider.interface';

export class UnsupportedCloudOcrProvider implements RagOcrProvider {
  readonly isConfigured = false;

  constructor(readonly providerName: RagOcrProviderName) {}

  async extractTextFromPdf(
    _filePath: string,
    _options?: RagOcrExtractOptions
  ): Promise<RagOcrExtractResult> {
    throw new ApiError(
      StatusCodes.NOT_IMPLEMENTED,
      `${this.providerName} OCR is not implemented in this deployment yet. Configure another OCR provider or add the SDK integration first.`
    );
  }

  async extractTextFromImage(
    _filePath: string,
    _options?: RagOcrExtractOptions
  ): Promise<RagOcrExtractResult> {
    throw new ApiError(
      StatusCodes.NOT_IMPLEMENTED,
      `${this.providerName} OCR is not implemented in this deployment yet. Configure another OCR provider or add the SDK integration first.`
    );
  }
}
