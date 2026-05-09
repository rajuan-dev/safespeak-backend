export const sanitizeObject = <T extends Record<string, unknown>>(input: T): T => {
  const sanitizedEntries = Object.entries(input).filter(([key]) => !key.startsWith('$'));

  return Object.fromEntries(sanitizedEntries) as T;
};

const sensitiveKeyPattern =
  /password|token|accesstoken|refreshtoken|authorization|cookie|otp|secret/i;

export const redactSensitive = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]' as T;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const items = value as unknown[];

    return items.map((item) => redactSensitive(item, seen)) as T;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
    key,
    sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactSensitive(entryValue, seen)
  ]);

  return Object.fromEntries(entries) as T;
};

export const truncateForLog = <T>(value: T, maxLength = 10_000): T | string => {
  const serialized = JSON.stringify(value);

  if (!serialized || serialized.length <= maxLength) {
    return value;
  }

  return `${serialized.slice(0, maxLength)}...[TRUNCATED]`;
};
