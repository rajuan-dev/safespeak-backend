export const sanitizeObject = <T extends Record<string, unknown>>(input: T): T => {
  const sanitizedEntries = Object.entries(input).filter(([key]) => !key.startsWith('$'));

  return Object.fromEntries(sanitizedEntries) as T;
};
