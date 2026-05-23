import { createHash } from 'node:crypto';
import path from 'node:path';

import { StatusCodes } from 'http-status-codes';
import type { HydratedDocument } from 'mongoose';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { env } from '@config/env';
import { ApiError } from '@common/errors/ApiError';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';

import { SCAMSHIELD_ACTIONS } from './scamshield.constants';
import { ScamShieldAnalysisModel, type ScamShieldAnalysisDocument } from './scamshield.model';
import type {
  AnalyzeEmailInput,
  AnalyzeScreenshotInput,
  AnalyzeTextInput,
  CheckUrlInput,
  GenerateReportDraftInput,
  RedactScamContentInput,
  SubmitScamReportInput
} from './scamshield.schema';
import type {
  ScamShieldAnalysisType,
  ScamShieldOwner,
  ScamShieldServiceContext
} from './scamshield.types';

type HydratedScamShieldAnalysisDocument = HydratedDocument<ScamShieldAnalysisDocument>;
type UploadedScamShieldEvidenceFile = Express.Multer.File;
type ExtractedEvidenceText = {
  fileName: string;
  mimeType: string;
  size: number;
  extractor: string;
  text: string;
};
type AnalyzeScamEvidenceInput = AnalyzeScreenshotInput & {
  files?: UploadedScamShieldEvidenceFile[];
};

const MAX_SCAMSHIELD_ANALYSIS_TEXT_LENGTH = 20000;

const ownerFilter = (owner: ScamShieldOwner): ScamShieldOwner => {
  if (!owner.userId && !owner.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User or anonymous session is required');
  }

  return owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId };
};

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const getFileExtension = (fileName: string): string => path.extname(fileName).toLowerCase();

const isImageEvidenceFile = (file: UploadedScamShieldEvidenceFile): boolean =>
  file.mimetype.startsWith('image/');

const extractBestEffortLegacyDocText = (file: UploadedScamShieldEvidenceFile): string =>
  file.buffer
    .toString('latin1')
    .split(/[^\x20-\x7E]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractTextFromScreenshot = async (input: AnalyzeScreenshotInput): Promise<string> => {
  if (input.imageText?.trim()) {
    return input.imageText.trim();
  }

  if (!input.imageBase64) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Screenshot text or image upload is required');
  }

  if (!env.OPENAI_API_KEY) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Screenshot OCR is unavailable because OPENAI_API_KEY is not configured'
    );
  }

  const mimeType = input.mimeType ?? 'image/png';
  const imageData = input.imageBase64.startsWith('data:')
    ? input.imageBase64
    : `data:${mimeType};base64,${input.imageBase64}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Extract only the visible text from this screenshot for scam risk analysis. ' +
                'Return plain text. Do not add advice, scores, or invented content.'
            },
            {
              type: 'input_image',
              image_url: imageData
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'Screenshot OCR request failed');
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const extractedText =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.text)?.text;

  if (!extractedText?.trim()) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'Screenshot OCR response was empty');
  }

  return extractedText.trim();
};

const extractTextFromEvidenceFile = async (
  file: UploadedScamShieldEvidenceFile
): Promise<ExtractedEvidenceText> => {
  const extension = getFileExtension(file.originalname);
  const mimeType = file.mimetype.toLowerCase();

  if (isImageEvidenceFile(file)) {
    const text = await extractTextFromScreenshot({
      imageBase64: file.buffer.toString('base64'),
      mimeType: file.mimetype,
      metadata: {}
    });

    return {
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      extractor: 'openai-vision-ocr',
      text
    };
  }

  if (extension === '.pdf' || mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: file.buffer });

    try {
      const parsed = await parser.getText();

      return {
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        extractor: 'pdf-parse',
        text: parsed.text.trim()
      };
    } finally {
      await parser.destroy();
    }
  }

  if (
    extension === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });

    return {
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      extractor: 'mammoth',
      text: parsed.value.trim()
    };
  }

  if (extension === '.doc' || mimeType === 'application/msword') {
    return {
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      extractor: 'legacy-doc-best-effort',
      text: extractBestEffortLegacyDocText(file)
    };
  }

  throw new ApiError(
    StatusCodes.BAD_REQUEST,
    'Unsupported ScamShield evidence file type. Upload an image, screenshot, PDF, or Word document.'
  );
};

const buildEvidenceAnalysisText = async (
  input: AnalyzeScamEvidenceInput
): Promise<{
  text: string;
  extractedFiles: ExtractedEvidenceText[];
  ocrApplied: boolean;
}> => {
  const directText = input.imageText?.trim();
  const files = input.files ?? [];
  const extractedFiles = await Promise.all(
    files.map((file) => {
      if (directText && isImageEvidenceFile(file)) {
        return Promise.resolve({
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          extractor: 'user-provided-visible-text',
          text: ''
        });
      }

      return extractTextFromEvidenceFile(file);
    })
  );
  const uploadedText = extractedFiles
    .map((file) => file.text)
    .filter((text) => text.trim().length > 0);
  const fallbackScreenshotText =
    !files.length && input.imageBase64 && !directText
      ? await extractTextFromScreenshot(input)
      : undefined;
  const text = [directText, ...uploadedText, fallbackScreenshotText]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n\n')
    .trim();

  if (!text) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Evidence text could not be extracted. Upload a clearer file or paste the visible message text.'
    );
  }

  return {
    text: text.slice(0, MAX_SCAMSHIELD_ANALYSIS_TEXT_LENGTH),
    extractedFiles,
    ocrApplied:
      Boolean(input.imageBase64) ||
      extractedFiles.some((file) => file.extractor === 'openai-vision-ocr')
  };
};

const assertAiConsent = async (owner: ScamShieldOwner): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (!consent.process_with_ai) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'process_with_ai consent is required for ScamShield analysis'
    );
  }
};

const assertShareConsent = async (
  owner: ScamShieldOwner,
  consentToShare: boolean
): Promise<void> => {
  const consent = await getCurrentConsent(owner);

  if (consentToShare && !consent.share_with_agencies) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'share_with_agencies consent is required to submit externally'
    );
  }
};

const audit = async (
  context: ScamShieldServiceContext,
  action: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await createAuditLog({
    actorType: context.owner.userId ? 'user' : 'anonymous_session',
    actorId: context.owner.userId,
    sessionId: context.owner.sessionId,
    action,
    resourceType: 'system',
    resourceId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata
  });
};

type ScamShieldExtractedEntities = {
  urls: string[];
  emailAddresses: string[];
  phoneNumbers: string[];
  amounts: string[];
  paymentMethods: string[];
  organizations: string[];
  accountTerms: string[];
  cryptoReferences: string[];
  urlSignals: string[];
  primaryUrlDomain?: string;
  possibleSender?: string;
};

type ScamSignalRule = {
  label: string;
  pattern: RegExp;
  redFlag: string;
  recommendation: string;
  weight: number;
};

type ScamSignalDetection = {
  label: string;
  redFlag: string;
  recommendation: string;
  weight: number;
};

type ScoredScamContent = {
  riskScore: number;
  confidence: string;
  confidenceScore: number;
  summary: string;
  indicators: string[];
  redFlags: string[];
  recommendations: string[];
  extractedEntities: ScamShieldExtractedEntities;
};

const SCAM_SIGNAL_RULES: ScamSignalRule[] = [
  {
    label: 'urgent pressure',
    pattern:
      /\b(urgent|act now|immediately|right now|final notice|last chance|within \d+|today only|do not delay)\b/i,
    redFlag: 'The message uses time pressure or urgent wording to push immediate action.',
    recommendation:
      'Pause before responding. Verify the request through a known official channel, not through the message.',
    weight: 12
  },
  {
    label: 'credential request',
    pattern:
      /\b(password|passcode|pin|login|log in|sign in|verify your account|account verification|reset your account)\b/i,
    redFlag: 'The message asks for account access details or sends the user toward a login flow.',
    recommendation:
      'Do not enter passwords or PINs from this message. Go directly to the official app or website.',
    weight: 22
  },
  {
    label: 'OTP or MFA request',
    pattern:
      /\b(otp|one[-\s]?time code|one[-\s]?time passcode|verification code|2fa|mfa|authenticator code)\b/i,
    redFlag: 'The message refers to one-time codes or multi-factor authentication details.',
    recommendation:
      'Never share OTP, MFA, or authenticator codes. Real support teams do not need them.',
    weight: 26
  },
  {
    label: 'payment request',
    pattern:
      /\b(payment|pay now|transfer|wire transfer|bank transfer|deposit|fee|invoice|settlement|escrow)\b/i,
    redFlag: 'The message asks for payment, transfer, deposit, invoice settlement, or a fee.',
    recommendation:
      'Do not send money until the request is independently verified with the real organization.',
    weight: 18
  },
  {
    label: 'gift card payment',
    pattern: /\b(gift card|itunes card|apple card|google play card|steam card|voucher)\b/i,
    redFlag: 'The message mentions gift cards or vouchers as payment.',
    recommendation:
      'Treat gift-card payment requests as high risk. Legitimate agencies and banks do not demand gift cards.',
    weight: 26
  },
  {
    label: 'crypto or investment lure',
    pattern:
      /\b(crypto|cryptocurrency|bitcoin|btc|ethereum|wallet|usdt|tether|forex|investment|guaranteed return|trading platform)\b/i,
    redFlag: 'The message mentions crypto, trading, or investment returns.',
    recommendation:
      'Do not move funds to wallets or trading platforms based on an unsolicited message.',
    weight: 24
  },
  {
    label: 'link in message',
    pattern: /\b(https?:\/\/|www\.|bit\.ly|tinyurl|t\.co|shorturl|linktr\.ee)\b/i,
    redFlag: 'The message includes a link that could lead to a fake form or login page.',
    recommendation:
      'Avoid clicking the link. Search for the organization yourself or use its official app.',
    weight: 14
  },
  {
    label: 'threat or penalty',
    pattern:
      /\b(suspended|blocked|locked|fine|arrest|penalty|legal action|warrant|debt collector|account closure|terminated)\b/i,
    redFlag: 'The message threatens penalties, account suspension, legal action, or service loss.',
    recommendation:
      'Do not respond under pressure. Confirm any penalty or account issue using official contact details.',
    weight: 22
  },
  {
    label: 'prize or refund lure',
    pattern:
      /\b(prize|winner|won|lottery|reward|bonus|refund|rebate|compensation|claim your|unclaimed)\b/i,
    redFlag: 'The message offers a prize, refund, reward, or unexpected compensation.',
    recommendation:
      'Be careful with unexpected money offers. Verify directly before giving details or paying fees.',
    weight: 14
  },
  {
    label: 'official impersonation',
    pattern:
      /\b(bank|paypal|mygov|ato|centrelink|medicare|police|court|government|tax office|amazon|microsoft|apple|google|netflix|auspost|dhl|fedex|linkt)\b/i,
    redFlag:
      'The message appears to impersonate a bank, government agency, platform, or delivery service.',
    recommendation:
      'Contact the organization through its official website, app, or a phone number you already trust.',
    weight: 18
  },
  {
    label: 'remote access request',
    pattern:
      /\b(anydesk|teamviewer|remote access|screen share|install this app|download this app|support tool)\b/i,
    redFlag: 'The message asks the user to install software or allow remote access.',
    recommendation:
      'Do not install remote-access tools for someone who contacted you unexpectedly.',
    weight: 26
  },
  {
    label: 'invoice or payment redirection',
    pattern:
      /\b(new bank details|updated bank details|change of bank|invoice attached|overdue invoice|remittance|supplier payment)\b/i,
    redFlag: 'The message may be redirecting a payment or invoice to new bank details.',
    recommendation:
      'Call the supplier or organization on a known number before changing payment details.',
    weight: 24
  },
  {
    label: 'delivery or toll lure',
    pattern:
      /\b(parcel|package|delivery|missed delivery|shipping fee|customs fee|toll|unpaid toll)\b/i,
    redFlag: 'The message uses a delivery, customs, or toll payment prompt.',
    recommendation:
      'Check delivery or toll claims only through the official provider website or app.',
    weight: 15
  },
  {
    label: 'romance or emotional manipulation',
    pattern:
      /\b(love you|trust me|keep this secret|emergency money|stranded|hospital bill|military deployment)\b/i,
    redFlag: 'The message uses emotional pressure or secrecy to request help or money.',
    recommendation: 'Speak with someone you trust before sending money or personal details.',
    weight: 18
  },
  {
    label: 'job or task scam',
    pattern:
      /\b(part[-\s]?time job|work from home|task|commission|recruiter|telegram task|whatsapp job|easy money)\b/i,
    redFlag: 'The message resembles a job, task, or commission scam.',
    recommendation:
      'Do not pay deposits or complete tasks for promised earnings from unsolicited recruiters.',
    weight: 18
  },
  {
    label: 'personal information request',
    pattern:
      /\b(date of birth|dob|passport|driver'?s licence|license number|medicare number|ssn|tax file number|address confirmation)\b/i,
    redFlag: 'The message asks for sensitive identity information.',
    recommendation:
      'Do not provide identity documents or personal details until the request is independently verified.',
    weight: 20
  }
].map((rule) => ({
  ...rule,
  redFlag: rule.redFlag,
  recommendation: rule.recommendation
}));

const uniqueValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const trimmed = value.trim().replace(/[),.;:!?]+$/g, '');
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(trimmed);
  });

  return result;
};

const matchUnique = (content: string, pattern: RegExp): string[] =>
  uniqueValues(Array.from(content.matchAll(pattern)).map((match) => match[0]));

const extractPaymentMethods = (content: string): string[] => {
  const paymentSignals = [
    ['gift card', /\bgift card|itunes card|apple card|google play card|steam card|voucher\b/i],
    ['bank transfer', /\bbank transfer|wire transfer|new bank details|bsb|account number\b/i],
    ['crypto wallet', /\bcrypto|bitcoin|btc|ethereum|wallet|usdt|tether\b/i],
    ['payment link', /\bpayment link|pay now|checkout|settlement link\b/i],
    ['invoice', /\binvoice|remittance|supplier payment\b/i]
  ] as const;

  return paymentSignals.filter(([, pattern]) => pattern.test(content)).map(([label]) => label);
};

const extractOrganizations = (content: string): string[] =>
  matchUnique(
    content,
    /\b(?:paypal|mygov|ato|centrelink|medicare|amazon|microsoft|apple|google|netflix|facebook|instagram|whatsapp|telegram|auspost|dhl|fedex|linkt|bank|police|court|tax office)\b/gi
  );

const extractAccountTerms = (content: string): string[] =>
  matchUnique(
    content,
    /\b(?:password|passcode|pin|login|sign in|account verification|otp|one[-\s]?time code|verification code|2fa|mfa|card number|bank account)\b/gi
  );

const parseUrl = (url: string): URL | null => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return null;
  }
};

const getPrimaryUrlDomain = (urls: string[]): string | undefined => {
  const parsed = urls.map(parseUrl).find((url): url is URL => Boolean(url));

  return parsed?.hostname.toLowerCase();
};

const buildUrlSignals = (urls: string[]): string[] => {
  const signals: string[] = [];

  urls.forEach((url) => {
    const parsed = parseUrl(url);

    if (!parsed) {
      signals.push('unparseable URL');
      return;
    }

    const hostname = parsed.hostname.toLowerCase();
    const fullUrl = parsed.toString().toLowerCase();
    const subdomainCount = hostname.split('.').filter(Boolean).length;

    if (/^(bit\.ly|tinyurl\.com|t\.co|shorturl\.at|is\.gd|ow\.ly|cutt\.ly)$/i.test(hostname)) {
      signals.push('shortened link');
    }

    if (hostname.includes('xn--')) {
      signals.push('punycode domain');
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
      signals.push('IP address link');
    }

    if (parsed.username || parsed.password || url.includes('@')) {
      signals.push('hidden destination marker');
    }

    if (subdomainCount >= 4) {
      signals.push('many subdomains');
    }

    if (hostname.length > 35 || (hostname.match(/-/g)?.length ?? 0) >= 3) {
      signals.push('unusual domain shape');
    }

    if (
      /\b(login|verify|secure|security|account|password|wallet|payment|refund|claim|mygov|ato|paypal|bank)\b/i.test(
        `${hostname} ${parsed.pathname} ${parsed.search}`
      )
    ) {
      signals.push('sensitive action in link');
    }

    if (fullUrl.startsWith('http://')) {
      signals.push('unencrypted link');
    }
  });

  return uniqueValues(signals);
};

const extractScamEntities = (content: string): ScamShieldExtractedEntities => {
  const urls = matchUnique(content, /\b(?:https?:\/\/[^\s"'<>]+|www\.[^\s"'<>]+)/gi);
  const emailAddresses = matchUnique(content, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
  const phoneNumbers = matchUnique(content, /\+?\d[\d\s().-]{7,}\d/g);
  const amounts = matchUnique(
    content,
    /\b(?:AUD|USD|GBP|EUR)\s?\d[\d,]*(?:\.\d{2})?\b|[$€£]\s?\d[\d,]*(?:\.\d{2})?\b|\b\d[\d,]*(?:\.\d{2})?\s?(?:AUD|USD|dollars?)\b/gi
  );
  const cryptoReferences = matchUnique(
    content,
    /\b(?:bitcoin|btc|ethereum|eth|crypto(?:currency)?|wallet|blockchain|usdt|tether|binance|coinbase)\b/gi
  );

  return {
    urls,
    emailAddresses,
    phoneNumbers,
    amounts,
    paymentMethods: extractPaymentMethods(content),
    organizations: extractOrganizations(content),
    accountTerms: extractAccountTerms(content),
    cryptoReferences,
    urlSignals: buildUrlSignals(urls),
    primaryUrlDomain: getPrimaryUrlDomain(urls),
    possibleSender: emailAddresses[0]
  };
};

const addDetection = (
  detections: ScamSignalDetection[],
  labels: Set<string>,
  detection: ScamSignalDetection
): void => {
  if (labels.has(detection.label)) {
    return;
  }

  labels.add(detection.label);
  detections.push(detection);
};

const buildSummary = (
  riskLevel: ScamShieldAnalysisDocument['riskLevel'],
  detections: ScamSignalDetection[]
): string => {
  if (!detections.length) {
    return 'No strong scam markers were detected in the supplied content. Continue to verify through official channels if anything feels unusual.';
  }

  const topSignals = detections
    .slice(0, 3)
    .map((detection) => detection.label)
    .join(', ');

  if (riskLevel === 'critical') {
    return `Critical scam risk detected based on ${topSignals}. Treat this message as unsafe until verified independently.`;
  }

  if (riskLevel === 'high') {
    return `High scam risk detected based on ${topSignals}. Avoid clicking links, sharing codes, or sending money.`;
  }

  if (riskLevel === 'medium') {
    return `Some scam indicators were detected: ${topSignals}. Verify the request before taking action.`;
  }

  return `Low scam risk with limited indicators: ${topSignals}. Keep using official channels before responding.`;
};

const confidenceForScore = (confidenceScore: number): string => {
  if (confidenceScore >= 0.75) {
    return 'high';
  }

  if (confidenceScore >= 0.55) {
    return 'medium';
  }

  return 'low';
};

const scoreContent = (content: string): ScoredScamContent => {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  const entities = extractScamEntities(normalizedContent);
  const detections: ScamSignalDetection[] = [];
  const detectionLabels = new Set<string>();

  SCAM_SIGNAL_RULES.forEach((rule) => {
    if (!rule.pattern.test(normalizedContent)) {
      return;
    }

    addDetection(detections, detectionLabels, rule);
  });

  entities.urlSignals.forEach((signal) => {
    addDetection(detections, detectionLabels, {
      label: signal,
      redFlag: `The URL has a technical risk signal: ${signal}.`,
      recommendation:
        'Do not use the link directly. Navigate to the service manually or use its official app.',
      weight: signal === 'shortened link' || signal === 'sensitive action in link' ? 16 : 10
    });
  });

  const signalScore = detections.reduce((total, detection) => total + detection.weight, 0);
  const combinationBoost =
    (detectionLabels.has('credential request') && detectionLabels.has('link in message') ? 10 : 0) +
    (detectionLabels.has('OTP or MFA request') && detectionLabels.has('official impersonation')
      ? 12
      : 0) +
    (detectionLabels.has('payment request') && detectionLabels.has('urgent pressure') ? 8 : 0) +
    (entities.amounts.length ? 7 : 0) +
    (entities.phoneNumbers.length && detectionLabels.has('official impersonation') ? 5 : 0) +
    (normalizedContent.length > 2000 ? 5 : 0);
  const riskScore = Math.min(100, Math.max(0, Math.round(signalScore + combinationBoost)));
  const riskLevel = riskLevelForScore(riskScore);
  const confidenceScore = Math.min(
    0.95,
    Math.max(
      0.35,
      0.35 +
        detections.length * 0.08 +
        entities.urls.length * 0.04 +
        entities.amounts.length * 0.05 +
        entities.accountTerms.length * 0.04 +
        entities.urlSignals.length * 0.05
    )
  );
  const fallbackRecommendations = [
    'Do not click links, share codes, send money, or provide personal details until verified.',
    'Use a trusted phone number, official website, or official app to check the request.',
    'Keep screenshots and message details in case you need to report the incident.'
  ];

  return {
    riskScore,
    confidence: confidenceForScore(confidenceScore),
    confidenceScore: Math.round(confidenceScore * 100) / 100,
    summary: buildSummary(riskLevel, detections),
    indicators: detections.map((detection) => detection.label),
    redFlags: detections.map((detection) => detection.redFlag),
    recommendations: detections.length
      ? uniqueValues(detections.map((detection) => detection.recommendation))
      : fallbackRecommendations,
    extractedEntities: entities
  };
};

const riskLevelForScore = (score: number): ScamShieldAnalysisDocument['riskLevel'] => {
  if (score >= 75) {
    return 'critical';
  }

  if (score >= 50) {
    return 'high';
  }

  if (score >= 25) {
    return 'medium';
  }

  return 'low';
};

const createAnalysis = async (
  context: ScamShieldServiceContext,
  type: ScamShieldAnalysisType,
  content: string,
  input: Record<string, unknown>,
  action: string
): Promise<ScamShieldAnalysisDocument> => {
  await assertAiConsent(context.owner);
  const scored = scoreContent(content);
  const analysis = await ScamShieldAnalysisModel.create({
    ...ownerFilter(context.owner),
    reportId: input.reportId,
    type,
    inputHash: hashValue(input),
    riskLevel: riskLevelForScore(scored.riskScore),
    riskScore: scored.riskScore,
    confidence: scored.confidence,
    summary: scored.summary,
    indicators: scored.indicators,
    redFlags: scored.redFlags,
    recommendations: scored.recommendations,
    extractedEntities: scored.extractedEntities,
    metadata: {
      ...((input.metadata as Record<string, unknown> | undefined) ?? {}),
      detectionVersion: 'scamshield-rules-v2',
      confidenceScore: scored.confidenceScore,
      matchedSignalCount: scored.indicators.length,
      informationOnly: true,
      humanReviewRequired: true
    }
  });

  await audit(context, action, analysis._id.toString(), {
    type,
    riskLevel: analysis.riskLevel,
    riskScore: analysis.riskScore
  });

  return analysis;
};

const getOwnedAnalysis = async (
  owner: ScamShieldOwner,
  analysisId: string
): Promise<HydratedScamShieldAnalysisDocument> => {
  const analysis = await ScamShieldAnalysisModel.findOne({
    _id: analysisId,
    ...ownerFilter(owner)
  });

  if (!analysis) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'ScamShield analysis not found');
  }

  return analysis;
};

export const analyzeText = async (context: ScamShieldServiceContext, input: AnalyzeTextInput) =>
  createAnalysis(context, 'text', input.text, input, SCAMSHIELD_ACTIONS.analyzeText);

export const analyzeEmail = async (context: ScamShieldServiceContext, input: AnalyzeEmailInput) =>
  createAnalysis(
    context,
    'email',
    `${input.subject ?? ''}\n${input.from ?? ''}\n${input.body}`,
    input,
    SCAMSHIELD_ACTIONS.analyzeEmail
  );

export const analyzeScreenshot = async (
  context: ScamShieldServiceContext,
  input: AnalyzeScamEvidenceInput
): Promise<ScamShieldAnalysisDocument> => {
  const evidenceText = await buildEvidenceAnalysisText(input);
  const hasDocumentFiles = evidenceText.extractedFiles.some(
    (file) => file.extractor !== 'openai-vision-ocr'
  );
  const analysisType: ScamShieldAnalysisType = hasDocumentFiles ? 'evidence' : 'screenshot';

  return createAnalysis(
    context,
    analysisType,
    evidenceText.text,
    {
      ...input,
      imageBase64: input.imageBase64 ? '[redacted-image-data]' : undefined,
      files: input.files?.map((file) => ({
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size
      })),
      imageText: evidenceText.text,
      metadata: {
        ...input.metadata,
        ocrApplied: evidenceText.ocrApplied,
        extractedTextLength: evidenceText.text.length,
        uploadedFiles: evidenceText.extractedFiles.map((file) => ({
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
          extractor: file.extractor,
          extractedTextLength: file.text.length
        }))
      }
    },
    SCAMSHIELD_ACTIONS.analyzeScreenshot
  );
};

export const checkUrl = async (context: ScamShieldServiceContext, input: CheckUrlInput) =>
  createAnalysis(context, 'url', input.url, input, SCAMSHIELD_ACTIONS.checkUrl);

export const getAnalysisById = async (context: ScamShieldServiceContext, analysisId: string) => {
  const analysis = await getOwnedAnalysis(context.owner, analysisId);
  await audit(context, SCAMSHIELD_ACTIONS.get, analysis._id.toString());

  return analysis;
};

export const redactScamContent = async (
  context: ScamShieldServiceContext,
  input: RedactScamContentInput
): Promise<Record<string, unknown>> => {
  await assertAiConsent(context.owner);
  const redacted = input.text
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      input.replacement === 'mask' ? '***' : '[EMAIL]'
    )
    .replace(/\+?\d[\d\s().-]{7,}\d/g, input.replacement === 'mask' ? '***' : '[PHONE]')
    .replace(/https?:\/\/[^\s]+/gi, input.replacement === 'mask' ? '***' : '[URL]');

  await audit(context, SCAMSHIELD_ACTIONS.redact, undefined, {
    inputHash: hashValue(input.text)
  });

  return {
    redactedText: redacted,
    informationOnly: true
  };
};

const getEntityValues = (
  entities: Record<string, unknown> | undefined,
  key: keyof ScamShieldExtractedEntities
): string[] => {
  const value = entities?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

const getEntityString = (
  entities: Record<string, unknown> | undefined,
  key: keyof ScamShieldExtractedEntities
): string | undefined => {
  const value = entities?.[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const inferScamCategory = (analysis: ScamShieldAnalysisDocument): string => {
  const indicators = new Set(analysis.indicators.map((indicator) => indicator.toLowerCase()));

  if (indicators.has('crypto or investment lure')) {
    return 'Investment or crypto scam';
  }

  if (indicators.has('invoice or payment redirection')) {
    return 'Payment redirection or invoice scam';
  }

  if (indicators.has('OTP or MFA request') || indicators.has('credential request')) {
    return 'Phishing or account takeover';
  }

  if (indicators.has('remote access request')) {
    return 'Remote access scam';
  }

  if (indicators.has('delivery or toll lure')) {
    return 'Delivery, toll, or fee scam';
  }

  if (indicators.has('job or task scam')) {
    return 'Job or task scam';
  }

  return analysis.riskScore >= 25
    ? 'Suspected scam or fraud attempt'
    : 'Low-confidence suspicious message';
};

const inferPlatform = (analysis: ScamShieldAnalysisDocument): string => {
  const entities = analysis.extractedEntities;
  const primaryUrlDomain = getEntityString(entities, 'primaryUrlDomain');
  const possibleSender = getEntityString(entities, 'possibleSender');

  if (analysis.type === 'url' && primaryUrlDomain) {
    return `Web link (${primaryUrlDomain})`;
  }

  if (analysis.type === 'email') {
    return possibleSender ? `Email (${possibleSender})` : 'Email';
  }

  if (analysis.type === 'screenshot' || analysis.type === 'evidence') {
    return 'Uploaded evidence';
  }

  return primaryUrlDomain ? `Message with link (${primaryUrlDomain})` : 'Message text';
};

const buildScamReportDraft = (
  analysis: ScamShieldAnalysisDocument,
  notes?: string
): Record<string, unknown> => {
  const entities = analysis.extractedEntities;
  const urls = getEntityValues(entities, 'urls');
  const emailAddresses = getEntityValues(entities, 'emailAddresses');
  const phoneNumbers = getEntityValues(entities, 'phoneNumbers');
  const amounts = getEntityValues(entities, 'amounts');
  const paymentMethods = getEntityValues(entities, 'paymentMethods');
  const organizations = getEntityValues(entities, 'organizations');
  const entityLines = [
    urls.length ? `URLs: ${urls.slice(0, 3).join(', ')}` : undefined,
    emailAddresses.length ? `Email addresses: ${emailAddresses.slice(0, 3).join(', ')}` : undefined,
    phoneNumbers.length ? `Phone numbers: ${phoneNumbers.slice(0, 3).join(', ')}` : undefined,
    amounts.length ? `Amounts: ${amounts.slice(0, 3).join(', ')}` : undefined,
    paymentMethods.length ? `Payment methods: ${paymentMethods.join(', ')}` : undefined,
    organizations.length ? `Referenced organizations: ${organizations.join(', ')}` : undefined
  ].filter((line): line is string => Boolean(line));
  const draftLines = [
    `ScamShield assessment: ${analysis.riskLevel} risk (${analysis.riskScore}/100), ${analysis.confidence ?? 'rule-based'} confidence.`,
    analysis.summary ? `Summary: ${analysis.summary}` : undefined,
    analysis.indicators.length
      ? `Detected signals: ${analysis.indicators.join(', ')}.`
      : 'Detected signals: no strong automated scam markers found.',
    entityLines.length ? `Extracted details: ${entityLines.join('; ')}.` : undefined,
    analysis.recommendations.length
      ? `Suggested protective actions: ${analysis.recommendations.slice(0, 3).join(' ')}`
      : undefined,
    notes ? `Reporter notes: ${notes}` : undefined
  ].filter((line): line is string => Boolean(line));

  return {
    source: 'scamshield',
    summary: analysis.summary,
    draft: draftLines.join('\n\n'),
    riskLevel: analysis.riskLevel,
    riskScore: analysis.riskScore,
    confidence: analysis.confidence,
    indicators: analysis.indicators,
    redFlags: analysis.redFlags,
    recommendations: analysis.recommendations,
    extractedEntities: analysis.extractedEntities,
    scamCategory: inferScamCategory(analysis),
    platform: inferPlatform(analysis),
    senderName:
      getEntityString(entities, 'possibleSender') ??
      getEntityString(entities, 'primaryUrlDomain') ??
      'Unknown sender',
    notes,
    informationOnly: true,
    humanReviewRequired: true
  };
};

export const generateReportDraft = async (
  context: ScamShieldServiceContext,
  input: GenerateReportDraftInput
): Promise<ScamShieldAnalysisDocument> => {
  const analysis = await getOwnedAnalysis(context.owner, input.analysisId);
  analysis.draftReport = buildScamReportDraft(analysis, input.notes);
  await analysis.save();
  await audit(context, SCAMSHIELD_ACTIONS.generateReportDraft, analysis._id.toString());

  return analysis;
};

export const submitScamReport = async (
  context: ScamShieldServiceContext,
  input: SubmitScamReportInput
): Promise<ScamShieldAnalysisDocument> => {
  await assertShareConsent(context.owner, input.consentToShare);
  const analysis = await getOwnedAnalysis(context.owner, input.analysisId);
  analysis.status = 'submitted';
  analysis.submittedAt = new Date();
  analysis.metadata = {
    ...analysis.metadata,
    submissionDestination: input.destination,
    consentToShare: input.consentToShare
  };
  await analysis.save();
  await audit(context, SCAMSHIELD_ACTIONS.submit, analysis._id.toString(), {
    destination: input.destination,
    consentToShare: input.consentToShare
  });

  return analysis;
};
