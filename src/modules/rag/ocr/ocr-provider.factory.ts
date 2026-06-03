import { env } from '@config/env';

import { UnsupportedCloudOcrProvider } from './cloud-ocr.provider';
import type { RagOcrProvider } from './ocr-provider.interface';
import { TesseractOcrProvider } from './tesseract-ocr.provider';

let cachedProvider: RagOcrProvider | null = null;

export const createOcrProvider = (): RagOcrProvider => {
  switch (env.OCR_PROVIDER) {
    case 'none':
      return new UnsupportedCloudOcrProvider('none');
    case 'google_vision':
      return new UnsupportedCloudOcrProvider('google_vision');
    case 'aws_textract':
      return new UnsupportedCloudOcrProvider('aws_textract');
    case 'azure_document_intelligence':
      return new UnsupportedCloudOcrProvider('azure_document_intelligence');
    case 'tesseract':
    default:
      return new TesseractOcrProvider();
  }
};

export const getOcrProvider = (): RagOcrProvider => {
  cachedProvider ??= createOcrProvider();
  return cachedProvider;
};

export const setOcrProviderForTests = (provider: RagOcrProvider | null): void => {
  cachedProvider = provider;
};
