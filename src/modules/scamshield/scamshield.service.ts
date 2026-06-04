import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import path from 'node:path';
import tls from 'node:tls';

import { StatusCodes } from 'http-status-codes';
import { Types, type HydratedDocument } from 'mongoose';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { env } from '@config/env';
import { ApiError } from '@common/errors/ApiError';
import { AdminDestinationModel, AdminSubmissionTemplateModel } from '@modules/admin/admin.model';
import { createAuditLog } from '@modules/audit/audit.service';
import { getCurrentConsent } from '@modules/consent/consent.service';
import {
  buildSubmissionPayloadFromTemplate,
  executeReportDelivery,
  getMissingRequiredTemplateFields
} from '@modules/reports/reports-delivery.service';
import { ReportModel, ReportSubmissionModel } from '@modules/reports/reports.model';

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
  ScamShieldRiskLevel,
  ScamShieldStatus,
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
type LocalScamShieldAnalysis = {
  _id?: string;
  userId?: string;
  sessionId?: string;
  reportId?: unknown;
  type: ScamShieldAnalysisType;
  inputHash: string;
  riskLevel: ScamShieldRiskLevel;
  riskScore: number;
  confidence?: string;
  summary?: string;
  indicators: string[];
  redFlags: string[];
  recommendations: string[];
  extractedEntities?: Record<string, unknown>;
  redactedContent?: string;
  draftReport?: Record<string, unknown>;
  status: ScamShieldStatus;
  submittedAt?: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};
type ScamShieldAnalysisLike = ScamShieldAnalysisDocument | LocalScamShieldAnalysis;
type ScamContentClassification = {
  isFormalDocument: boolean;
  isTrustedReferenceDocument: boolean;
  trustedDomains: string[];
  matchedMarkers: string[];
};

const MAX_SCAMSHIELD_ANALYSIS_TEXT_LENGTH = 20000;
const SCAMSHIELD_REPUTATION_TIMEOUT_MS = 3500;
const SCAMSHIELD_RECENT_DOMAIN_DAYS = 180;
const URLHAUS_AUTH_KEY = env.SCAMSHIELD_URLHAUS_AUTH_KEY?.trim();
const SAFE_BROWSING_API_KEY = env.SCAMSHIELD_SAFE_BROWSING_API_KEY?.trim();
const KNOWN_BRAND_KEYWORDS = [
  'paypal',
  'mygov',
  'ato',
  'centrelink',
  'medicare',
  'amazon',
  'microsoft',
  'apple',
  'google',
  'netflix',
  'auspost',
  'dhl',
  'fedex',
  'linkt',
  'bank'
] as const;
const TRUSTED_REFERENCE_DOMAIN_SUFFIXES = [
  'legislation.gov.au',
  'gov.au',
  'gov',
  'parliament.au',
  'aph.gov.au',
  'federalregister.gov.au',
  'nsw.gov.au',
  'vic.gov.au',
  'qld.gov.au',
  'sa.gov.au',
  'wa.gov.au',
  'tas.gov.au',
  'nt.gov.au',
  'act.gov.au'
] as const;
const TRUSTED_REFERENCE_EXACT_HOSTS = ['www.legislation.gov.au', 'legislation.gov.au'] as const;
const FORMAL_DOCUMENT_PATTERNS: Array<[string, RegExp]> = [
  ['legislation heading', /\b(?:act|regulation|bill|ordinance|legislative instrument)\b/i],
  ['section structure', /\b(?:section|subsection|schedule|chapter|part|division|clause)\b/i],
  ['government drafting', /\b(?:commonwealth of australia|minister|parliament|senate|house of representatives)\b/i],
  ['legal drafting', /\b(?:commencement|amendment|repeal|prescribed|statutory|jurisdiction)\b/i],
  ['official register', /\b(?:federal register of legislation|legislation\.gov\.au)\b/i]
];
const DOCUMENT_GENERIC_SIGNALS = new Set([
  'link in message',
  'threat or penalty',
  'prize or refund lure',
  'official impersonation',
  'payment request',
  'many subdomains',
  'possible typosquatting'
]);
const DOCUMENT_CONCRETE_SCAM_SIGNALS = new Set([
  'credential request',
  'OTP or MFA request',
  'gift card payment',
  'crypto or investment lure',
  'remote access request',
  'invoice or payment redirection',
  'delivery or toll lure',
  'romance or emotional manipulation',
  'job or task scam',
  'personal information request',
  'shortened link',
  'punycode domain',
  'IP address link',
  'hidden destination marker',
  'sensitive action in link',
  'unencrypted link',
  'unparseable URL',
  'recent domain registration',
  'tls certificate issue',
  'known malicious host listing',
  'known harmful url database match',
  'possible homograph attack',
  'reply-to mismatch',
  'return-path mismatch',
  'spf failed',
  'dkim failed',
  'dmarc failed'
]);
const BANK_REFERENCE_PATTERNS = [
  /\b(?:bsb|account number|acct|iban|swift|sort code|beneficiary)\b/gi,
  /\b(?:payment reference|reference number|invoice number|customer number)\b/gi
];
const TRANSACTION_ID_PATTERNS = [
  /\b(?:transaction(?:\s+id)?|txn|txid|receipt|remittance)\s*[:#-]?\s*[A-Z0-9-]{6,}\b/gi,
  /\b[A-Z0-9]{8,}-[A-Z0-9-]{4,}\b/gi
];
const AU_BANK_FRAUD_CONTACTS: Record<string, { bank: string; phone: string; website: string }> = {
  anz: {
    bank: 'ANZ',
    phone: '13 13 14',
    website: 'https://www.anz.com.au/security/report-fraud/'
  },
  commbank: {
    bank: 'Commonwealth Bank',
    phone: '13 22 21',
    website: 'https://www.commbank.com.au/support/security/report-fraud-scams.html'
  },
  nab: {
    bank: 'NAB',
    phone: '13 22 65',
    website: 'https://www.nab.com.au/about-us/security/report-fraud'
  },
  westpac: {
    bank: 'Westpac',
    phone: '1300 364 294',
    website: 'https://www.westpac.com.au/security/fraud/'
  }
};
const SCAMSHIELD_DELIVERY_DESTINATION_MAP = {
  scamwatch: 'scamwatch',
  reportCyber: 'reportcyber',
  reportcyber: 'reportcyber'
} as const;

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
  bankReferences: string[];
  transactionIds: string[];
  urlSignals: string[];
  primaryUrlDomain?: string;
  possibleSender?: string;
};

type ScamShieldUrlReputation = {
  domain?: string;
  resolvedIps: string[];
  ipGeolocation?: string;
  domainAgeDays?: number;
  createdAt?: string;
  registrar?: string;
  tlsIssuer?: string;
  tlsValidTo?: string;
  tlsSubject?: string;
  tlsValid?: boolean;
  urlhausListed?: boolean;
  typosquattingTarget?: string;
  homographRisk?: boolean;
  signals: string[];
  checksRun: string[];
  notes: string[];
};

type ScamShieldSenderAnalysis = {
  possibleSender?: string;
  replyTo?: string;
  returnPath?: string;
  receivedPath: string[];
  authenticationResults: string[];
  spf: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none';
  dkim: 'pass' | 'fail' | 'none';
  dmarc: 'pass' | 'fail' | 'none';
  signals: string[];
  notes: string[];
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
  urlReputation?: ScamShieldUrlReputation;
  senderAnalysis?: ScamShieldSenderAnalysis;
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

const safeFetchJson = async <T>(url: string, init?: RequestInit): Promise<T | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCAMSHIELD_REPUTATION_TIMEOUT_MS);
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {})
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const getConsentFlags = async (owner: ScamShieldOwner) => getCurrentConsent(owner);

const safeLookupAddresses = async (hostname: string): Promise<string[]> => {
  try {
    const results = await dns.lookup(hostname, { all: true });
    return uniqueValues(results.map((entry) => entry.address));
  } catch {
    return [];
  }
};

const safeReadTlsCertificate = async (
  hostname: string
): Promise<{
  issuer?: string;
  validTo?: string;
  subject?: string;
  valid: boolean;
} | null> => {
  try {
    return await new Promise((resolve) => {
      const socket = tls.connect(
        {
          host: hostname,
          port: 443,
          servername: hostname,
          rejectUnauthorized: false,
          timeout: SCAMSHIELD_REPUTATION_TIMEOUT_MS
        },
        () => {
          const certificate = socket.getPeerCertificate();
          const issuer = certificate?.issuer?.O ?? certificate?.issuer?.CN;
          const subject = certificate?.subject?.CN;
          resolve({
            issuer: Array.isArray(issuer) ? issuer.join(', ') : issuer,
            validTo: certificate?.valid_to,
            subject: Array.isArray(subject) ? subject.join(', ') : subject,
            valid: Boolean(certificate?.valid_to && new Date(certificate.valid_to) > new Date())
          });
          socket.end();
        }
      );

      socket.on('error', () => {
        resolve(null);
      });
      socket.on('timeout', () => {
        resolve(null);
        socket.destroy();
      });
    });
  } catch {
    return null;
  }
};

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0)
  );

  for (let row = 0; row <= left.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= right.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
};

const isTrustedReferenceDomain = (hostname: string): boolean => {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '');

  return (
    TRUSTED_REFERENCE_EXACT_HOSTS.includes(
      normalizedHostname as (typeof TRUSTED_REFERENCE_EXACT_HOSTS)[number]
    ) ||
    TRUSTED_REFERENCE_DOMAIN_SUFFIXES.some(
      (suffix) => normalizedHostname === suffix || normalizedHostname.endsWith(`.${suffix}`)
    )
  );
};

const getLikelyBrandTyposquat = (hostname: string): string | undefined => {
  const normalizedHostname = hostname.toLowerCase().replace(/^www\./, '');
  const labels = normalizedHostname
    .split('.')
    .filter((label) => label.length >= 4 && !['gov', 'com', 'org', 'net', 'edu', 'au'].includes(label));

  if (isTrustedReferenceDomain(normalizedHostname)) {
    return undefined;
  }

  return KNOWN_BRAND_KEYWORDS.find((brand) =>
    labels.some((label) => {
      if (label === brand) {
        return false;
      }

      if (Math.abs(label.length - brand.length) > 2) {
        return false;
      }

      if (label[0] !== brand[0]) {
        return false;
      }

      return levenshteinDistance(label, brand) <= 2;
    })
  );
};

const normalizeAuthenticationResult = (
  value: string | undefined,
  allowed: Array<'pass' | 'fail' | 'softfail' | 'neutral' | 'none'>
): 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' => {
  const normalized = value?.toLowerCase();

  if (!normalized) {
    return 'none';
  }

  return allowed.includes(normalized as (typeof allowed)[number])
    ? (normalized as 'pass' | 'fail' | 'softfail' | 'neutral' | 'none')
    : 'none';
};

const extractHeaderValue = (
  headers: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const directValue = headers?.[key] ?? headers?.[key.toLowerCase()] ?? headers?.[key.toUpperCase()];

  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }

  return undefined;
};

export const analyzeSenderProfile = (input: AnalyzeEmailInput): ScamShieldSenderAnalysis => {
  const headers = input.headers as Record<string, unknown>;
  const authResults = extractHeaderValue(headers, 'Authentication-Results');
  const spfRaw =
    authResults?.match(/\bspf=(pass|fail|softfail|neutral)\b/i)?.[1] ??
    extractHeaderValue(headers, 'Received-SPF')?.match(/\b(pass|fail|softfail|neutral)\b/i)?.[1];
  const dkimRaw = authResults?.match(/\bdkim=(pass|fail)\b/i)?.[1];
  const dmarcRaw = authResults?.match(/\bdmarc=(pass|fail)\b/i)?.[1];
  const replyTo = extractHeaderValue(headers, 'Reply-To');
  const returnPath = extractHeaderValue(headers, 'Return-Path');
  const receivedHeaders = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === 'received')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5);
  const signals: string[] = [];
  const notes: string[] = [];
  const sender = input.from?.trim();

  if (sender && replyTo && replyTo.toLowerCase() !== sender.toLowerCase()) {
    signals.push('reply-to mismatch');
    notes.push('The reply-to address differs from the visible sender.');
  }

  if (sender && returnPath && !returnPath.toLowerCase().includes(sender.toLowerCase())) {
    signals.push('return-path mismatch');
    notes.push('The return-path does not match the visible sender.');
  }

  const spf = normalizeAuthenticationResult(spfRaw, ['pass', 'fail', 'softfail', 'neutral', 'none']);
  const dkim = normalizeAuthenticationResult(dkimRaw, ['pass', 'fail', 'none']) as 'pass' | 'fail' | 'none';
  const dmarc = normalizeAuthenticationResult(dmarcRaw, ['pass', 'fail', 'none']) as 'pass' | 'fail' | 'none';

  if (spf === 'fail' || spf === 'softfail') {
    signals.push('spf failed');
    notes.push('SPF authentication did not pass for this sender.');
  }

  if (dkim === 'fail') {
    signals.push('dkim failed');
    notes.push('DKIM authentication failed for this message.');
  }

  if (dmarc === 'fail') {
    signals.push('dmarc failed');
    notes.push('DMARC authentication failed for this message.');
  }

  if (!input.forwardedWithPermission && Object.keys(headers).length > 0) {
    notes.push('Headers were provided without an explicit forwarded-with-permission flag.');
  }

  return {
    possibleSender: sender,
    replyTo,
    returnPath,
    receivedPath: receivedHeaders,
    authenticationResults: authResults ? [authResults] : [],
    spf,
    dkim,
    dmarc,
    signals: uniqueValues(signals),
    notes
  };
};

const analyzeUrlReputation = async (hostname: string): Promise<ScamShieldUrlReputation> => {
  const domain = hostname.toLowerCase();
  const resolvedIps = await safeLookupAddresses(domain);
  const tlsCertificate = await safeReadTlsCertificate(domain);
  const rdap = await safeFetchJson<{
    events?: Array<{ eventAction?: string; eventDate?: string }>;
    entities?: Array<Record<string, unknown>>;
  }>(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  const ipGeo = resolvedIps[0]
    ? await safeFetchJson<{ country?: string; city?: string }>(
        `https://ipwho.is/${encodeURIComponent(resolvedIps[0])}`
      )
    : null;
  const urlhausListed = Boolean(
    URLHAUS_AUTH_KEY &&
      (await safeFetchJson<{ query_status?: string }>(
        `https://urlhaus-api.abuse.ch/v1/host/${encodeURIComponent(domain)}`,
        {
          headers: {
            'Auth-Key': URLHAUS_AUTH_KEY
          }
        }
      ))?.query_status === 'ok'
  );
  const safeBrowsingMatch = SAFE_BROWSING_API_KEY
    ? await safeFetchJson<{ matches?: unknown[] }>(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(
          SAFE_BROWSING_API_KEY
        )}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            client: {
              clientId: 'safespeak',
              clientVersion: '1.0'
            },
            threatInfo: {
              threatTypes: [
                'MALWARE',
                'SOCIAL_ENGINEERING',
                'UNWANTED_SOFTWARE',
                'POTENTIALLY_HARMFUL_APPLICATION'
              ],
              platformTypes: ['ANY_PLATFORM'],
              threatEntryTypes: ['URL'],
              threatEntries: [{ url: `https://${domain}` }, { url: `http://${domain}` }]
            }
          })
        }
      )
    : null;
  const signals: string[] = [];
  const notes: string[] = [];
  const checksRun = ['dns', 'tls', 'rdap'];
  const createdAt = rdap?.events?.find((event) => event.eventAction === 'registration')?.eventDate;
  const domainAgeDays = createdAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
      )
    : undefined;
  const typosquattingTarget = getLikelyBrandTyposquat(domain);
  const homographRisk = domain.includes('xn--');

  if (resolvedIps.length && ipGeo) {
    checksRun.push('ip_geolocation');
  }

  if (URLHAUS_AUTH_KEY) {
    checksRun.push('urlhaus');
  }

  if (SAFE_BROWSING_API_KEY) {
    checksRun.push('google_safe_browsing');
  }

  if (domainAgeDays !== undefined && domainAgeDays <= SCAMSHIELD_RECENT_DOMAIN_DAYS) {
    signals.push('recent domain registration');
    notes.push(`The domain appears to be newly registered (${domainAgeDays} days old).`);
  }

  if (tlsCertificate && !tlsCertificate.valid) {
    signals.push('tls certificate issue');
    notes.push('The TLS certificate is expired, invalid, or missing expected validity details.');
  }

  if (urlhausListed) {
    signals.push('known malicious host listing');
    notes.push('The domain matched the optional URLhaus host check.');
  }

  if (safeBrowsingMatch?.matches?.length) {
    signals.push('known harmful url database match');
    notes.push('The domain matched an optional Safe Browsing harmful URL check.');
  }

  if (typosquattingTarget) {
    signals.push('possible typosquatting');
    notes.push(`The domain resembles the trusted brand name "${typosquattingTarget}".`);
  }

  if (homographRisk) {
    signals.push('possible homograph attack');
    notes.push('The domain uses punycode, which can hide visually deceptive characters.');
  }

  return {
    domain,
    resolvedIps,
    ipGeolocation:
      ipGeo?.country && ipGeo?.city ? `${ipGeo.city}, ${ipGeo.country}` : ipGeo?.country,
    domainAgeDays,
    createdAt,
    tlsIssuer: tlsCertificate?.issuer,
    tlsValidTo: tlsCertificate?.validTo,
    tlsSubject: tlsCertificate?.subject,
    tlsValid: tlsCertificate?.valid,
    urlhausListed,
    typosquattingTarget,
    homographRisk,
    signals: uniqueValues(signals),
    checksRun,
    notes
  };
};

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
    const trustedReferenceDomain = isTrustedReferenceDomain(hostname);

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

    if (subdomainCount >= 5 && !trustedReferenceDomain) {
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

const classifyDocumentContext = (
  content: string,
  entities: ScamShieldExtractedEntities,
  options?: {
    analysisType?: ScamShieldAnalysisType;
    uploadedFiles?: Array<{ fileName?: string; mimeType?: string; extractor?: string }>;
  }
): ScamContentClassification => {
  const urls = entities.urls
    .map(parseUrl)
    .filter((url): url is URL => Boolean(url))
    .map((url) => url.hostname.toLowerCase());
  const trustedDomains = uniqueValues(urls.filter((hostname) => isTrustedReferenceDomain(hostname)));
  const matchedMarkers = FORMAL_DOCUMENT_PATTERNS.filter(([, pattern]) => pattern.test(content)).map(
    ([label]) => label
  );
  const uploadedFiles = options?.uploadedFiles ?? [];
  const fileSuggestsDocument = uploadedFiles.some((file) =>
    /\.(?:pdf|doc|docx)$/i.test(file.fileName ?? '') ||
    /(?:pdf|wordprocessingml|msword)/i.test(file.mimeType ?? '') ||
    file.extractor === 'mammoth' ||
    file.extractor === 'pdf-parse'
  );
  const documentAnalysisType =
    options?.analysisType === 'evidence' || (matchedMarkers.length >= 3 && trustedDomains.length > 0);
  const isFormalDocument =
    documentAnalysisType &&
    (matchedMarkers.length >= 2 || (matchedMarkers.length >= 1 && trustedDomains.length > 0) || fileSuggestsDocument);
  const isTrustedReferenceDocument = isFormalDocument && trustedDomains.length > 0 && matchedMarkers.length > 0;

  return {
    isFormalDocument,
    isTrustedReferenceDocument,
    trustedDomains,
    matchedMarkers
  };
};

const stripGenericSignalsForTrustedDocument = (
  detections: ScamSignalDetection[],
  entities: ScamShieldExtractedEntities,
  urlReputation: ScamShieldUrlReputation | undefined,
  classification: ScamContentClassification
): ScamSignalDetection[] => {
  if (!classification.isTrustedReferenceDocument) {
    return detections;
  }

  const trustedPrimaryUrl =
    entities.primaryUrlDomain && isTrustedReferenceDomain(entities.primaryUrlDomain.toLowerCase());
  const trustedUrlsOnly =
    entities.urls.length > 0 &&
    entities.urls.every((url) => {
      const parsed = parseUrl(url);

      return Boolean(parsed && isTrustedReferenceDomain(parsed.hostname.toLowerCase()));
    });
  const reputationHasConcreteRisk = Boolean(
    urlReputation?.signals.some((signal) => DOCUMENT_CONCRETE_SCAM_SIGNALS.has(signal))
  );

  return detections.filter((detection) => {
    if (!DOCUMENT_GENERIC_SIGNALS.has(detection.label)) {
      return true;
    }

    if (
      detection.label === 'link in message' &&
      trustedUrlsOnly &&
      !entities.urlSignals.some((signal) => DOCUMENT_CONCRETE_SCAM_SIGNALS.has(signal)) &&
      !reputationHasConcreteRisk
    ) {
      return false;
    }

    if (
      (detection.label === 'many subdomains' || detection.label === 'possible typosquatting') &&
      trustedPrimaryUrl
    ) {
      return false;
    }

    if (
      detection.label === 'threat or penalty' ||
      detection.label === 'prize or refund lure' ||
      detection.label === 'official impersonation' ||
      detection.label === 'payment request'
    ) {
      return false;
    }

    return true;
  });
};

const capRiskForFormalReferenceDocument = (
  detections: ScamSignalDetection[],
  urlReputation: ScamShieldUrlReputation | undefined,
  classification: ScamContentClassification,
  riskScore: number
): number => {
  if (!classification.isTrustedReferenceDocument) {
    return riskScore;
  }

  const hasConcreteSignals =
    detections.some((detection) => DOCUMENT_CONCRETE_SCAM_SIGNALS.has(detection.label)) ||
    Boolean(urlReputation?.signals.some((signal) => DOCUMENT_CONCRETE_SCAM_SIGNALS.has(signal)));

  if (hasConcreteSignals) {
    return riskScore;
  }

  return Math.min(riskScore, detections.length ? 18 : 8);
};

export const extractScamEntities = (content: string): ScamShieldExtractedEntities => {
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
  const bankReferences = uniqueValues(
    BANK_REFERENCE_PATTERNS.flatMap((pattern) =>
      Array.from(content.matchAll(pattern)).map((match) => match[0])
    )
  );
  const transactionIds = uniqueValues(
    TRANSACTION_ID_PATTERNS.flatMap((pattern) =>
      Array.from(content.matchAll(pattern)).map((match) => match[0])
    )
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
    bankReferences,
    transactionIds,
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

const scoreContent = async (
  content: string,
  options?: {
    emailInput?: AnalyzeEmailInput;
    analysisType?: ScamShieldAnalysisType;
    uploadedFiles?: Array<{ fileName?: string; mimeType?: string; extractor?: string }>;
  }
): Promise<ScoredScamContent> => {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  const entities = extractScamEntities(normalizedContent);
  const detections: ScamSignalDetection[] = [];
  const detectionLabels = new Set<string>();
  const senderAnalysis = options?.emailInput ? analyzeSenderProfile(options.emailInput) : undefined;
  const urlReputation = entities.primaryUrlDomain
    ? await analyzeUrlReputation(entities.primaryUrlDomain)
    : undefined;
  const classification = classifyDocumentContext(normalizedContent, entities, {
    analysisType: options?.analysisType,
    uploadedFiles: options?.uploadedFiles
  });

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

  urlReputation?.signals.forEach((signal) => {
    addDetection(detections, detectionLabels, {
      label: signal,
      redFlag: `Link reputation checks flagged: ${signal}.`,
      recommendation:
        'Avoid the link and verify the organisation through a trusted website, app, or phone number.',
      weight:
        signal === 'known malicious host listing'
          ? 30
          : signal === 'possible typosquatting' || signal === 'possible homograph attack'
            ? 20
            : 12
    });
  });

  senderAnalysis?.signals.forEach((signal) => {
    addDetection(detections, detectionLabels, {
      label: signal,
      redFlag: `Sender analysis flagged: ${signal}.`,
      recommendation:
        'Treat the email cautiously and contact the organisation using a known official address or phone number.',
      weight:
        signal === 'dmarc failed' || signal === 'dkim failed' || signal === 'spf failed' ? 18 : 12
    });
  });

  const normalizedDetections = stripGenericSignalsForTrustedDocument(
    detections,
    entities,
    urlReputation,
    classification
  );
  const normalizedDetectionLabels = new Set(normalizedDetections.map((detection) => detection.label));
  const signalScore = normalizedDetections.reduce((total, detection) => total + detection.weight, 0);
  const combinationBoost =
    (normalizedDetectionLabels.has('credential request') &&
    normalizedDetectionLabels.has('link in message')
      ? 10
      : 0) +
    (normalizedDetectionLabels.has('OTP or MFA request') &&
    normalizedDetectionLabels.has('official impersonation')
      ? 12
      : 0) +
    (normalizedDetectionLabels.has('payment request') &&
    normalizedDetectionLabels.has('urgent pressure')
      ? 8
      : 0) +
    (entities.amounts.length ? 7 : 0) +
    (entities.phoneNumbers.length && normalizedDetectionLabels.has('official impersonation') ? 5 : 0) +
    (entities.transactionIds.length ? 4 : 0) +
    (senderAnalysis?.signals.length ? 8 : 0) +
    (urlReputation?.signals.length ? 10 : 0) +
    (normalizedContent.length > 2000 ? 5 : 0);
  const riskScore = capRiskForFormalReferenceDocument(
    normalizedDetections,
    urlReputation,
    classification,
    Math.min(100, Math.max(0, Math.round(signalScore + combinationBoost)))
  );
  const riskLevel = riskLevelForScore(riskScore);
  const confidenceScore = Math.min(
    0.95,
    Math.max(
      0.35,
      0.35 +
        normalizedDetections.length * 0.08 +
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
    summary:
      classification.isTrustedReferenceDocument && normalizedDetections.length === 0
        ? 'This appears to be a formal reference or legislation document. No strong scam markers were detected in the uploaded file.'
        : buildSummary(riskLevel, normalizedDetections),
    indicators: normalizedDetections.map((detection) => detection.label),
    redFlags: normalizedDetections.map((detection) => detection.redFlag),
    recommendations: normalizedDetections.length
      ? uniqueValues(normalizedDetections.map((detection) => detection.recommendation))
      : fallbackRecommendations,
    extractedEntities: entities,
    urlReputation,
    senderAnalysis
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
  action: string,
  options?: {
    emailInput?: AnalyzeEmailInput;
    analysisType?: ScamShieldAnalysisType;
    uploadedFiles?: Array<{ fileName?: string; mimeType?: string; extractor?: string }>;
  }
): Promise<ScamShieldAnalysisLike> => {
  await assertAiConsent(context.owner);
  const consent = await getConsentFlags(context.owner);
  const scored = await scoreContent(content, options);
  const language =
    typeof input.language === 'string'
      ? input.language
      : typeof (input.metadata as Record<string, unknown> | undefined)?.language === 'string'
        ? String((input.metadata as Record<string, unknown>).language)
        : 'en';
  const translated = await translateGeneratedCopy(language.toLowerCase(), {
    summary: scored.summary,
    redFlags: scored.redFlags,
    recommendations: scored.recommendations
  });
  const baseAnalysis = {
    ...ownerFilter(context.owner),
    reportId: input.reportId,
    type,
    inputHash: hashValue(input),
    riskLevel: riskLevelForScore(scored.riskScore),
    riskScore: scored.riskScore,
    confidence: scored.confidence,
    summary: translated.summary,
    indicators: scored.indicators,
    redFlags: translated.redFlags,
    recommendations: translated.recommendations,
    extractedEntities: scored.extractedEntities,
    metadata: {
      ...((input.metadata as Record<string, unknown> | undefined) ?? {}),
      detectionVersion: 'scamshield-rules-v2',
      confidenceScore: scored.confidenceScore,
      matchedSignalCount: scored.indicators.length,
      urlReputation: scored.urlReputation,
      senderAnalysis: scored.senderAnalysis,
      language: language.toLowerCase(),
      storageMode: consent.cloud_sync || consent.share_with_agencies ? 'server' : 'local_only',
      informationOnly: true,
      humanReviewRequired: true
    }
  };

  if (!consent.cloud_sync && !consent.share_with_agencies) {
    const localAnalysis: LocalScamShieldAnalysis = {
      ...baseAnalysis,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
      draftReport: undefined
    };

    await audit(context, action, undefined, {
      type,
      riskLevel: localAnalysis.riskLevel,
      riskScore: localAnalysis.riskScore,
      storageMode: 'local_only'
    });

    return localAnalysis;
  }

  const analysis = await ScamShieldAnalysisModel.create(baseAnalysis);

  await audit(context, action, analysis._id.toString(), {
    type,
    riskLevel: analysis.riskLevel,
    riskScore: analysis.riskScore,
    storageMode: 'server'
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
    SCAMSHIELD_ACTIONS.analyzeEmail,
    {
      emailInput: input
    }
  );

export const analyzeScreenshot = async (
  context: ScamShieldServiceContext,
  input: AnalyzeScamEvidenceInput
): Promise<ScamShieldAnalysisLike> => {
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
    ,
    {
      analysisType,
      uploadedFiles: evidenceText.extractedFiles.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        extractor: file.extractor
      }))
    }
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
    .replace(/https?:\/\/[^\s]+/gi, input.replacement === 'mask' ? '***' : '[URL]')
    .replace(/\b(?:AUD|USD|GBP|EUR)\s?\d[\d,]*(?:\.\d{2})?\b|[$€£]\s?\d[\d,]*(?:\.\d{2})?\b/gi, input.replacement === 'mask' ? '***' : '[AMOUNT]')
    .replace(/\b(?:transaction(?:\s+id)?|txn|txid|receipt|remittance)\s*[:#-]?\s*[A-Z0-9-]{6,}\b/gi, input.replacement === 'mask' ? '***' : '[TRANSACTION_ID]');

  await audit(context, SCAMSHIELD_ACTIONS.redact, undefined, {
    inputHash: hashValue(input.text)
  });

  return {
    redactedText: redacted,
    informationOnly: true
  };
};

const redactDraftValue = (
  value: string | undefined,
  replacement: RedactScamContentInput['replacement']
): string | undefined => {
  if (!value) {
    return value;
  }

  return value
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      replacement === 'mask' ? '***' : '[EMAIL]'
    )
    .replace(/\+?\d[\d\s().-]{7,}\d/g, replacement === 'mask' ? '***' : '[PHONE]')
    .replace(/https?:\/\/[^\s]+/gi, replacement === 'mask' ? '***' : '[URL]')
    .replace(
      /\b(?:AUD|USD|GBP|EUR)\s?\d[\d,]*(?:\.\d{2})?\b|[$€£]\s?\d[\d,]*(?:\.\d{2})?\b/gi,
      replacement === 'mask' ? '***' : '[AMOUNT]'
    );
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

const normalizeAnalysisSnapshot = (snapshot: Record<string, unknown>): LocalScamShieldAnalysis => ({
  _id: typeof snapshot._id === 'string' ? snapshot._id : undefined,
  userId: undefined,
  sessionId: undefined,
  reportId: undefined,
  type: (snapshot.type as ScamShieldAnalysisType) ?? 'text',
  inputHash: typeof snapshot.inputHash === 'string' ? snapshot.inputHash : hashValue(snapshot),
  riskLevel: (snapshot.riskLevel as ScamShieldAnalysisDocument['riskLevel']) ?? 'low',
  riskScore: typeof snapshot.riskScore === 'number' ? snapshot.riskScore : 0,
  confidence: typeof snapshot.confidence === 'string' ? snapshot.confidence : undefined,
  summary: typeof snapshot.summary === 'string' ? snapshot.summary : undefined,
  indicators: Array.isArray(snapshot.indicators)
    ? snapshot.indicators.filter((item): item is string => typeof item === 'string')
    : [],
  redFlags: Array.isArray(snapshot.redFlags)
    ? snapshot.redFlags.filter((item): item is string => typeof item === 'string')
    : [],
  recommendations: Array.isArray(snapshot.recommendations)
    ? snapshot.recommendations.filter((item): item is string => typeof item === 'string')
    : [],
  extractedEntities:
    snapshot.extractedEntities && typeof snapshot.extractedEntities === 'object'
      ? (snapshot.extractedEntities as Record<string, unknown>)
      : undefined,
  redactedContent:
    typeof snapshot.redactedContent === 'string' ? snapshot.redactedContent : undefined,
  draftReport:
    snapshot.draftReport && typeof snapshot.draftReport === 'object'
      ? (snapshot.draftReport as Record<string, unknown>)
      : undefined,
  status: (snapshot.status as ScamShieldAnalysisDocument['status']) ?? 'draft',
  submittedAt:
    typeof snapshot.submittedAt === 'string' || snapshot.submittedAt instanceof Date
      ? new Date(snapshot.submittedAt)
      : undefined,
  metadata:
    snapshot.metadata && typeof snapshot.metadata === 'object'
      ? (snapshot.metadata as Record<string, unknown>)
      : {},
  createdAt:
    typeof snapshot.createdAt === 'string' || snapshot.createdAt instanceof Date
      ? new Date(snapshot.createdAt)
      : new Date(),
  updatedAt:
    typeof snapshot.updatedAt === 'string' || snapshot.updatedAt instanceof Date
      ? new Date(snapshot.updatedAt)
      : new Date()
});

const findBankFraudContact = (analysis: ScamShieldAnalysisLike) => {
  const entities = analysis.extractedEntities;
  const organizations = getEntityValues(entities, 'organizations').map((value) => value.toLowerCase());
  const combinedText = `${analysis.summary ?? ''} ${organizations.join(' ')}`.toLowerCase();

  return Object.values(AU_BANK_FRAUD_CONTACTS).find((contact) =>
    combinedText.includes(contact.bank.toLowerCase().replace(/\s+/g, '')) ||
    combinedText.includes(contact.bank.toLowerCase()) ||
    combinedText.includes(contact.bank.split(' ')[0].toLowerCase())
  );
};

const getActiveDestinationByType = async (type: 'scamwatch' | 'reportcyber') => {
  if (AdminDestinationModel.db.readyState !== 1) {
    return null;
  }

  try {
    return await AdminDestinationModel.findOne({ type, isActive: true })
      .sort({ updatedAt: -1 })
      .lean();
  } catch {
    return null;
  }
};

const generateScamShieldRefNo = (): string =>
  `SSS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`;

const createScamReportStatusHistory = (status: string, reason?: string) => [
  {
    status,
    changedAt: new Date(),
    reason
  }
];

const getMatchingScamSubmissionTemplate = async (type: string, channel: string, jurisdiction: string) => {
  if (AdminSubmissionTemplateModel.db.readyState !== 1) {
    return null;
  }

  const exactMatch = await AdminSubmissionTemplateModel.findOne({
      destinationType: type,
      channel,
      jurisdiction,
      isActive: true
    })
    .sort({ updatedAt: -1 });

  if (exactMatch) {
    return exactMatch;
  }

  return AdminSubmissionTemplateModel.findOne({
    destinationType: type,
    channel,
    jurisdiction: { $in: ['ALL', 'AU', 'National'] },
    isActive: true
  });
};

const getAnalysisLanguage = (analysis: ScamShieldAnalysisLike): string => {
  const metadataLanguage = analysis.metadata?.language;

  return typeof metadataLanguage === 'string' && metadataLanguage.trim()
    ? metadataLanguage.trim().toLowerCase()
    : 'en';
};

const executeScamShieldDestinationDelivery = async (
  owner: ScamShieldOwner,
  analysis: ScamShieldAnalysisLike,
  destinationKey: string | undefined
) => {
  const normalizedDestination =
    destinationKey && destinationKey in SCAMSHIELD_DELIVERY_DESTINATION_MAP
      ? SCAMSHIELD_DELIVERY_DESTINATION_MAP[
          destinationKey as keyof typeof SCAMSHIELD_DELIVERY_DESTINATION_MAP
        ]
      : undefined;

  if (!normalizedDestination || AdminDestinationModel.db.readyState !== 1) {
    return null;
  }

  const destination = await AdminDestinationModel.findOne({
    type: normalizedDestination,
    isActive: true
  });

  if (!destination) {
    return null;
  }

  const template = await getMatchingScamSubmissionTemplate(
    destination.type,
    destination.channel,
    destination.jurisdiction
  );
  const consentSnapshot = await getCurrentConsent(owner);
  const report = await ReportModel.create({
    ...ownerFilter(owner),
    refNo: generateScamShieldRefNo(),
    ownerType: owner.userId ? 'user' : 'anonymous',
    language: getAnalysisLanguage(analysis),
    jurisdiction: destination.jurisdiction || 'AU',
    context: 'scamshield',
    originalNarrative:
      typeof analysis.draftReport?.draft === 'string' ? analysis.draftReport.draft : analysis.summary,
    incidentType: 'cyber_scam',
    severity: analysis.riskLevel === 'critical' ? 'critical' : analysis.riskLevel,
    structuredFields: {
      source: 'scamshield',
      extractedEntities: analysis.extractedEntities,
      urlReputation: analysis.metadata?.urlReputation,
      senderAnalysis: analysis.metadata?.senderAnalysis
    },
    consentSnapshot,
    status: 'pending_submission',
    statusHistory: createScamReportStatusHistory('pending_submission', 'scamshield_delivery')
  });

  const basePayload = {
    refNo: report.refNo,
    summary: analysis.summary ?? '',
    incidentType: 'cyber_scam',
    severity: analysis.riskLevel,
    jurisdiction: report.jurisdiction,
    language: report.language,
    destination: {
      key: destination.key,
      type: destination.type,
      name: destination.name,
      channel: destination.channel,
      jurisdiction: destination.jurisdiction
    },
    anonymityMode: 'pseudonymous',
    notes: typeof analysis.draftReport?.draft === 'string' ? analysis.draftReport.draft : '',
    consentFlags: ['share_with_agencies'],
    extractedEntities: analysis.extractedEntities,
    recommendations: analysis.recommendations
  };
  const missingMappedFields = getMissingRequiredTemplateFields(template, basePayload);

  if (missingMappedFields.length > 0) {
    return {
      reportId: report._id.toString(),
      deliveryResult: {
        status: 'config_missing',
        message: `Submission template is missing required mapped fields: ${missingMappedFields.join(', ')}`,
        deliveryMode: 'config_missing',
        deliveryConfigurationStatus: 'config_missing',
        deliveryConfigurationIssues: missingMappedFields,
        actuallySent: false,
        deliveryArtifacts: [],
        externalReference: undefined,
        acknowledgementPayload: undefined
      }
    };
  }

  const payload = buildSubmissionPayloadFromTemplate(template, basePayload);
  const submissionId = new Types.ObjectId();
  const deliveryResult = await executeReportDelivery({
    submissionId: submissionId.toString(),
    refNo: report.refNo,
    destination,
    template,
    payload
  });

  await ReportSubmissionModel.create({
    _id: submissionId,
    ...ownerFilter(owner),
    reportId: report._id,
    ownerType: owner.userId ? 'user' : 'anonymous',
    destinationId: destination._id,
    templateId: template?._id,
    templateKey: template?.key,
    destinationKey: destination.key,
    destinationType: destination.type,
    destinationName: destination.name,
    channel: destination.channel,
    jurisdiction: destination.jurisdiction,
    languages: destination.languages,
    status: deliveryResult.status,
    anonymityMode: 'pseudonymous',
    minimumRequiredInfo: destination.minimumRequiredInfo,
    missingRequiredInfo: [],
    requiredConsentFlags: ['share_with_agencies'],
    expectedNextSteps: destination.expectedNextSteps,
    notes: basePayload.notes,
    endpoint: destination.endpoint,
    contactEmail: destination.contactEmail,
    contactPhone: destination.contactPhone,
    payloadSnapshot: payload,
    evidenceSnapshot: [],
    consentSnapshot,
    deliveryArtifacts: deliveryResult.deliveryArtifacts ?? [],
    deliveryMessage: deliveryResult.message,
    deliveryMode: deliveryResult.deliveryMode,
    deliveryConfigurationStatus: deliveryResult.deliveryConfigurationStatus,
    deliveryConfigurationIssues: deliveryResult.deliveryConfigurationIssues,
    actuallySent: deliveryResult.actuallySent,
    externalReference: deliveryResult.externalReference,
    acknowledgementPayload: deliveryResult.acknowledgementPayload,
    previewGeneratedAt: new Date(),
    submittedAt: deliveryResult.actuallySent ? new Date() : undefined,
    lastAttemptAt: new Date()
  });

  return {
    reportId: report._id.toString(),
    deliveryResult
  };
};

const translateGeneratedCopy = async (
  language: string,
  payload: {
    summary?: string;
    redFlags: string[];
    recommendations: string[];
    draft?: string;
  }
) => {
  if (!env.OPENAI_API_KEY || !language || language === 'en') {
    return payload;
  }

  try {
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
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  `Translate SafeSpeak scam-analysis copy into ${language}. Preserve JSON keys, keep meaning plain and safety-focused, and do not invent new claims.`
              }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify(payload)
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      return payload;
    }

    const result = (await response.json()) as {
      output_text?: string;
    };
    const text = result.output_text?.trim();

    if (!text) {
      return payload;
    }

    const translated = JSON.parse(text) as typeof payload;
    return {
      summary: translated.summary ?? payload.summary,
      redFlags: Array.isArray(translated.redFlags) ? translated.redFlags : payload.redFlags,
      recommendations: Array.isArray(translated.recommendations)
        ? translated.recommendations
        : payload.recommendations,
      draft: translated.draft ?? payload.draft
    };
  } catch {
    return payload;
  }
};

const inferScamCategory = (analysis: ScamShieldAnalysisLike): string => {
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

const inferPlatform = (analysis: ScamShieldAnalysisLike): string => {
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

export const buildScamReportDraft = async (
  analysis: ScamShieldAnalysisLike,
  options?: {
    notes?: string;
    autoRedactPII?: boolean;
    redactionMode?: RedactScamContentInput['replacement'];
  }
): Promise<Record<string, unknown>> => {
  const entities = analysis.extractedEntities;
  const urls = getEntityValues(entities, 'urls');
  const emailAddresses = getEntityValues(entities, 'emailAddresses');
  const phoneNumbers = getEntityValues(entities, 'phoneNumbers');
  const amounts = getEntityValues(entities, 'amounts');
  const paymentMethods = getEntityValues(entities, 'paymentMethods');
  const organizations = getEntityValues(entities, 'organizations');
  const bankReferences = getEntityValues(entities, 'bankReferences');
  const transactionIds = getEntityValues(entities, 'transactionIds');
  const urlReputation = analysis.metadata?.urlReputation as
    | ScamShieldUrlReputation
    | undefined;
  const senderAnalysis = analysis.metadata?.senderAnalysis as
    | ScamShieldSenderAnalysis
    | undefined;
  const redactionMode = options?.redactionMode ?? 'labels';
  const entityLines = [
    urls.length ? `URLs: ${urls.slice(0, 3).join(', ')}` : undefined,
    emailAddresses.length ? `Email addresses: ${emailAddresses.slice(0, 3).join(', ')}` : undefined,
    phoneNumbers.length ? `Phone numbers: ${phoneNumbers.slice(0, 3).join(', ')}` : undefined,
    amounts.length ? `Amounts: ${amounts.slice(0, 3).join(', ')}` : undefined,
    bankReferences.length ? `Bank references: ${bankReferences.slice(0, 3).join(', ')}` : undefined,
    transactionIds.length ? `Transaction IDs: ${transactionIds.slice(0, 3).join(', ')}` : undefined,
    paymentMethods.length ? `Payment methods: ${paymentMethods.join(', ')}` : undefined,
    organizations.length ? `Referenced organizations: ${organizations.join(', ')}` : undefined
  ].filter((line): line is string => Boolean(line));
  const urlReputationLines = urlReputation
    ? [
        urlReputation.domain ? `Checked domain: ${urlReputation.domain}` : undefined,
        typeof urlReputation.domainAgeDays === 'number'
          ? `Estimated domain age: ${urlReputation.domainAgeDays} days`
          : undefined,
        urlReputation.ipGeolocation ? `IP geolocation: ${urlReputation.ipGeolocation}` : undefined,
        urlReputation.signals.length
          ? `Link reputation flags: ${urlReputation.signals.join(', ')}`
          : undefined
      ].filter((line): line is string => Boolean(line))
    : [];
  const senderLines = senderAnalysis
    ? [
        senderAnalysis.possibleSender ? `Sender: ${senderAnalysis.possibleSender}` : undefined,
        senderAnalysis.replyTo ? `Reply-to: ${senderAnalysis.replyTo}` : undefined,
        `SPF: ${senderAnalysis.spf}, DKIM: ${senderAnalysis.dkim}, DMARC: ${senderAnalysis.dmarc}`,
        senderAnalysis.signals.length
          ? `Sender-analysis flags: ${senderAnalysis.signals.join(', ')}`
          : undefined
      ].filter((line): line is string => Boolean(line))
    : [];
  const draftLines = [
    `ScamShield assessment: ${analysis.riskLevel} risk (${analysis.riskScore}/100), ${analysis.confidence ?? 'rule-based'} confidence.`,
    analysis.summary ? `Summary: ${analysis.summary}` : undefined,
    analysis.indicators.length
      ? `Detected signals: ${analysis.indicators.join(', ')}.`
      : 'Detected signals: no strong automated scam markers found.',
    entityLines.length ? `Extracted details: ${entityLines.join('; ')}.` : undefined,
    senderLines.length ? `Sender analysis: ${senderLines.join('; ')}.` : undefined,
    urlReputationLines.length ? `Link reputation: ${urlReputationLines.join('; ')}.` : undefined,
    analysis.recommendations.length
      ? `Suggested protective actions: ${analysis.recommendations.slice(0, 3).join(' ')}`
      : undefined,
    options?.notes ? `Reporter notes: ${options.notes}` : undefined
  ].filter((line): line is string => Boolean(line));
  const [scamwatchDestination, reportCyberDestination] = await Promise.all([
    getActiveDestinationByType('scamwatch'),
    getActiveDestinationByType('reportcyber')
  ]);
  const bankFraudContact = findBankFraudContact(analysis);
  const destinationDrafts = {
    scamwatch: {
      title: 'ACCC Scamwatch',
      downloadFileName: 'scamwatch-report-draft.txt',
      guidanceUrl: scamwatchDestination?.endpoint ?? 'https://www.scamwatch.gov.au/report-a-scam',
      contactPhone: scamwatchDestination?.contactPhone,
      contactEmail: scamwatchDestination?.contactEmail,
      recommendedFiles: ['Screenshot of the message', 'Any payment receipt', 'Bank or card timeline'],
      body:
        'Use this draft to report the scam to ACCC Scamwatch. Review and edit any personal details before submission.'
    },
    reportCyber: {
      title: 'ACSC ReportCyber',
      downloadFileName: 'reportcyber-guidance.txt',
      guidanceUrl: reportCyberDestination?.endpoint ?? 'https://www.cyber.gov.au/report-and-recover/report',
      contactPhone: reportCyberDestination?.contactPhone,
      contactEmail: reportCyberDestination?.contactEmail,
      recommendedFiles: ['Screenshot or forwarded email', 'URLs or domains checked', 'Transaction or account timeline'],
      body:
        'Use this summary for cybercrime reporting and attach the listed evidence if your accounts, identity, or money were exposed.'
    },
    bank: {
      title: 'Bank contact template',
      downloadFileName: 'bank-fraud-contact-template.txt',
      guidanceUrl:
        bankFraudContact?.website ??
        'https://www.scamwatch.gov.au/stop-check-protect/contact-your-bank',
      contactPhone: bankFraudContact?.phone,
      bankName: bankFraudContact?.bank,
      recommendedFiles: ['Proof of unauthorised transaction', 'Card/account identifiers', 'Timeline of contact with scammer'],
      body:
        'Call your bank fraud line immediately if money, cards, passwords, one-time codes, or identity details may have been exposed.'
    }
  };
  const rawDraft = draftLines.join('\n\n');
  const localizedDraft = await translateGeneratedCopy(getAnalysisLanguage(analysis), {
    draft: rawDraft,
    redFlags: [],
    recommendations: []
  });
  const draftText = options?.autoRedactPII
    ? redactDraftValue(localizedDraft.draft ?? rawDraft, redactionMode) ?? rawDraft
    : localizedDraft.draft ?? rawDraft;

  return {
    source: 'scamshield',
    summary: analysis.summary,
    draft: draftText,
    riskLevel: analysis.riskLevel,
    riskScore: analysis.riskScore,
    confidence: analysis.confidence,
    indicators: analysis.indicators,
    redFlags: analysis.redFlags,
    recommendations: analysis.recommendations,
    extractedEntities: analysis.extractedEntities,
    urlReputation,
    senderAnalysis,
    scamCategory: inferScamCategory(analysis),
    platform: inferPlatform(analysis),
    senderName:
      getEntityString(entities, 'possibleSender') ??
      getEntityString(entities, 'primaryUrlDomain') ??
      'Unknown sender',
    notes: options?.notes,
    autoRedactPII: options?.autoRedactPII ?? false,
    redactionMode,
    destinations: destinationDrafts,
    informationOnly: true,
    humanReviewRequired: true
  };
};

export const generateReportDraft = async (
  context: ScamShieldServiceContext,
  input: GenerateReportDraftInput
): Promise<ScamShieldAnalysisLike> => {
  const analysis = input.analysisId
    ? await getOwnedAnalysis(context.owner, input.analysisId)
    : normalizeAnalysisSnapshot((input.analysisSnapshot ?? {}) as Record<string, unknown>);
  const draftReport = await buildScamReportDraft(analysis, {
    notes: input.notes,
    autoRedactPII: input.autoRedactPII,
    redactionMode: input.redactionMode
  });
  analysis.draftReport = draftReport;

  if ('save' in analysis && typeof analysis.save === 'function') {
    await analysis.save();
  }

  await audit(
    context,
    SCAMSHIELD_ACTIONS.generateReportDraft,
    typeof analysis._id === 'object' && analysis._id ? analysis._id.toString() : undefined,
    {
      localOnly: !analysis._id
    }
  );

  return analysis;
};

export const submitScamReport = async (
  context: ScamShieldServiceContext,
  input: SubmitScamReportInput
): Promise<ScamShieldAnalysisLike> => {
  await assertShareConsent(context.owner, input.consentToShare);
  const analysis = input.analysisId
    ? await getOwnedAnalysis(context.owner, input.analysisId)
    : normalizeAnalysisSnapshot((input.analysisSnapshot ?? {}) as Record<string, unknown>);

  if (!analysis._id) {
    const storedAnalysis = await ScamShieldAnalysisModel.create({
      ...ownerFilter(context.owner),
      reportId: analysis.reportId,
      type: analysis.type,
      inputHash: analysis.inputHash,
      riskLevel: analysis.riskLevel,
      riskScore: analysis.riskScore,
      confidence: analysis.confidence,
      summary: analysis.summary,
      indicators: analysis.indicators,
      redFlags: analysis.redFlags,
      recommendations: analysis.recommendations,
      extractedEntities: analysis.extractedEntities,
      redactedContent: analysis.redactedContent,
      draftReport: analysis.draftReport,
      status: 'draft',
      metadata: {
        ...analysis.metadata,
        materializedFromLocalOnly: true
      }
    });

    analysis._id = storedAnalysis._id.toString();
  }

  analysis.status = 'submitted';
  analysis.submittedAt = new Date();
  analysis.metadata = {
    ...analysis.metadata,
    submissionDestination: input.destination,
    consentToShare: input.consentToShare
  };

  if (!analysis.draftReport) {
    analysis.draftReport = await buildScamReportDraft(analysis);
  }

  const deliveryExecution = input.consentToShare
    ? await executeScamShieldDestinationDelivery(context.owner, analysis, input.destination)
    : null;

  if (deliveryExecution) {
    analysis.metadata = {
      ...analysis.metadata,
      linkedReportId: deliveryExecution.reportId,
      deliveryStatus: deliveryExecution.deliveryResult.status,
      deliveryMode: deliveryExecution.deliveryResult.deliveryMode,
      deliveryConfigurationStatus: deliveryExecution.deliveryResult.deliveryConfigurationStatus,
      deliveryConfigurationIssues: deliveryExecution.deliveryResult.deliveryConfigurationIssues,
      deliveryActuallySent: deliveryExecution.deliveryResult.actuallySent,
      deliveryMessage: deliveryExecution.deliveryResult.message,
      deliveryArtifacts: deliveryExecution.deliveryResult.deliveryArtifacts ?? [],
      externalReference: deliveryExecution.deliveryResult.externalReference
    };
  }

  if ('save' in analysis && typeof analysis.save === 'function') {
    await analysis.save();
  } else if (analysis._id) {
    await ScamShieldAnalysisModel.updateOne(
      {
        _id: analysis._id,
        ...ownerFilter(context.owner)
      },
      {
        $set: {
          status: analysis.status,
          submittedAt: analysis.submittedAt,
          metadata: analysis.metadata,
          draftReport: analysis.draftReport
        }
      }
    );
  }

  await audit(context, SCAMSHIELD_ACTIONS.submit, String(analysis._id), {
    destination: input.destination,
    consentToShare: input.consentToShare,
    materializedFromLocalOnly: !input.analysisId
  });

  return analysis;
};
