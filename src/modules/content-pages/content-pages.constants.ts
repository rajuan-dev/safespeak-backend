export const CONTENT_PAGE_KEYS = [
  'landing-page',
  'privacy-policy',
  'terms-conditions',
  'about-us'
] as const;

const DEFAULT_LEGAL_DOCUMENT = `Iacus nulla eu netus pretium. Pellentesque scelerisque tellus nisl eu nisl sed senectus nunc. Porta sollicitudin vel elit varius nulla sit diam sed. Bibendum elit facilisi nulla viverra augue pellentesque gravida morbi.

Diam pellentesque orci eget gravida cursus. Ut ut nulla sapien eget vitae at eget pretium. Tristique nibh ipsum iaculis quam. Vestibulum magna cursus facilisis adipiscing cras dui. Risus auctor faucibus orci tortor tristique elit. Sit tincidunt id felis malesuada placerat ultricies enim.

Purus ut congue ornare id sed. Enim libero tincidunt facilisis non facilisis mattis praesent. Magna volutpat at cras urna adipiscing vitae velit enim volutpat. Ac tincidunt et sed dolor ipsum. Purus nunc turpis scelerisque pellentesque lectus mauris imperdiet. Turpis orci consectetur enim posuere faucibus praesent.

Ut suscipit cursus id mauris. Accumsan egestas sit arcu sed. Feugiat tortor pharetra id ipsum elit diam viverra tortor. Mattis tincidunt eget ut nunc in. Mauris ipsum ut purus laoreet nisi eu viverra velit adipiscing. Diam sit cursus id semper sit. Urna morbi nisl est vel tincidunt.`;

const toEditorHtml = (content: string) =>
  content
    .split('\n\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join('');

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
    contentHtml: toEditorHtml(DEFAULT_LEGAL_DOCUMENT)
  },
  'terms-conditions': {
    contentHtml: toEditorHtml(DEFAULT_LEGAL_DOCUMENT)
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
  save: 'admin.content_page.save'
} as const;
