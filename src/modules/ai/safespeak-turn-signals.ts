export type SafeSpeakProgressiveDisclosureStage =
  | 'first_response'
  | 'user_requests_options'
  | 'user_requests_documentation'
  | 'user_requests_reporting'
  | 'user_requests_legal_info'
  | 'report_building_mode';

const hasPattern = (value: string, pattern: RegExp): boolean => pattern.test(value);

export const detectProgressiveDisclosureStage = (
  message: string
): SafeSpeakProgressiveDisclosureStage => {
  if (
    hasPattern(
      message,
      /\b(report(ing)? options?|who do i report to|where can i report|which agency|police report)\b/i
    )
  ) {
    return 'user_requests_reporting';
  }

  if (
    hasPattern(
      message,
      /\b(how can i|how do i|help me|can you help me|please help me)\b.*\b(document|documentation|organi[sz]e|timeline|evidence|photos?|screenshots?|record)\b/i
    ) ||
    hasPattern(message, /\b(document it|organise it|organize it|help me document)\b/i)
  ) {
    return 'user_requests_documentation';
  }

  if (hasPattern(message, /\b(illegal|legal|law|sue|rights|case)\b/i)) {
    return 'user_requests_legal_info';
  }

  if (hasPattern(message, /\b(options?|what can i do|next steps?|what now)\b/i)) {
    return 'user_requests_options';
  }

  if (hasPattern(message, /\b(build|draft|prepare)\b.*\b(report|timeline|statement)\b/i)) {
    return 'report_building_mode';
  }

  return 'first_response';
};

export const detectUserRequestsDocumentation = (message: string): boolean =>
  hasPattern(
    message,
    /\b(how can i|how do i|help me|can you help me|please help me)\b.*\b(document|documentation|evidence|photos?|screenshots?|timeline|organi[sz]e)\b/i
  ) || hasPattern(message, /\b(document it|organise it|organize it|help me document)\b/i);

export const detectUserRequestsReporting = (message: string): boolean =>
  hasPattern(message, /\b(report|reporting|police|agency|where can i report|options)\b/i);

export const detectUserRequestsLegalInfo = (message: string): boolean =>
  hasPattern(message, /\b(legal|illegal|law|sue|rights|case)\b/i);

export const detectUserRequestsBulletFormat = (message: string): boolean =>
  hasPattern(message, /\b(bullet points?|red flags?|warning signs?)\b/i);

export const detectUserRequestsStepsFormat = (message: string): boolean =>
  hasPattern(message, /\b(steps?|organi[sz]e|document|timeline)\b/i);

export const detectUserAdmitsHarmingOthers = (message: string): boolean =>
  hasPattern(
    message,
    /\b(i|ive|i ve|i have|i had|i did)\b.*\b(abus(?:e|ed|ing)|hit|hurt|slapp(?:ed|ing)?|punch(?:ed|ing)?|kick(?:ed|ing)?|attack(?:ed|ing)?|assault(?:ed|ing)?|beat)\b.*\b(wife|husband|partner|boyfriend|girlfriend|child|kid|son|daughter|them|him|her)\b/i
  );
