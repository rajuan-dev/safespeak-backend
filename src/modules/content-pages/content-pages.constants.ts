export const CONTENT_PAGE_KEYS = [
  'landing-page',
  'privacy-policy',
  'terms-conditions',
  'about-us'
] as const;

export const LEGACY_LEGAL_DOCUMENT_MARKER = 'Iacus nulla eu netus pretium';

export const DEFAULT_PRIVACY_POLICY_HTML = [
  '<h2>SafeSpeak Privacy Policy</h2>',
  '<p>SafeSpeak collects only the information needed to provide secure reporting, support navigation, consent management, and account services.</p>',
  '<p>You can use SafeSpeak with an account or through supported anonymous sessions. Where anonymous use is available, personal identifying details are optional unless you choose to provide them.</p>',
  '<p>Reports, evidence metadata, consent records, support requests, and account details are handled with role-based access controls. Evidence files and sensitive metadata should be shared only when you intentionally choose to upload or submit them.</p>',
  '<p>SafeSpeak asks for explicit consent before cloud sync, AI processing, transcription, analytics use, warm referrals, or external agency sharing. You can review or withdraw consent where the product makes those controls available.</p>',
  '<p>You may request access, export, correction, or deletion of eligible personal information from the privacy controls in your account. Some records may need to be retained where safety, legal, audit, or operational obligations apply.</p>',
  '<p>This policy should be reviewed by the SafeSpeak legal or privacy owner before production release in each operating jurisdiction.</p>'
].join('');

export const DEFAULT_TERMS_CONDITIONS_HTML = [
  '<h2>SafeSpeak Terms of Use</h2>',
  '<p>SafeSpeak provides safety-aware reporting, evidence organization, support navigation, and information-only AI assistance. It is not an emergency service and does not replace legal, medical, counselling, or crisis advice.</p>',
  '<p>If you or someone else is in immediate danger, call 000 or your local emergency number. Use SafeSpeak only when it is safe for you to do so.</p>',
  '<p>You are responsible for the accuracy of information you choose to enter or submit. Review all AI-assisted drafts, summaries, and recommendations before saving or sharing them.</p>',
  '<p>Do not upload content you do not have permission to provide, and do not use SafeSpeak to threaten, harass, impersonate, exploit, or harm others.</p>',
  '<p>External report submission, warm referral, and agency sharing happen only through supported workflows and required consent. Some delivery channels may require manual review or partner configuration before a report is actually sent.</p>',
  '<p>Keep your account credentials private. If you believe your account has been compromised, reset your password and contact SafeSpeak support.</p>',
  '<p>These terms should be reviewed by the SafeSpeak legal owner before production release in each operating jurisdiction.</p>'
].join('');

export const DEFAULT_CONTENT_PAGES = {
  'landing-page': {
    heroHeadline: 'Speak safely, anytime.',
    subheading:
      'Secure communication for everyone. Private, encrypted, and designed for peace of mind.',
    primaryButtonLabel: 'Get Started',
    primaryButtonUrl: '/signup',
    secondaryButtonLabel: 'Learn More',
    secondaryButtonUrl: '/about',
    backgroundVisualsEnabled: true
  },
  'privacy-policy': {
    contentHtml: DEFAULT_PRIVACY_POLICY_HTML
  },
  'terms-conditions': {
    contentHtml: DEFAULT_TERMS_CONDITIONS_HTML
  },
  'about-us': {
    eyebrow: 'Basic Content Management',
    title: 'About SafeSpeak',
    body:
      'SafeSpeak is positioned as a culturally responsive, trauma-informed reporting and support platform. This admin surface manages the operational systems behind that promise: routing, intelligence, multilingual support, crisis response, and compliance oversight.',
    commitments: [
      'Trauma-informed reporting and support design for people experiencing racism, abuse, or online harm.',
      'Culturally responsive workflows that respect faith, language, and community context across Australia.',
      'Operational routing to police, legal aid, community services, and emergency pathways when needed.',
      'Privacy, evidence integrity, and compliance controls designed for sensitive victim data.'
    ]
  }
} as const;

export const CONTENT_PAGE_ACTIONS = {
  getPublic: 'content_page.get_public',
  getAdmin: 'admin.content_page.get',
  save: 'admin.content_page.save_draft',
  publish: 'admin.content_page.publish'
} as const;
