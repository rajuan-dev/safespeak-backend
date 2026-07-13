export const SOURCE_GROUNDED_TOPIC_PATTERN =
  /\b(?:acts?|regulations?|laws?|legal|rights|sections?|citations?|cite|sources?|reports?|reporting|complaints?|complain|agenc(?:y|ies)|ombudsman|commission|tribunal|court|police|privacy|anti-discrimination|discrimination|fair work|esafety|oaic|ahrc|scamwatch|legal aid|legislation|guidance|guideline|national code|higher education|provider|providers|student accommodation|affiliated environments|uploaded document|uploaded source)\b/i;

export const HIGH_IMPACT_LEGAL_PATTERN =
  /\b(?:sue|lawsuit|court|tribunal|police report|report to police|protective order|avo|ivo|dvo|visa|immigration|deport|deported|custody|child protection|evidence|recording|surveillance|litigation)\b/i;

export const LEGAL_OR_RIGHTS_TOPIC_PATTERN =
  /\b(?:legal|illegal|law|rights|case|legislation)\b/i;

export const REPORTING_PATHWAY_QUESTION_PATTERN =
  /\b(?:where can i report|reportcyber|scamwatch|esafety|fair work|anti discrimination|anti-discrimination|police report|what are my rights)\b/i;

export const AGENCY_QUESTION_PATTERN =
  /\b(?:which agency|what pathway|who do i report to|what are my reporting options|reporting options)\b/i;

export const LEGAL_ASSISTANCE_SERVICES_PATTERN =
  /\b(?:what|which|where|who)\b.*\b(?:legal assistance|legal aid|legal service|legal services|lawyer|lawyers|community legal centre|community legal centres|wdvcas|family violence prevention legal services)\b/i;

export const REPORTING_MENTION_PATTERNS = [
  /\bpolice\b/gi,
  /\breport(?:ing)?\b/gi,
  /\bagency\b/gi,
  /\b1800respect\b/gi,
  /\bfair work\b/gi,
  /\besafety\b/gi,
  /\boaic\b/gi
];

export const DOCUMENTATION_MENTION_PATTERNS = [
  /\bevidence\b/gi,
  /\bphoto(?:s)?\b/gi,
  /\bscreenshot(?:s)?\b/gi,
  /\btimeline\b/gi,
  /\bdocument(?:ation)?\b/gi,
  /\brecord\b/gi
];

export const LEGAL_MENTION_PATTERNS = [
  /\billegal\b/gi,
  /\blegal\b/gi,
  /\bsue\b/gi,
  /\bcase\b/gi,
  /\brights\b/gi,
  /\bassault\b/gi,
  /\bharassment\b/gi
];

export const ROUTE_OR_AGENCY_MENTION_PATTERNS = [
  /\bpolice\b/gi,
  /\breport(?:ing)?\b/gi,
  /\bagency\b/gi,
  /\bpathway\b/gi,
  /\boptions?\b/gi,
  /\bfair work\b/gi,
  /\besafety\b/gi,
  /\boaic\b/gi,
  /\bahrc\b/gi,
  /\banti-discrimination\b/gi
];
