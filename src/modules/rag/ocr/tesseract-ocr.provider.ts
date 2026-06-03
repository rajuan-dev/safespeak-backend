import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { ApiError } from '@common/errors/ApiError';
import { StatusCodes } from 'http-status-codes';
import { createWorker } from 'tesseract.js';

import type {
  RagOcrExtractOptions,
  RagOcrExtractResult,
  RagOcrPageResult,
  RagOcrProgress,
  RagOcrProvider
} from './ocr-provider.interface';

const execFile = promisify(execFileCallback);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeConfidence = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (numeric > 1) {
    return Number(Math.max(0, Math.min(1, numeric / 100)).toFixed(3));
  }

  return Number(Math.max(0, Math.min(1, numeric)).toFixed(3));
};

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> => {
  if (timeoutMs <= 0) {
    return operation;
  }

  return await Promise.race<T>([
    operation,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new ApiError(StatusCodes.REQUEST_TIMEOUT, timeoutMessage));
      }, timeoutMs);
    })
  ]);
};

const ensurePdfRendererAvailable = async (): Promise<void> => {
  try {
    await execFile('pdftoppm', ['-h']);
  } catch {
    throw new ApiError(
      StatusCodes.UNPROCESSABLE_ENTITY,
      'PDF OCR requires a PDF page renderer. Install Poppler so `pdftoppm` is available, or use an OCR provider that can process PDFs directly.'
    );
  }
};

const ensurePdfInfoAvailable = async (): Promise<void> => {
  try {
    await execFile('pdfinfo', ['-h']);
  } catch {
    throw new ApiError(
      StatusCodes.UNPROCESSABLE_ENTITY,
      'PDF OCR batching requires `pdfinfo` from Poppler so SafeSpeak can discover the document page count safely.'
    );
  }
};

const ensureImageExtension = (filePath: string): void => {
  const extension = path.extname(filePath).toLowerCase();

  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Unsupported OCR image type "${extension || 'unknown'}". Upload PNG, JPG, JPEG, TIFF, BMP, or WEBP.`
    );
  }
};

const buildInitialProgress = (totalPages: number): RagOcrProgress => {
  const startedAt = new Date().toISOString();

  return {
    totalPages,
    processedPages: 0,
    completedPages: 0,
    failedPages: 0,
    lowConfidencePages: 0,
    startedAt,
    updatedAt: startedAt
  };
};

const buildResult = (
  pages: RagOcrPageResult[],
  warnings: string[],
  language: string,
  totalPages: number,
  progress: RagOcrProgress
): RagOcrExtractResult => {
  const text = pages.map((page) => page.text).filter(Boolean).join('\n\n').trim();
  const averageConfidence =
    pages.length === 0
      ? 0
      : Number(
          (
            pages.reduce((sum, page) => sum + normalizeConfidence(page.confidence), 0) / pages.length
          ).toFixed(3)
        );

  return {
    text,
    pageCount: pages.length,
    totalPages,
    pages,
    averageConfidence,
    provider: 'tesseract',
    language,
    extractionMethod: 'ocr',
    warnings,
    progress
  };
};

export const resolveOcrPageLimit = (totalPages: number, maxPages = 100): number =>
  maxPages === 0 ? totalPages : Math.min(totalPages, Math.max(0, maxPages));

export const buildOcrBatchRanges = (
  totalPages: number,
  batchSize: number,
  maxPages = 100
): Array<{ startPage: number; endPage: number }> => {
  const effectiveTotalPages = resolveOcrPageLimit(totalPages, maxPages);
  const ranges: Array<{ startPage: number; endPage: number }> = [];

  for (let startPage = 1; startPage <= effectiveTotalPages; startPage += batchSize) {
    ranges.push({
      startPage,
      endPage: Math.min(startPage + batchSize - 1, effectiveTotalPages)
    });
  }

  return ranges;
};

const getPdfPageCount = async (filePath: string): Promise<number> => {
  await ensurePdfInfoAvailable();
  const { stdout } = await execFile('pdfinfo', [filePath]);
  const pageCountMatch = stdout.match(/Pages:\s+(\d+)/i);
  const pageCount = pageCountMatch ? Number(pageCountMatch[1]) : NaN;

  if (!Number.isFinite(pageCount) || pageCount < 1) {
    throw new ApiError(
      StatusCodes.UNPROCESSABLE_ENTITY,
      'PDF OCR could not determine the page count for this document.'
    );
  }

  return pageCount;
};

const renderPdfBatchToImages = async (
  filePath: string,
  startPage: number,
  endPage: number
): Promise<{ pageImages: string[]; tempDir: string }> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'safespeak-rag-ocr-'));
  const prefix = path.join(tempDir, 'page');

  try {
    await execFile('pdftoppm', ['-png', '-f', String(startPage), '-l', String(endPage), filePath, prefix]);
    const files = await readdir(tempDir);
    const pageImages = files
      .filter((file) => /^page-\d+\.png$/i.test(file))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .map((file) => path.join(tempDir, file));

    if (pageImages.length === 0) {
      throw new ApiError(
        StatusCodes.UNPROCESSABLE_ENTITY,
        `PDF OCR could not render pages ${startPage}-${endPage}.`
      );
    }

    return { pageImages, tempDir };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
};

export class TesseractOcrProvider implements RagOcrProvider {
  readonly providerName = 'tesseract' as const;
  readonly isConfigured = true;

  private updateProgress(
    progress: RagOcrProgress,
    update: Partial<RagOcrProgress>
  ): RagOcrProgress {
    return {
      ...progress,
      ...update,
      updatedAt: new Date().toISOString()
    };
  }

  private async emitProgress(
    options: RagOcrExtractOptions | undefined,
    progress: RagOcrProgress,
    page?: RagOcrPageResult
  ): Promise<void> {
    if (options?.onProgress) {
      await options.onProgress(progress, page);
    }
  }

  private async recognizeSingleImage(
    filePath: string,
    pageNumber: number,
    language: string,
    options?: RagOcrExtractOptions
  ): Promise<RagOcrPageResult> {
    const startedAt = Date.now();
    const worker = await createWorker(language);

    try {
      const {
        data: { text, confidence }
      } = await withTimeout(
        worker.recognize(filePath),
        options?.pageTimeoutMs ?? 60000,
        `OCR timed out on page ${pageNumber}.`
      );
      const normalizedConfidence = normalizeConfidence(confidence);
      const warnings: string[] = [];
      const status =
        normalizedConfidence < (options?.minConfidence ?? 0.85) ? 'low_confidence' : 'completed';

      if (status === 'low_confidence') {
        warnings.push(`OCR confidence ${normalizedConfidence.toFixed(3)} is below the per-page threshold.`);
      }

      return {
        pageNumber,
        text: collapseWhitespace(text),
        confidence: normalizedConfidence,
        warnings,
        processingTimeMs: Date.now() - startedAt,
        status
      };
    } catch (error) {
      return {
        pageNumber,
        text: '',
        confidence: 0,
        warnings: [error instanceof Error ? error.message : 'OCR page processing failed.'],
        processingTimeMs: Date.now() - startedAt,
        status: 'failed'
      };
    } finally {
      await worker.terminate();
    }
  }

  async extractTextFromImage(
    filePath: string,
    options?: RagOcrExtractOptions
  ): Promise<RagOcrExtractResult> {
    ensureImageExtension(filePath);
    await access(filePath);
    const language = options?.language?.trim() || 'eng';
    let progress = buildInitialProgress(1);
    await this.emitProgress(options, progress);
    const page = await this.recognizeSingleImage(filePath, 1, language, options);
    progress = this.updateProgress(progress, {
      processedPages: 1,
      completedPages: page.status === 'completed' ? 1 : 0,
      failedPages: page.status === 'failed' ? 1 : 0,
      lowConfidencePages: page.status === 'low_confidence' ? 1 : 0,
      completedAt: new Date().toISOString(),
      lastError: page.status === 'failed' ? page.warnings[0] : undefined
    });
    await this.emitProgress(options, progress, page);

    return buildResult([page], page.text ? [] : ['OCR returned no readable text.'], language, 1, progress);
  }

  async extractTextFromPdf(
    filePath: string,
    options?: RagOcrExtractOptions
  ): Promise<RagOcrExtractResult> {
    await access(filePath);
    await ensurePdfRendererAvailable();
    const language = options?.language?.trim() || 'eng';
    const batchSize = Math.max(1, options?.batchSize ?? 5);
    const totalDocumentPages = await getPdfPageCount(filePath);
    const pageLimit = resolveOcrPageLimit(totalDocumentPages, options?.maxPages ?? 100);
    const ranges = buildOcrBatchRanges(totalDocumentPages, batchSize, options?.maxPages ?? 100);
    const warnings: string[] = [];

    if ((options?.maxPages ?? 100) > 0 && pageLimit < totalDocumentPages) {
      warnings.push(`OCR limited to the first ${pageLimit} pages of ${totalDocumentPages}.`);
    }

    let progress = buildInitialProgress(pageLimit);
    await this.emitProgress(options, progress);
    const pages: RagOcrPageResult[] = [];
    const startedAtMs = Date.now();

    for (const range of ranges) {
      if (options?.jobTimeoutMs && options.jobTimeoutMs > 0 && Date.now() - startedAtMs > options.jobTimeoutMs) {
        progress = this.updateProgress(progress, {
          currentBatchStart: range.startPage,
          currentBatchEnd: range.endPage,
          lastError: 'OCR job timed out before completion.'
        });
        await this.emitProgress(options, progress);
        throw new ApiError(StatusCodes.REQUEST_TIMEOUT, 'OCR job timed out before completion.');
      }

      progress = this.updateProgress(progress, {
        currentBatchStart: range.startPage,
        currentBatchEnd: range.endPage
      });
      await this.emitProgress(options, progress);

      const { pageImages, tempDir } = await renderPdfBatchToImages(
        filePath,
        range.startPage,
        range.endPage
      );

      try {
        for (const [index, pageImage] of pageImages.entries()) {
          const pageNumber = range.startPage + index;
          const pageResult = await this.recognizeSingleImage(pageImage, pageNumber, language, options);
          pages.push(pageResult);
          progress = this.updateProgress(progress, {
            processedPages: progress.processedPages + 1,
            completedPages: progress.completedPages + (pageResult.status === 'completed' ? 1 : 0),
            failedPages: progress.failedPages + (pageResult.status === 'failed' ? 1 : 0),
            lowConfidencePages:
              progress.lowConfidencePages + (pageResult.status === 'low_confidence' ? 1 : 0),
            lastError: pageResult.status === 'failed' ? pageResult.warnings[0] : progress.lastError
          });
          await this.emitProgress(options, progress, pageResult);
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }

    progress = this.updateProgress(progress, {
      currentBatchStart: undefined,
      currentBatchEnd: undefined,
      completedAt: new Date().toISOString()
    });
    await this.emitProgress(options, progress);

    return buildResult(pages, warnings, language, pageLimit, progress);
  }
}
