export const SUPPORTED_LANGUAGES = ['en', 'ro'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
/** Served at the bare URL (`/about`); every other language lives under its own prefix (`/ro/about`). */
export const DEFAULT_LANGUAGE: Language = 'en';

/** The supported language a detected value (`en-US`, undefined, ...) stands for. */
export function toLanguage(value: string | undefined | null): Language {
  const base = value?.slice(0, 2);
  return isLanguage(base) ? base : DEFAULT_LANGUAGE;
}

export function isLanguage(value: string | undefined | null): value is Language {
  return SUPPORTED_LANGUAGES.some((l) => l === value);
}
