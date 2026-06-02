export const SUPPORTED_ASSISTANT_LANGUAGE_CODES = [
  'en',
  'ar',
  'hi',
  'bn',
  'zh-Hans',
  'zh-Hant',
  'vi',
  'pa',
  'ne',
  'el',
  'es'
] as const;

export type SupportedAssistantLanguageCode =
  (typeof SUPPORTED_ASSISTANT_LANGUAGE_CODES)[number];

export type AssistantLanguageRegistryEntry = {
  code: string;
  label: string;
  enabled: boolean;
  humanReviewed: boolean;
  family: 'mvp' | 'indigenous_future';
  notes?: string;
};

export const ASSISTANT_LANGUAGE_REGISTRY: AssistantLanguageRegistryEntry[] = [
  { code: 'en', label: 'English', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'ar', label: 'Arabic', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'hi', label: 'Hindi', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'bn', label: 'Bengali', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'zh-Hans', label: 'Mandarin Chinese (Simplified)', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'zh-Hant', label: 'Chinese (Traditional / Cantonese-compatible)', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'vi', label: 'Vietnamese', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'pa', label: 'Punjabi', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'ne', label: 'Nepali', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'el', label: 'Greek', enabled: true, humanReviewed: true, family: 'mvp' },
  { code: 'es', label: 'Spanish', enabled: true, humanReviewed: true, family: 'mvp' },
  {
    code: 'aus-kriol',
    label: 'Kriol',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  },
  {
    code: 'yolngu-matha',
    label: 'Yolŋu Matha',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  },
  {
    code: 'pitjantjatjara',
    label: 'Pitjantjatjara',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  },
  {
    code: 'warlpiri',
    label: 'Warlpiri',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  },
  {
    code: 'arrernte',
    label: 'Arrernte',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  },
  {
    code: 'tiwi',
    label: 'Tiwi',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  },
  {
    code: 'kala-lagaw-ya',
    label: 'Kala Lagaw Ya',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  },
  {
    code: 'yumplatok',
    label: 'Yumplatok / Torres Strait Creole',
    enabled: false,
    humanReviewed: false,
    family: 'indigenous_future',
    notes: 'Not enabled until human/community-reviewed translations and safety wording are available.'
  }
];

const SUPPORTED_ASSISTANT_LANGUAGE_SET = new Set<string>(SUPPORTED_ASSISTANT_LANGUAGE_CODES);
const ASSISTANT_LANGUAGE_ALIASES: Record<string, SupportedAssistantLanguageCode> = {
  en: 'en',
  'en-au': 'en',
  'en-us': 'en',
  ar: 'ar',
  'ar-sa': 'ar',
  hi: 'hi',
  'hi-in': 'hi',
  bn: 'bn',
  'bn-bd': 'bn',
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  yue: 'zh-Hant',
  'yue-hk': 'zh-Hant',
  vi: 'vi',
  'vi-vn': 'vi',
  pa: 'pa',
  'pa-in': 'pa',
  ne: 'ne',
  'ne-np': 'ne',
  el: 'el',
  'el-gr': 'el',
  es: 'es',
  'es-es': 'es',
  'es-419': 'es',
  'es-mx': 'es'
};

const TRADITIONAL_CHINESE_MARKERS =
  /[這個們會從後時嗎讓為點開關應還邊話萬與專業臺灣網裡請發現訊]|(?:佢|哋|喺|咩|冇|嘅|咗|係|唔)/u;
const ARABIC_SCRIPT_PATTERN = /[\u0600-\u06FF]/u;
const BENGALI_SCRIPT_PATTERN = /[\u0980-\u09FF]/u;
const GREEK_SCRIPT_PATTERN = /[\u0370-\u03FF]/u;
const GURMUKHI_SCRIPT_PATTERN = /[\u0A00-\u0A7F]/u;
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/u;
const HAN_PATTERN = /\p{Script=Han}/u;
const VIETNAMESE_MARKER_PATTERN =
  /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu;
const SPANISH_HINT_WORDS = ['alguien', 'amenaza', 'publicar', 'mensajes', 'privados', 'qué', 'significa', 'información', 'bajo', 'estafa'];
const HINDI_HINT_WORDS = ['है', 'मैं', 'मेरे', 'मुझे', 'क्या', 'और', 'किया', 'बैंक', 'पासपोर्ट'];
const NEPALI_HINT_WORDS = ['छ', 'छन्', 'छु', 'तपाईं', 'मलाई', 'मेरो', 'के', 'भयो', 'सहायता'];

const countWordHints = (text: string, words: string[]): number =>
  words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);

export const normalizeSupportedAssistantLanguage = (
  value?: string | null
): SupportedAssistantLanguageCode | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return undefined;
  }

  if (SUPPORTED_ASSISTANT_LANGUAGE_SET.has(trimmedValue)) {
    return trimmedValue as SupportedAssistantLanguageCode;
  }

  return ASSISTANT_LANGUAGE_ALIASES[trimmedValue.toLowerCase()];
};

export const getAssistantLanguagePromptLabel = (
  language: SupportedAssistantLanguageCode
): string => {
  switch (language) {
    case 'ar':
      return 'Arabic';
    case 'hi':
      return 'Hindi';
    case 'bn':
      return 'Bengali';
    case 'zh-Hans':
      return 'Simplified Chinese';
    case 'zh-Hant':
      return 'Traditional Chinese';
    case 'vi':
      return 'Vietnamese';
    case 'pa':
      return 'Punjabi';
    case 'ne':
      return 'Nepali';
    case 'el':
      return 'Greek';
    case 'es':
      return 'Spanish';
    case 'en':
    default:
      return 'English';
  }
};

export const detectAssistantLanguage = (
  message: string
): {
  code: SupportedAssistantLanguageCode;
  confidence: 'high' | 'medium' | 'low';
} => {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return { code: 'en', confidence: 'low' };
  }

  if (ARABIC_SCRIPT_PATTERN.test(trimmedMessage)) {
    return { code: 'ar', confidence: 'high' };
  }

  if (BENGALI_SCRIPT_PATTERN.test(trimmedMessage)) {
    return { code: 'bn', confidence: 'high' };
  }

  if (GREEK_SCRIPT_PATTERN.test(trimmedMessage)) {
    return { code: 'el', confidence: 'high' };
  }

  if (GURMUKHI_SCRIPT_PATTERN.test(trimmedMessage)) {
    return { code: 'pa', confidence: 'high' };
  }

  if (HAN_PATTERN.test(trimmedMessage)) {
    return {
      code: TRADITIONAL_CHINESE_MARKERS.test(trimmedMessage) ? 'zh-Hant' : 'zh-Hans',
      confidence: 'high'
    };
  }

  if (DEVANAGARI_PATTERN.test(trimmedMessage)) {
    return countWordHints(trimmedMessage, NEPALI_HINT_WORDS) >
      countWordHints(trimmedMessage, HINDI_HINT_WORDS)
      ? { code: 'ne', confidence: 'medium' }
      : { code: 'hi', confidence: 'medium' };
  }

  if (VIETNAMESE_MARKER_PATTERN.test(trimmedMessage)) {
    return { code: 'vi', confidence: 'medium' };
  }

  const normalizedLatinText = ` ${trimmedMessage.toLowerCase()} `;
  const spanishScore = SPANISH_HINT_WORDS.reduce(
    (total, word) => total + (normalizedLatinText.includes(` ${word} `) ? 1 : 0),
    0
  );

  if (spanishScore >= 2 || /[¿¡ñáéíóúü]/iu.test(trimmedMessage)) {
    return { code: 'es', confidence: spanishScore >= 2 ? 'medium' : 'low' };
  }

  return { code: 'en', confidence: 'low' };
};

export const resolveAssistantLanguage = (input: {
  message: string;
  requestedLanguage?: string;
}): SupportedAssistantLanguageCode => {
  const detection = detectAssistantLanguage(input.message);

  if (detection.confidence !== 'low') {
    return detection.code;
  }

  const normalizedRequestedLanguage = normalizeSupportedAssistantLanguage(input.requestedLanguage);

  if (normalizedRequestedLanguage && normalizedRequestedLanguage !== 'en') {
    return normalizedRequestedLanguage;
  }

  return 'en';
};
