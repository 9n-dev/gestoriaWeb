import ca from './ca.json';
import en from './en.json';
import es from './es.json';
import eu from './eu.json';
import gl from './gl.json';

/**
 * i18n skeleton (§6.12): Spanish is the only implemented language. The other dictionaries exist
 * and are empty, so every key falls back to Spanish until someone translates it. New UI copy
 * should go through `t()`; most of the existing copy is still inline (see tech debt).
 */
export const LOCALES = ['es', 'ca', 'gl', 'eu', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof es;

const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = { es, ca, gl, eu, en };

export const isLocale = (value: string | null | undefined): value is Locale =>
  LOCALES.includes(value as Locale);

export function t(
  key: MessageKey,
  locale: Locale = 'es',
  variables: Record<string, string | number> = {},
): string {
  const message = dictionaries[locale][key] ?? es[key];
  return message.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(variables[name] ?? ''));
}
