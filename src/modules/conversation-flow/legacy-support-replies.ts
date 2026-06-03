// Legacy test-only helper. Runtime assistant replies should use the SafeSpeak model path.
import {
  buildSafetySteps,
  evaluateSafetyOverride,
  shouldShowSources
} from './conversation-flow.service';

type LegacySupportResponseMode =
  | 'emergency_safety'
  | 'support_victim_style'
  | 'scamshield_style'
  | 'clarification_needed'
  | 'legal_lookup'
  | 'meta_feedback'
  | 'triage_handoff'
  | 'evidence_upload_intent';

type LegacySupportFacts = {
  immediate_danger?: boolean;
  threat_present?: boolean;
  blackmail_or_extortion?: boolean;
  image_based_abuse?: boolean;
  private_photos_or_messages?: boolean;
  personal_data_leak?: boolean;
  company_or_organisation_involved?: boolean;
  scam_or_fraud?: boolean;
  bank_details_exposed?: boolean;
  identity_documents_exposed?: boolean;
  employer_involved?: boolean;
  health_information?: boolean;
  racism_or_hate?: boolean;
  domestic_family_context?: boolean;
  coercive_control?: boolean;
  child_safety_risk?: boolean;
  sexual_violence_risk?: boolean;
  originalFacts?: {
    selfHarmOrSuicidal?: boolean;
  };
};

const getSupportedAssistantLanguage = (code?: string): string => {
  const normalized = (code ?? '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    zh: 'zh-Hans',
    'zh-cn': 'zh-Hans',
    'zh-sg': 'zh-Hans',
    'zh-hans': 'zh-Hans',
    yue: 'zh-Hant',
    'yue-hk': 'zh-Hant',
    'zh-hk': 'zh-Hant',
    'zh-tw': 'zh-Hant',
    'zh-hant': 'zh-Hant',
    'ar-sa': 'ar',
    'hi-in': 'hi',
    'bn-bd': 'bn',
    'es-es': 'es',
    'es-419': 'es',
    'es-mx': 'es'
  };
  const resolved = aliases[normalized] ?? normalized;
  const supported = new Set(['en', 'ar', 'hi', 'bn', 'zh-Hans', 'zh-Hant', 'es']);

  return supported.has(resolved) ? resolved : 'en';
};

const localizeLegacyText = (language: string, text: string): string => {
  const translations: Record<string, Record<string, string>> = {
    ar: {
      'Thank you for telling me about this.': 'شكرًا لإخبارك لي بهذا.',
      'You do not need to explain everything at once, and we can take it one step at a time.':
        'لا تحتاج إلى شرح كل شيء دفعة واحدة، ويمكننا التعامل مع الأمر خطوة بخطوة.',
      'I am sorry this happened to you.': 'أنا آسف لأن هذا حدث لك.',
      'What you described sounds really distressing, and you do not have to sort it all out at once.':
        'ما وصفته يبدو مؤلمًا جدًا، ولا يلزمك التعامل مع كل شيء دفعة واحدة.',
      'Your safety matters most right now, and it makes sense to focus on immediate support first.':
        'سلامتك هي الأهم الآن، ومن الطبيعي أن نركز أولًا على الدعم الفوري.',
      'What you described can be very serious, and your safety comes first.':
        'ما وصفته قد يكون خطيرًا جدًا، وسلامتك تأتي أولًا.',
      'Scams and identity risks can feel overwhelming, but there are practical steps we can take from here.':
        'قد تبدو عمليات الاحتيال ومخاطر الهوية مرهقة، لكن هناك خطوات عملية يمكن اتخاذها من هنا.',
      'Are they demanding money, contact, images, or something else?':
        'هل يطالبونك بالمال أو التواصل أو الصور أو بشيء آخر؟',
      'If it feels safe, save screenshots, links, usernames, and dates before anything is deleted':
        'إذا كان ذلك آمنًا، احتفظ بلقطات الشاشة والروابط وأسماء المستخدمين والتواريخ قبل حذف أي شيء.',
      'Avoid replying or negotiating if engaging with them could make things less safe':
        'تجنب الرد أو التفاوض إذا كان التواصل معهم قد يجعلك أقل أمانًا.',
      'Report the account, post, or content to the platform if you want the material reviewed or removed':
        'أبلغ المنصة عن الحساب أو المنشور أو المحتوى إذا أردت مراجعته أو إزالته.'
    },
    hi: {
      'Thank you for telling me about this.': 'यह बताने के लिए धन्यवाद।',
      'You do not need to explain everything at once, and we can take it one step at a time.':
        'आपको सब कुछ एक साथ समझाने की ज़रूरत नहीं है, हम एक-एक कदम चल सकते हैं।',
      'I am sorry this happened to you.': 'मुझे अफ़सोस है कि यह आपके साथ हुआ।',
      'Scams and identity risks can feel overwhelming, but there are practical steps we can take from here.':
        'धोखाधड़ी और पहचान से जुड़े जोखिम बहुत भारी लग सकते हैं, लेकिन यहाँ से कुछ व्यावहारिक कदम उठाए जा सकते हैं।',
      'Did they take money, or do they only have your details so far?':
        'क्या उन्होंने पैसे ले लिए, या अभी तक केवल आपकी जानकारी उनके पास है?',
      'We can focus on the scam, account, and identity-protection steps first.':
        'हम पहले धोखाधड़ी, खाते और पहचान-सुरक्षा के कदमों पर ध्यान दे सकते हैं।',
      'Contact your bank or card provider as soon as you can to secure the account and watch for suspicious activity':
        'अपने खाते को सुरक्षित करने और संदिग्ध गतिविधि देखने के लिए जल्द से जल्द बैंक या कार्ड प्रदाता से संपर्क करें।',
      'Change important passwords and turn on two-factor authentication where possible':
        'महत्वपूर्ण पासवर्ड बदलें और जहाँ संभव हो दो-स्तरीय प्रमाणीकरण चालू करें।'
    },
    bn: {
      'Thank you for telling me about this.': 'এটা জানানোয় ধন্যবাদ।',
      'You do not need to explain everything at once, and we can take it one step at a time.':
        'সবকিছু একসাথে বলতে হবে না, আমরা ধীরে ধীরে এগোতে পারি।',
      'I am sorry this happened to you.': 'এটা আপনার সঙ্গে ঘটেছে জেনে আমি দুঃখিত।',
      'Scams and identity risks can feel overwhelming, but there are practical steps we can take from here.':
        'প্রতারণা ও পরিচয়-ঝুঁকি খুবই চাপের মনে হতে পারে, কিন্তু এখান থেকে কিছু বাস্তব পদক্ষেপ নেওয়া যায়।',
      'Did they take money, or do they only have your details so far?':
        'তারা কি টাকা নিয়েছে, নাকি এখন পর্যন্ত শুধু আপনার তথ্যই পেয়েছে?',
      'We can focus on the scam, account, and identity-protection steps first.':
        'আমরা আগে প্রতারণা, অ্যাকাউন্ট এবং পরিচয় সুরক্ষার দিকগুলোতে মন দিতে পারি।',
      'Contact your bank or card provider as soon as you can to secure the account and watch for suspicious activity':
        'আপনার অ্যাকাউন্ট সুরক্ষিত করতে এবং সন্দেহজনক কার্যকলাপ নজরে রাখতে যত দ্রুত সম্ভব ব্যাংক বা কার্ড প্রদানকারীর সঙ্গে যোগাযোগ করুন।',
      'Change important passwords and turn on two-factor authentication where possible':
        'গুরুত্বপূর্ণ পাসওয়ার্ড বদলান এবং যেখানে সম্ভব দুই-ধাপ যাচাই চালু করুন।'
    },
    es: {
      'Thank you for telling me about this.': 'Gracias por contarme esto.',
      'You do not need to explain everything at once, and we can take it one step at a time.':
        'No tienes que explicarlo todo de una vez; podemos ir paso a paso.',
      'I am sorry this happened to you.': 'Siento que esto te haya pasado.',
      'What you described sounds really distressing, and you do not have to sort it all out at once.':
        'Lo que describes suena muy angustiante, y no tienes que resolverlo todo de una vez.',
      'If it feels safe, save screenshots, links, usernames, and dates before anything is deleted':
        'Si te parece seguro, guarda capturas, enlaces, nombres de usuario y fechas antes de que se borre algo.'
    }
  };

  return translations[language]?.[text] ?? text;
};

const localizeLegacyMessage = (language: string, message: string): string => {
  const localizedIntro: Record<string, string> = {
    ar: 'قد تساعدك هذه الخطوات العملية:',
    hi: 'ये व्यावहारिक कदम मदद कर सकते हैं:',
    bn: 'এই ব্যবহারিক পদক্ষেপগুলো সাহায্য করতে পারে:',
    es: 'Algunos pasos prácticos que pueden ayudar son:'
  };

  if (!localizedIntro[language]) {
    return message;
  }

  return message.replace('A few practical steps that may help are:', localizedIntro[language]);
};

const buildFollowUpQuestion = (facts: LegacySupportFacts): string => {
  if (
    facts.immediate_danger ||
    facts.originalFacts?.selfHarmOrSuicidal ||
    facts.child_safety_risk ||
    facts.sexual_violence_risk ||
    (facts.domestic_family_context && facts.coercive_control)
  ) {
    return 'Are you safe right now?';
  }

  if (facts.threat_present || facts.blackmail_or_extortion) {
    return 'Are they demanding money, contact, images, or something else?';
  }

  if (facts.scam_or_fraud || facts.bank_details_exposed) {
    return 'Did they take money, or do they only have your details so far?';
  }

  if (facts.personal_data_leak || facts.company_or_organisation_involved) {
    return 'What kind of details were leaked?';
  }

  if (facts.employer_involved && facts.health_information) {
    return 'Who was it shared with?';
  }

  if (facts.racism_or_hate) {
    return 'Did this happen in person, online, at work, school, or somewhere else?';
  }

  return 'What feels most important for me to understand next?';
};

const buildEmpathySentence = (
  responseMode: LegacySupportResponseMode,
  facts: LegacySupportFacts
): string => {
  if (responseMode === 'emergency_safety') {
    return 'I am really sorry you are dealing with this.';
  }

  if (facts.domestic_family_context || facts.coercive_control) {
    return 'I am sorry this is happening to you.';
  }

  if (facts.racism_or_hate) {
    return 'I am sorry you were treated that way.';
  }

  if (facts.scam_or_fraud || facts.bank_details_exposed || facts.identity_documents_exposed) {
    return 'I am sorry this happened to you.';
  }

  if (facts.employer_involved && facts.health_information) {
    return 'I am sorry your health information was shared like that.';
  }

  if (facts.image_based_abuse || facts.private_photos_or_messages) {
    return 'I am sorry this happened to you.';
  }

  return 'Thank you for telling me about this.';
};

const buildValidationSentence = (
  responseMode: LegacySupportResponseMode,
  facts: LegacySupportFacts
): string => {
  if (responseMode === 'emergency_safety') {
    return 'Your safety matters most right now, and it makes sense to focus on immediate support first.';
  }

  if (facts.domestic_family_context || facts.coercive_control) {
    return 'What you described can be very serious, and your safety comes first.';
  }

  if (facts.racism_or_hate) {
    return 'No one should be spoken to or treated like that.';
  }

  if (facts.scam_or_fraud || facts.bank_details_exposed || facts.identity_documents_exposed) {
    return 'Scams and identity risks can feel overwhelming, but there are practical steps we can take from here.';
  }

  if (facts.personal_data_leak || facts.company_or_organisation_involved) {
    return 'It is understandable to feel unsettled when private information may have been exposed.';
  }

  if (facts.employer_involved && facts.health_information) {
    return 'Health information is sensitive, so it is understandable to be upset by that.';
  }

  if (facts.image_based_abuse || facts.private_photos_or_messages || facts.threat_present) {
    return 'What you described sounds really distressing, and you do not have to sort it all out at once.';
  }

  return 'You do not need to explain everything at once, and we can take it one step at a time.';
};

export const buildSupportReply = (input: {
  facts: LegacySupportFacts;
  responseMode: LegacySupportResponseMode;
  sessionContext?: {
    selectedTopic?: string;
    language?: string;
  };
}) => {
  const language = getSupportedAssistantLanguage(input.sessionContext?.language);
  const safetyOverride = evaluateSafetyOverride(input.facts as any);
  const steps = buildSafetySteps(input.facts as any);
  const empathySentence = buildEmpathySentence(input.responseMode, input.facts);
  const validationSentence = buildValidationSentence(input.responseMode, input.facts);
  const nextQuestion =
    input.responseMode === 'clarification_needed'
      ? 'Can you tell me a bit more about what happened and what feels most urgent right now?'
      : buildFollowUpQuestion(input.facts);
  const practicalSentence =
    steps.length > 0
      ? `A few practical steps that may help are: ${steps
          .map((step, index) => `${index + 1}. ${localizeLegacyText(language, step)}`)
          .join(' ')}.`
      : '';
  const topicSentence =
    input.responseMode === 'scamshield_style' || input.sessionContext?.selectedTopic === 'scamshield'
      ? 'We can focus on the scam, account, and identity-protection steps first.'
      : '';
  const safetySentence =
    safetyOverride.safetyOverride
      ? safetyOverride.recommendedImmediateActions.slice(0, 2).join('. ') + '.'
      : '';
  const assistantMessage = localizeLegacyMessage(
    language,
    [
    localizeLegacyText(language, empathySentence),
    localizeLegacyText(language, validationSentence),
    localizeLegacyText(language, topicSentence),
    localizeLegacyText(language, safetySentence),
    practicalSentence
  ]
    .filter(Boolean)
    .join(' ')
  );

  return {
    assistantMessage,
    nextQuestion: localizeLegacyText(language, nextQuestion),
    readyForSubmission: false,
    confidence: input.responseMode === 'clarification_needed' ? 'low' : 'medium',
    disclaimer: 'This is information only, not legal advice.',
    citations: [],
    showSources: shouldShowSources(input.responseMode, '', []),
    sourceDisplayReason: 'hidden_support_reply',
    safetyOverride: safetyOverride.safetyOverride,
    safetyLevel: safetyOverride.safetyLevel,
    safetyReasons: safetyOverride.safetyReasons,
    recommendedImmediateActions: safetyOverride.recommendedImmediateActions,
    rag: {
      used: false,
      unavailable: false,
      resultCount: 0
    },
    reviewStatus: input.responseMode
  };
};
