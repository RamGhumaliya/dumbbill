import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  otpAuthUri,
  RECOVERY_CODE_COUNT,
  timeStep,
  totpAt,
  verifyTotp,
} from '../../src/modules/auth/domain/totp';

/**
 * The authenticator-app codes are checked against the OFFICIAL test values published in the standards
 * (RFC 4226 appendix D, RFC 6238 appendix B). If our maths matched those, it matches Google Authenticator,
 * Authy and the rest, which is the only thing that matters.
 */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_BASE32 = base32Encode(RFC_SECRET);

describe('HOTP (RFC 4226)', () => {
  it('produces the official test codes for counters 0 to 9', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });
});

describe('TOTP (RFC 6238)', () => {
  it('produces the official 8-digit test codes for the published moments', () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpAt(RFC_SECRET_BASE32, new Date(seconds * 1000), 8)).toBe(code);
    }
  });

  it('a code is the same for the whole 30-second step and changes after it', () => {
    const start = new Date(1_699_999_990_000); // a step starts at ...980 s, so this is 10 s into one
    expect(totpAt(RFC_SECRET_BASE32, new Date(start.getTime() + 15_000))).toBe(
      totpAt(RFC_SECRET_BASE32, start),
    );
    expect(totpAt(RFC_SECRET_BASE32, new Date(start.getTime() + 25_000))).not.toBe(
      totpAt(RFC_SECRET_BASE32, start),
    );
  });
});

describe('verifyTotp', () => {
  const now = new Date(1_700_000_000_000);
  const secret = generateTotpSecret();

  it('accepts the current code and returns its step', () => {
    expect(verifyTotp(secret, totpAt(secret, now), now, null)).toBe(timeStep(now));
  });

  it('forgives a phone clock one step ahead or behind, but not two', () => {
    const behind = new Date(now.getTime() - 30_000);
    const wayBehind = new Date(now.getTime() - 90_000);
    expect(verifyTotp(secret, totpAt(secret, behind), now, null)).toBe(timeStep(behind));
    expect(verifyTotp(secret, totpAt(secret, wayBehind), now, null)).toBeNull();
  });

  it('refuses a code that was already used (no replaying a code someone watched you type)', () => {
    const step = verifyTotp(secret, totpAt(secret, now), now, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now), now, step)).toBeNull();
  });

  it('refuses wrong, short, long and non-numeric codes', () => {
    for (const bad of ['000000', '12345', '1234567', 'abcdef', '12 456', '']) {
      expect(verifyTotp(secret, bad, now, null)).toBeNull();
    }
  });
});

describe('Base32', () => {
  it('round-trips random bytes and tolerates spaces, dashes and lower case when decoding', () => {
    const bytes = Buffer.from('dumbbill totp secret!');
    const text = base32Encode(bytes);
    expect(base32Decode(text).equals(bytes)).toBe(true);
    const spaced = text.toLowerCase().replace(/(.{4})/g, '$1 ');
    expect(base32Decode(spaced).equals(bytes)).toBe(true);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('NOT*BASE32')).toThrow();
  });

  it('matches the RFC 4648 example', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
});

describe('secrets and links', () => {
  it('generates a 160-bit secret that authenticator apps accept (32 Base32 characters)', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('builds the otpauth link with an escaped account name', () => {
    const uri = otpAuthUri('ABCDEFGH', 'ravi+shop@fitfuel.in', 'Dumbbill');
    expect(uri).toContain('otpauth://totp/Dumbbill%3Aravi%2Bshop%40fitfuel.in');
    expect(uri).toContain('secret=ABCDEFGH');
    expect(uri).toContain('issuer=Dumbbill');
  });
});

describe('recovery codes', () => {
  it('makes 8 distinct, readable codes without look-alike characters', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });

  it('hashes the same code the same way however it was typed', () => {
    expect(hashRecoveryCode('k7f2m-9qxpa')).toBe(hashRecoveryCode('K7F2M 9QXPA'));
    expect(hashRecoveryCode('K7F2M-9QXPA')).not.toBe(hashRecoveryCode('K7F2M-9QXPB'));
  });
});
