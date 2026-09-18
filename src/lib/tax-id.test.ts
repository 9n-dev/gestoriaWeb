import { describe, expect, it } from 'vitest';
import { validateTaxId } from './tax-id';

const valid = (raw: string) => validateTaxId(raw);

describe('validateTaxId', () => {
  it('accepts NIFs with the right control letter', () => {
    expect(valid('12345678Z')).toEqual({ valid: true, normalized: '12345678Z', kind: 'NIF' });
    expect(valid('00000000T')).toMatchObject({ valid: true });
  });

  it('normalizes case, spaces, dots and dashes', () => {
    expect(valid(' 12.345.678-z ')).toEqual({ valid: true, normalized: '12345678Z', kind: 'NIF' });
    expect(valid('b-12345674')).toMatchObject({ normalized: 'B12345674' });
  });

  it('rejects NIFs with the wrong control letter', () => {
    expect(valid('12345678A')).toEqual({ valid: false });
    expect(valid('1234567Z')).toEqual({ valid: false });
  });

  it('validates NIEs (X, Y, Z prefixes)', () => {
    expect(valid('X1234567L')).toEqual({ valid: true, normalized: 'X1234567L', kind: 'NIE' });
    expect(valid('Y1234567X')).toMatchObject({ valid: true, kind: 'NIE' });
    expect(valid('Z1234567R')).toMatchObject({ valid: true, kind: 'NIE' });
    expect(valid('X1234567A')).toEqual({ valid: false });
  });

  it('validates CIFs with digit control (A, B, E, H)', () => {
    expect(valid('B12345674')).toEqual({ valid: true, normalized: 'B12345674', kind: 'CIF' });
    expect(valid('A58818501')).toMatchObject({ valid: true });
    expect(valid('B12345675')).toEqual({ valid: false });
    // Digit-control entities do not accept the letter form.
    expect(valid('B1234567D')).toEqual({ valid: false });
  });

  it('validates CIFs with letter control (P, Q, R, S, N, W)', () => {
    expect(valid('Q2826000H')).toEqual({ valid: true, normalized: 'Q2826000H', kind: 'CIF' });
    expect(valid('P1234567D')).toMatchObject({ valid: true });
    expect(valid('P12345674')).toEqual({ valid: false });
  });

  it('accepts either control form for the remaining entity letters', () => {
    expect(valid('G12345674')).toMatchObject({ valid: true });
    expect(valid('G1234567D')).toMatchObject({ valid: true });
    expect(valid('G1234567E')).toEqual({ valid: false });
  });

  it('rejects garbage', () => {
    for (const raw of ['', 'ABC', '123456789', 'I12345674', 'B1234567', '12345678ZZ']) {
      expect(valid(raw), raw).toEqual({ valid: false });
    }
  });
});
