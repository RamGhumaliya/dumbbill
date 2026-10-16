import {
  findLeakedSecrets,
  isSecretKey,
  REDACTED,
  scrub,
} from '../../src/common/logging/redaction';

/**
 * Logs are copied to other systems and read by many people, so secrets must never be in them.
 * These tests protect the rules in src/common/logging/redaction.ts.
 */
describe('log redaction', () => {
  it('replaces secret fields, at any depth, and leaves ordinary fields alone', () => {
    const cleaned = scrub({
      route: '/v1/login',
      body: {
        email: 'owner@shop.test',
        password: 'hunter2',
        nested: { refreshToken: 'abc', items: [{ pin: '1234', qty: 2 }] },
      },
    }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    expect(cleaned.route).toBe('/v1/login');
    expect(cleaned.body.password).toBe(REDACTED);
    expect(cleaned.body.nested.refreshToken).toBe(REDACTED);
    expect(cleaned.body.nested.items[0].pin).toBe(REDACTED);
    expect(cleaned.body.nested.items[0].qty).toBe(2);
  });

  it.each([
    // credentials and sessions
    ['password'],
    ['passwordHash'],
    ['password_hash'],
    ['accessToken'],
    ['refresh-token'],
    ['csrfToken'],
    ['authorization'],
    ['cookie'],
    ['pin'],
    ['otp'],
    ['clientSecret'],
    ['dbPassword'],
    // cashiers must never see these, so logs must not carry them
    ['unitCost'],
    ['purchaseCost'],
    ['wac'],
    ['costAtSale'],
    ['cogs'],
    ['profit'],
    ['grossProfit'],
    ['margin'],
  ])('treats "%s" as secret', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each([['name'], ['quantity'], ['price'], ['invoiceNumber'], ['requestId'], ['status']])(
    'does not treat "%s" as secret',
    (key) => {
      expect(isSecretKey(key)).toBe(false);
    },
  );

  it('shortens email and phone instead of writing them in full', () => {
    const cleaned = scrub({
      email: 'ramesh@example.com',
      phone: '9876543210',
      mobile: '12',
    }) as Record<string, string>;
    expect(cleaned.email).toBe('r***@example.com');
    expect(cleaned.phone).toBe('******3210');
    expect(cleaned.mobile).toBe(REDACTED); // too short to show any part
  });

  it('does not change the original object', () => {
    const original = { password: 'hunter2' };
    scrub(original);
    expect(original.password).toBe('hunter2');
  });

  it('leaves class instances such as requests and errors untouched (serializers handle those)', () => {
    const error = new Error('boom');
    const cleaned = scrub({ err: error }) as { err: unknown };
    expect(cleaned.err).toBe(error);
  });

  it('copes with circular structures without hanging', () => {
    const loop: Record<string, unknown> = { name: 'a' };
    loop.self = loop;
    expect(() => scrub(loop)).not.toThrow();
  });

  describe('findLeakedSecrets (used to check saved log lines)', () => {
    it('reports secret fields that still hold a real value, with their path', () => {
      expect(
        findLeakedSecrets({
          ok: 1,
          req: { body: { password: 'hunter2' } },
          list: [{ unitCost: 500 }],
        }),
      ).toEqual(['req.body.password', 'list[0].unitCost']);
    });

    it('reports nothing when every secret is already redacted', () => {
      expect(findLeakedSecrets({ password: REDACTED, nested: { token: REDACTED } })).toEqual([]);
    });
  });
});
