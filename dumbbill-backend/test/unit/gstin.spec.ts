import {
  checkGstin,
  gstinCheckCharacter,
  normaliseGstin,
} from '../../src/modules/business/domain/gstin';

/**
 * GSTIN rules protect businesses from typing mistakes in the number printed on every tax invoice. These tests pin the
 * behaviour a shopkeeper would notice: a correct number passes however it was typed, and a number with one wrong
 * character is caught.
 */

/** A real-format GSTIN with a correct check character (Maharashtra, PAN AAPFU0939F). */
const VALID = '27AAPFU0939F1ZV';

/** Build a GSTIN with the right check character from its first 14 characters. */
function withCheck(first14: string): string {
  return first14 + gstinCheckCharacter(first14);
}

describe('GSTIN check character', () => {
  it('matches the published example (27AAPFU0939F1ZV ends in V)', () => {
    expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V');
  });
});

describe('checkGstin', () => {
  it('accepts a correct GSTIN and reports its state and PAN', () => {
    expect(checkGstin(VALID)).toEqual({
      valid: true,
      gstin: VALID,
      stateCode: '27',
      pan: 'AAPFU0939F',
    });
  });

  it('accepts a number typed in lower case with spaces', () => {
    const result = checkGstin('27 aapfu 0939 f1zv ');
    expect(result.valid).toBe(true);
    expect(normaliseGstin('27 aapfu 0939 f1zv ')).toBe(VALID);
  });

  it('catches a single wrong character anywhere in the number', () => {
    for (let index = 0; index < 14; index += 1) {
      const original = VALID[index] as string;
      // Replace with another character of the same kind so the SHAPE stays valid and only the check fails.
      const replacement = /[0-9]/.test(original)
        ? original === '1'
          ? '2'
          : '1'
        : original === 'A'
          ? 'B'
          : 'A';
      const mistyped = VALID.slice(0, index) + replacement + VALID.slice(index + 1);
      const result = checkGstin(mistyped);
      // Position 12 (entity) and 13 (the letter Z) have their own shape rules, so they may fail on SHAPE instead.
      expect(result.valid).toBe(false);
    }
  });

  it('refuses a wrong length, a missing Z, and symbols as SHAPE problems', () => {
    expect(checkGstin(VALID.slice(0, 14))).toEqual({ valid: false, problem: 'SHAPE' });
    expect(checkGstin(VALID + '1')).toEqual({ valid: false, problem: 'SHAPE' });
    expect(checkGstin('27AAPFU0939F1AV')).toEqual({ valid: false, problem: 'SHAPE' });
    expect(checkGstin('27AAPFU0939F1Z-')).toEqual({ valid: false, problem: 'SHAPE' });
    expect(checkGstin('')).toEqual({ valid: false, problem: 'SHAPE' });
  });

  it('reports a right-looking number with the wrong last character as CHECKSUM', () => {
    expect(checkGstin('27AAPFU0939F1ZW')).toEqual({ valid: false, problem: 'CHECKSUM' });
  });

  it('works for other states and for entity letters', () => {
    expect(checkGstin(withCheck('29ABCDE1234F2Z')).valid).toBe(true);
    expect(checkGstin(withCheck('07ABCDE1234FAZ')).valid).toBe(true);
  });
});
