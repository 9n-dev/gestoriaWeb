import { describe, expect, it } from 'vitest';
import { LOCALES, t } from './index';

describe('i18n', () => {
  it('falls back to Spanish for every locale without a translation', () => {
    for (const locale of LOCALES) expect(t('common.logout', locale)).toBe('Cerrar sesión');
  });
  it('interpolates variables', () => {
    expect(t('common.notificationsUnread', 'ca', { count: 3 })).toBe('Notificaciones: 3 sin leer');
  });
});
