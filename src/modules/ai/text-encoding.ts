const MOJIBAKE_PATTERNS = [
  /αª/u,
  /à¦/u,
  /à§/u,
  /ΓÇ/u,
  /�{2,}/u
];

export const hasBrokenTextEncoding = (value: string): boolean =>
  MOJIBAKE_PATTERNS.some((pattern) => pattern.test(value));

export const escapeUnicodeForLog = (value: string): string =>
  value.replace(/[^\u0020-\u007e]/gu, (character) =>
    Array.from(character)
      .map((symbol) =>
        `\\u${symbol.codePointAt(0)?.toString(16).padStart(4, '0') ?? 'fffd'}`
      )
      .join('')
  );
