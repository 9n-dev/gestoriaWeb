export type TaxIdResult =
  { valid: true; normalized: string; kind: 'NIF' | 'NIE' | 'CIF' } | { valid: false };

const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_CONTROL_LETTERS = 'JABCDEFGHI';
const CIF_DIGIT_ONLY = 'ABEH';
const CIF_LETTER_ONLY = 'PQRSNW';

const nifLetter = (digits: string) => NIF_LETTERS[Number(digits) % 23];

function cifControl(digits: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = Number(digits[i]);
    if (i % 2 === 1) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    }
  }
  return (10 - (sum % 10)) % 10;
}

/** Spanish NIF / NIE / CIF with control character check. Normalized form: uppercase, no separators. */
export function validateTaxId(raw: string): TaxIdResult {
  const id = raw.toUpperCase().replace(/[\s.\-]/g, '');

  if (/^\d{8}[A-Z]$/.test(id)) {
    return nifLetter(id.slice(0, 8)) === id[8]
      ? { valid: true, normalized: id, kind: 'NIF' }
      : { valid: false };
  }

  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const digits = 'XYZ'.indexOf(id[0]!) + id.slice(1, 8);
    return nifLetter(digits) === id[8]
      ? { valid: true, normalized: id, kind: 'NIE' }
      : { valid: false };
  }

  // K (minors), L (non-residents) and M (foreigners without NIE): the control letter is computed
  // over the seven digits, like a NIF whose first digit is the letter's place holder (0).
  if (/^[KLM]\d{7}[A-Z]$/.test(id)) {
    return nifLetter(id.slice(1, 8)) === id[8]
      ? { valid: true, normalized: id, kind: 'NIF' }
      : { valid: false };
  }

  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    const control = cifControl(id.slice(1, 8));
    const asDigit = String(control);
    const asLetter = CIF_CONTROL_LETTERS[control];
    const given = id[8];
    const ok = CIF_DIGIT_ONLY.includes(id[0]!)
      ? given === asDigit
      : CIF_LETTER_ONLY.includes(id[0]!)
        ? given === asLetter
        : given === asDigit || given === asLetter;
    return ok ? { valid: true, normalized: id, kind: 'CIF' } : { valid: false };
  }

  return { valid: false };
}
