import { totpAt } from '../../src/modules/auth/domain/totp';
import {
  AuthTestApp,
  createAuthTestApp,
  STRONG_PASSWORD,
  tokenFromEmail,
} from '../support/auth-test-app';

/**
 * End-to-end tests of sign-up, sign-in and account security against the REAL application and a real
 * PostgreSQL database with row-level security. They check behaviour a customer (or an attacker) could
 * observe, not implementation details.
 */
let t: AuthTestApp;
let emailCounter = 0;

beforeAll(async () => {
  t = await createAuthTestApp();
});

afterAll(async () => {
  await t.close();
});

/** A new, unique email address for each test, so tests never affect each other's lockouts or limits. */
function newEmail(label = 'owner'): string {
  return `${label}.${++emailCounter}@fitfuel.test`;
}

/** The Set-Cookie header lines of a response, whether the library gives one string or a list. */
function setCookieLines(res: { headers: Record<string, unknown> }): string[] {
  const value = res.headers['set-cookie'];
  return Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : [];
}

interface Account {
  email: string;
  password: string;
  tenantId: string;
  userId: string;
}

/** Sign up and verify the email, like a real owner would. */
async function registerVerified(
  options: { email?: string; password?: string; business?: string } = {},
): Promise<Account> {
  const email = options.email ?? newEmail();
  const password = options.password ?? STRONG_PASSWORD;
  const signup = await t
    .http()
    .post('/v1/auth/signup')
    .set('X-Forwarded-For', t.freshIp())
    .send({
      businessName: options.business ?? 'FitFuel Nutrition',
      ownerName: 'Ravi Mehta',
      email,
      password,
    });
  expect(signup.status).toBe(202);
  const token = tokenFromEmail(t.mailer.lastTo(email)!.text);
  const verify = await t
    .http()
    .post('/v1/auth/verify-email')
    .set('X-Forwarded-For', t.freshIp())
    .send({ token });
  expect(verify.status).toBe(204);
  const user = await t.db.owner.user.findUniqueOrThrow({ where: { email } });
  return { email, password, tenantId: user.tenantId, userId: user.id };
}

/** Sign in from a mobile client (refresh token in the body). */
function loginMobile(
  email: string,
  password: string,
  extra: Record<string, unknown> = {},
  ip = t.freshIp(),
) {
  return t
    .http()
    .post('/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password, clientType: 'MOBILE', ...extra });
}

function refresh(refreshToken: string, ip = t.freshIp()) {
  return t.http().post('/v1/auth/refresh').set('X-Forwarded-For', ip).send({ refreshToken });
}

function me(accessToken: string) {
  return t.http().get('/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
}

/** Sign in and return the tokens. */
async function signedIn(account: Account): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await loginMobile(account.email, account.password);
  expect(res.status).toBe(200);
  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

describe('sign-up', () => {
  it('creates a business with a 14-day trial and an owner, and emails one verification link', async () => {
    const email = newEmail();
    const res = await t
      .http()
      .post('/v1/auth/signup')
      .set('X-Forwarded-For', t.freshIp())
      .send({
        businessName: '  FitFuel Nutrition  ',
        ownerName: 'Ravi Mehta',
        email: `  ${email.toUpperCase()}  `,
        password: STRONG_PASSWORD,
      });
    expect(res.status).toBe(202);
    expect(res.body.message).toMatch(/message is on its way/);

    const user = await t.db.owner.user.findUniqueOrThrow({
      where: { email },
      include: { tenant: { include: { plan: true } } },
    });
    expect(user.isOwner).toBe(true);
    expect(user.status).toBe('ACTIVE');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.tenant.name).toBe('FitFuel Nutrition'); // trimmed
    expect(user.tenant.status).toBe('TRIAL');
    expect(user.tenant.plan?.code).toBe('STARTER');
    const trialDays = (user.tenant.trialEndsAt!.getTime() - t.clock.now().getTime()) / 86_400_000;
    expect(trialDays).toBeGreaterThan(13.9);
    expect(trialDays).toBeLessThan(14.1);

    const sent = t.mailer.outbox.filter((m) => m.to === email);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('https://app.example.test/verify-email?token=');
  });

  it('never stores the password: only a peppered Argon2id hash', async () => {
    const account = await registerVerified();
    const user = await t.db.owner.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(user.passwordHash).toMatch(/^v1:\$argon2id\$/);
    expect(user.passwordHash).not.toContain(account.password);
  });

  it('answers the same whether or not the email already has an account, and warns the real owner', async () => {
    const account = await registerVerified();
    const first = await t.http().post('/v1/auth/signup').set('X-Forwarded-For', t.freshIp()).send({
      businessName: 'Someone Else',
      ownerName: 'Intruder',
      email: account.email,
      password: STRONG_PASSWORD,
    });
    const fresh = await t.http().post('/v1/auth/signup').set('X-Forwarded-For', t.freshIp()).send({
      businessName: 'Brand New',
      ownerName: 'Newcomer',
      email: newEmail(),
      password: STRONG_PASSWORD,
    });
    expect(first.status).toBe(fresh.status);
    expect(first.body).toEqual(fresh.body);

    // No second business was created, and the real owner was told someone tried.
    expect(await t.db.owner.tenant.count({ where: { name: 'Someone Else' } })).toBe(0);
    expect(t.mailer.lastTo(account.email)!.subject).toMatch(/already have/i);
  });

  it('rejects weak passwords with the reasons, and creates nothing', async () => {
    const email = newEmail();
    const res = await t
      .http()
      .post('/v1/auth/signup')
      .set('X-Forwarded-For', t.freshIp())
      .send({ businessName: 'Weak Co', ownerName: 'Ravi Mehta', email, password: 'short' });
    expect(res.status).toBe(422);
    expect(res.type).toBe('application/problem+json');
    expect(res.body.code).toBe('WEAK_PASSWORD');
    expect(res.body.errors[0]).toMatchObject({ field: 'password' });
    expect(await t.db.owner.user.count({ where: { email } })).toBe(0);
  });

  it('rejects a password found in a data breach', async () => {
    t.breached.add('this one was leaked 2019');
    const res = await t.http().post('/v1/auth/signup').set('X-Forwarded-For', t.freshIp()).send({
      businessName: 'Leaky Co',
      ownerName: 'Ravi Mehta',
      email: newEmail(),
      password: 'this one was leaked 2019',
    });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].message).toMatch(/data breach/);
  });

  it('refuses fields it does not know, such as an attempt to pick the business id or role', async () => {
    const res = await t.http().post('/v1/auth/signup').set('X-Forwarded-For', t.freshIp()).send({
      businessName: 'X Co',
      ownerName: 'Ravi',
      email: newEmail(),
      password: STRONG_PASSWORD,
      tenantId: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
      isOwner: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('is limited to 5 sign-ups per hour from one address', async () => {
    const ip = t.freshIp();
    const attempt = () =>
      t.http().post('/v1/auth/signup').set('X-Forwarded-For', ip).send({
        businessName: 'Spam Co',
        ownerName: 'Spammer',
        email: newEmail(),
        password: STRONG_PASSWORD,
      });
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(202);
    const sixth = await attempt();
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('email verification', () => {
  it('blocks sign-in until the email is verified, then allows it', async () => {
    const email = newEmail();
    await t.http().post('/v1/auth/signup').set('X-Forwarded-For', t.freshIp()).send({
      businessName: 'Verify Co',
      ownerName: 'Ravi Mehta',
      email,
      password: STRONG_PASSWORD,
    });
    const blocked = await loginMobile(email, STRONG_PASSWORD);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

    await t
      .http()
      .post('/v1/auth/verify-email')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token: tokenFromEmail(t.mailer.lastTo(email)!.text) });
    expect((await loginMobile(email, STRONG_PASSWORD)).status).toBe(200);
  });

  it('a link works once', async () => {
    const email = newEmail();
    await t
      .http()
      .post('/v1/auth/signup')
      .set('X-Forwarded-For', t.freshIp())
      .send({ businessName: 'Once Co', ownerName: 'Ravi Mehta', email, password: STRONG_PASSWORD });
    const token = tokenFromEmail(t.mailer.lastTo(email)!.text);
    expect(
      (
        await t
          .http()
          .post('/v1/auth/verify-email')
          .set('X-Forwarded-For', t.freshIp())
          .send({ token })
      ).status,
    ).toBe(204);
    const again = await t
      .http()
      .post('/v1/auth/verify-email')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('INVALID_TOKEN');
  });

  it('a link expires after 24 hours', async () => {
    const email = newEmail();
    await t
      .http()
      .post('/v1/auth/signup')
      .set('X-Forwarded-For', t.freshIp())
      .send({ businessName: 'Late Co', ownerName: 'Ravi Mehta', email, password: STRONG_PASSWORD });
    const token = tokenFromEmail(t.mailer.lastTo(email)!.text);
    t.clock.advanceSeconds(24 * 3600 - 60);
    // (Just inside the window it would still work; we test just outside, using a copy so the test stays independent.)
    t.clock.advanceSeconds(120);
    const res = await t
      .http()
      .post('/v1/auth/verify-email')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token });
    expect(res.body.code).toBe('INVALID_TOKEN');
    expect(res.status).toBe(400);
  });

  it('rejects made-up, truncated and cross-business tokens the same way', async () => {
    const account = await registerVerified();
    for (const token of [
      '',
      'garbage',
      `${account.tenantId}.${'A'.repeat(43)}`,
      `${account.tenantId}.short`,
    ]) {
      const res = await t
        .http()
        .post('/v1/auth/verify-email')
        .set('X-Forwarded-For', t.freshIp())
        .send({ token });
      expect([400]).toContain(res.status);
      expect(['INVALID_TOKEN', 'VALIDATION_FAILED']).toContain(res.body.code);
    }
  });

  it('resending makes the older link stop working', async () => {
    const email = newEmail();
    await t.http().post('/v1/auth/signup').set('X-Forwarded-For', t.freshIp()).send({
      businessName: 'Resend Co',
      ownerName: 'Ravi Mehta',
      email,
      password: STRONG_PASSWORD,
    });
    const oldToken = tokenFromEmail(t.mailer.lastTo(email)!.text);
    const resend = await t
      .http()
      .post('/v1/auth/resend-verification')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email });
    expect(resend.status).toBe(202);
    const newToken = tokenFromEmail(t.mailer.lastTo(email)!.text);
    expect(newToken).not.toBe(oldToken);
    expect(
      (
        await t
          .http()
          .post('/v1/auth/verify-email')
          .set('X-Forwarded-For', t.freshIp())
          .send({ token: oldToken })
      ).status,
    ).toBe(400);
    expect(
      (
        await t
          .http()
          .post('/v1/auth/verify-email')
          .set('X-Forwarded-For', t.freshIp())
          .send({ token: newToken })
      ).status,
    ).toBe(204);
  });

  it('resend answers identically for unknown emails and sends nothing; it is limited to 3 per hour', async () => {
    const unknown = newEmail('ghost');
    const before = t.mailer.outbox.length;
    const res = await t
      .http()
      .post('/v1/auth/resend-verification')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: unknown });
    expect(res.status).toBe(202);
    expect(res.body.message).toMatch(/message is on its way/);
    expect(t.mailer.outbox.length).toBe(before);

    for (let i = 0; i < 2; i++)
      await t
        .http()
        .post('/v1/auth/resend-verification')
        .set('X-Forwarded-For', t.freshIp())
        .send({ email: unknown });
    const fourth = await t
      .http()
      .post('/v1/auth/resend-verification')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: unknown });
    expect(fourth.status).toBe(429);
  });
});

describe('sign-in', () => {
  it('returns an access token, the user and the business, and never any secret', async () => {
    const account = await registerVerified({ business: 'Gym Gear Co' });
    const res = await loginMobile(account.email, account.password);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresInSeconds: 900,
      user: { email: account.email, fullName: 'Ravi Mehta', isOwner: true, totpEnabled: false },
      tenant: { name: 'Gym Gear Co', status: 'TRIAL' },
    });
    expect(res.body.refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|password_hash|argon2|totp_secret|totpSecret|tokenHash/i);
  });

  it('gives the SAME answer for a wrong password and an unknown email (no account hunting)', async () => {
    const account = await registerVerified();
    const wrongPassword = await loginMobile(account.email, 'wrong password entirely');
    const unknownEmail = await loginMobile(newEmail('nobody'), 'wrong password entirely');
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    for (const field of ['status', 'code', 'title', 'detail', 'type']) {
      expect(wrongPassword.body[field]).toEqual(unknownEmail.body[field]);
    }
    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('treats the email case-insensitively', async () => {
    const account = await registerVerified();
    expect((await loginMobile(account.email.toUpperCase(), account.password)).status).toBe(200);
  });

  it('refuses an account an administrator has disabled, with the same generic answer', async () => {
    const account = await registerVerified();
    await t.db.owner.user.update({ where: { id: account.userId }, data: { status: 'DISABLED' } });
    const res = await loginMobile(account.email, account.password);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires the client type and rejects unknown fields', async () => {
    const account = await registerVerified();
    const noType = await t
      .http()
      .post('/v1/auth/login')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email, password: account.password });
    expect(noType.status).toBe(400);
    const extra = await loginMobile(account.email, account.password, { role: 'admin' });
    expect(extra.status).toBe(400);
  });

  it('locks the account after 5 wrong passwords (even for the right one), then unlocks with time', async () => {
    const account = await registerVerified();
    for (let i = 0; i < 5; i++) {
      expect((await loginMobile(account.email, 'definitely wrong password')).status).toBe(401);
    }
    const locked = await loginMobile(account.email, account.password); // the RIGHT password, still refused
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('RATE_LIMITED');
    expect(locked.headers['retry-after']).toBe('60');

    t.clock.advanceSeconds(61);
    expect((await loginMobile(account.email, account.password)).status).toBe(200);
  });

  it('a lockout from different addresses still applies (it follows the account, not the visitor)', async () => {
    const account = await registerVerified();
    for (let i = 0; i < 5; i++)
      await loginMobile(account.email, 'nope nope nope nope', {}, t.freshIp());
    expect((await loginMobile(account.email, account.password, {}, t.freshIp())).status).toBe(429);
  });

  it('limits one address to 30 attempts per minute', async () => {
    const ip = t.freshIp();
    let refused = 0;
    for (let i = 0; i < 32; i++) {
      const res = await loginMobile(newEmail('flood'), 'whatever password', {}, ip);
      if (res.status === 429) refused++;
    }
    expect(refused).toBeGreaterThanOrEqual(2);
  });
});

describe('protected routes and access tokens', () => {
  it('refuses requests without a token with the standard error body', async () => {
    const res = await t.http().get('/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.type).toBe('application/problem+json');
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(res.body.requestId).toBeTruthy();
  });

  it('refuses garbage and wrongly signed tokens', async () => {
    for (const token of ['garbage', 'a.b.c', 'null', '']) {
      expect((await me(token)).status).toBe(401);
    }
  });

  it('accepts a valid token and shows the right person', async () => {
    const account = await registerVerified();
    const { accessToken } = await signedIn(account);
    const res = await me(accessToken);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(account.email);
  });

  it('a token stops working after 15 minutes', async () => {
    const account = await registerVerified();
    const { accessToken } = await signedIn(account);
    t.clock.advanceSeconds(14 * 60);
    expect((await me(accessToken)).status).toBe(200);
    t.clock.advanceSeconds(2 * 60);
    expect((await me(accessToken)).status).toBe(401);
  });

  it('health checks stay public', async () => {
    expect((await t.http().get('/healthz')).status).toBe(200);
    expect((await t.http().get('/readyz')).status).toBe(200);
  });
});

describe('refresh tokens', () => {
  it('each refresh token works once and is replaced by a new one', async () => {
    const account = await registerVerified();
    const first = await signedIn(account);
    const res = await refresh(first.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect((await me(res.body.accessToken)).status).toBe(200);
  });

  it('a stolen (already used) token ends the whole session, including its access tokens', async () => {
    const account = await registerVerified();
    const original = await signedIn(account);
    const rotated = await refresh(original.refreshToken); // the real owner's refresh
    expect(rotated.status).toBe(200);

    t.clock.advanceSeconds(60); // beyond the 10-second double-click allowance
    const thief = await refresh(original.refreshToken); // the thief replays the old token
    expect(thief.status).toBe(401);
    expect(thief.body.code).toBe('INVALID_REFRESH_TOKEN');

    // The owner's NEWER token is dead too: the session was ended, because nobody can tell thief from owner.
    expect((await refresh(rotated.body.refreshToken)).status).toBe(401);
    // And the access token that was issued before the theft stops working at once, not after 15 minutes.
    expect((await me(rotated.body.accessToken)).status).toBe(401);

    const session = await t.db.owner.session.findFirstOrThrow({
      where: { userId: account.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(session.revokedReason).toBe('TOKEN_REUSE');
    const audit = await t.db.owner.auditLog.findFirst({
      where: { tenantId: account.tenantId, action: 'auth.refresh_token_reuse' },
    });
    expect(audit).not.toBeNull();
  });

  it('two tabs refreshing at the same moment do not log the person out', async () => {
    const account = await registerVerified();
    const { refreshToken } = await signedIn(account);
    const [a, b] = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Exactly one of them received the next refresh token; the other only got an access token.
    const issued = [a, b].filter((r) => r.body.refreshToken);
    expect(issued).toHaveLength(1);
    // ...and the session is still alive with that token.
    expect((await refresh(issued[0]!.body.refreshToken)).status).toBe(200);
  });

  it('a refresh token expires after 30 days', async () => {
    const account = await registerVerified();
    const { refreshToken } = await signedIn(account);
    t.clock.advanceSeconds(31 * 24 * 3600);
    expect((await refresh(refreshToken)).status).toBe(401);
  });

  it('is stored only as a hash, so a database leak does not leak sessions', async () => {
    const account = await registerVerified();
    const { refreshToken } = await signedIn(account);
    const secret = refreshToken.split('.')[1]!;
    const rows = await t.db.owner.refreshToken.findMany({ where: { tenantId: account.tenantId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.tokenHash).not.toContain(secret);
    }
  });

  it('a token cannot be moved to another business', async () => {
    const owner = await registerVerified();
    const other = await registerVerified();
    const { refreshToken } = await signedIn(owner);
    const secret = refreshToken.split('.')[1]!;
    const res = await refresh(`${other.tenantId}.${secret}`);
    expect(res.status).toBe(401);
    expect((await refresh(refreshToken)).status).toBe(200); // the real one is unaffected
  });

  it('a disabled user can no longer renew a session', async () => {
    const account = await registerVerified();
    const { refreshToken } = await signedIn(account);
    await t.db.owner.user.update({ where: { id: account.userId }, data: { status: 'DISABLED' } });
    expect((await refresh(refreshToken)).status).toBe(401);
  });

  it('refresh without any token is a clear 401', async () => {
    const res = await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('sign-out and devices', () => {
  it('logout ends the session at once: refresh and access token both stop', async () => {
    const account = await registerVerified();
    const { accessToken, refreshToken } = await signedIn(account);
    const out = await t
      .http()
      .post('/v1/auth/logout')
      .set('X-Forwarded-For', t.freshIp())
      .send({ refreshToken });
    expect(out.status).toBe(204);
    expect((await refresh(refreshToken)).status).toBe(401);
    expect((await me(accessToken)).status).toBe(401);
  });

  it('logout never fails, even for a stale or unknown token', async () => {
    for (const body of [
      { refreshToken: 'garbage' },
      { refreshToken: `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${'A'.repeat(43)}` },
      {},
    ]) {
      expect(
        (await t.http().post('/v1/auth/logout').set('X-Forwarded-For', t.freshIp()).send(body))
          .status,
      ).toBe(204);
    }
  });

  it('lists my devices with a readable label and marks this one', async () => {
    const account = await registerVerified();
    const first = await signedIn(account);
    await t
      .http()
      .post('/v1/auth/login')
      .set('X-Forwarded-For', t.freshIp())
      .set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      )
      .send({ email: account.email, password: account.password, clientType: 'MOBILE' });
    const res = await t
      .http()
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(res.body.sessions.map((s: { deviceLabel: string }) => s.deviceLabel)).toContain(
      'Chrome on Windows',
    );
  });

  it('lets me sign out another of my devices, which stops working at once', async () => {
    const account = await registerVerified();
    const laptop = await signedIn(account);
    const phone = await signedIn(account);
    const list = await t
      .http()
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${laptop.accessToken}`);
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    const del = await t
      .http()
      .delete(`/v1/auth/sessions/${other.id}`)
      .set('Authorization', `Bearer ${laptop.accessToken}`);
    expect(del.status).toBe(204);
    expect((await me(phone.accessToken)).status).toBe(401);
    expect((await refresh(phone.refreshToken)).status).toBe(401);
    expect((await me(laptop.accessToken)).status).toBe(200);
  });

  it('returns 404 for unknown sessions and for sessions of another person or business', async () => {
    const a = await registerVerified();
    const b = await registerVerified();
    const sessionA = await signedIn(a);
    const sessionB = await signedIn(b);
    const bRow = await t.db.owner.session.findFirstOrThrow({ where: { userId: b.userId } });

    const unknown = await t
      .http()
      .delete('/v1/auth/sessions/0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b')
      .set('Authorization', `Bearer ${sessionA.accessToken}`);
    const foreign = await t
      .http()
      .delete(`/v1/auth/sessions/${bRow.id}`)
      .set('Authorization', `Bearer ${sessionA.accessToken}`);
    const notAnId = await t
      .http()
      .delete('/v1/auth/sessions/not-a-uuid')
      .set('Authorization', `Bearer ${sessionA.accessToken}`);
    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(notAnId.status).toBe(400);
    // B's session is untouched.
    expect((await me(sessionB.accessToken)).status).toBe(200);
  });
});

describe('forgot and reset password', () => {
  it('answers the same for known and unknown emails, and only emails real accounts', async () => {
    const account = await registerVerified();
    const before = t.mailer.outbox.length;
    const known = await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email });
    const unknown = await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: newEmail('ghost') });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(t.mailer.outbox.length - before).toBe(1);
    expect(t.mailer.lastTo(account.email)!.subject).toMatch(/Reset your/);
  });

  it('resets the password with a single-use link, ends every session and tells the owner', async () => {
    const account = await registerVerified();
    const session = await signedIn(account);
    await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email });
    const token = tokenFromEmail(t.mailer.lastTo(account.email)!.text);

    const newPassword = 'copper window 7 sunrise';
    const reset = await t
      .http()
      .post('/v1/auth/reset-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token, newPassword });
    expect(reset.status).toBe(204);

    expect((await loginMobile(account.email, account.password)).status).toBe(401); // old password dead
    expect((await loginMobile(account.email, newPassword)).status).toBe(200);
    expect((await refresh(session.refreshToken)).status).toBe(401); // old sessions ended
    expect((await me(session.accessToken)).status).toBe(401);
    expect(t.mailer.lastTo(account.email)!.subject).toMatch(/password was changed/);

    const again = await t
      .http()
      .post('/v1/auth/reset-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token, newPassword: 'another long phrase 88' });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('INVALID_TOKEN');
  });

  it('a weak new password is refused WITHOUT using up the link', async () => {
    const account = await registerVerified();
    await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email });
    const token = tokenFromEmail(t.mailer.lastTo(account.email)!.text);
    const weak = await t
      .http()
      .post('/v1/auth/reset-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token, newPassword: 'password123' });
    expect(weak.status).toBe(422);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    const ok = await t
      .http()
      .post('/v1/auth/reset-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token, newPassword: 'copper window 7 sunrise' });
    expect(ok.status).toBe(204);
  });

  it('the link expires after 30 minutes', async () => {
    const account = await registerVerified();
    await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email });
    const token = tokenFromEmail(t.mailer.lastTo(account.email)!.text);
    t.clock.advanceSeconds(31 * 60);
    const res = await t
      .http()
      .post('/v1/auth/reset-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token, newPassword: 'copper window 7 sunrise' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('a newer link replaces the older one', async () => {
    const account = await registerVerified();
    await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email });
    const older = tokenFromEmail(t.mailer.lastTo(account.email)!.text);
    await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email });
    const newer = tokenFromEmail(t.mailer.lastTo(account.email)!.text);
    expect(
      (
        await t
          .http()
          .post('/v1/auth/reset-password')
          .set('X-Forwarded-For', t.freshIp())
          .send({ token: older, newPassword: 'copper window 7 sunrise' })
      ).status,
    ).toBe(400);
    expect(
      (
        await t
          .http()
          .post('/v1/auth/reset-password')
          .set('X-Forwarded-For', t.freshIp())
          .send({ token: newer, newPassword: 'copper window 7 sunrise' })
      ).status,
    ).toBe(204);
  });

  it('a verification link cannot be used to reset a password (the kinds are separate)', async () => {
    const email = newEmail();
    await t.http().post('/v1/auth/signup').set('X-Forwarded-For', t.freshIp()).send({
      businessName: 'Mixup Co',
      ownerName: 'Ravi Mehta',
      email,
      password: STRONG_PASSWORD,
    });
    const verificationToken = tokenFromEmail(t.mailer.lastTo(email)!.text);
    const res = await t
      .http()
      .post('/v1/auth/reset-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token: verificationToken, newPassword: 'copper window 7 sunrise' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('resetting also clears a lockout, so the person can sign in with the new password straight away', async () => {
    const account = await registerVerified();
    for (let i = 0; i < 5; i++) await loginMobile(account.email, 'wrong wrong wrong');
    await t
      .http()
      .post('/v1/auth/forgot-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email });
    const token = tokenFromEmail(t.mailer.lastTo(account.email)!.text);
    await t
      .http()
      .post('/v1/auth/reset-password')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token, newPassword: 'copper window 7 sunrise' });
    expect((await loginMobile(account.email, 'copper window 7 sunrise')).status).toBe(200);
  });
});

describe('change password', () => {
  it('needs the current password and ends only the OTHER sessions', async () => {
    const account = await registerVerified();
    const laptop = await signedIn(account);
    const phone = await signedIn(account);

    const wrong = await t
      .http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .send({ currentPassword: 'not my password', newPassword: 'copper window 7 sunrise' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');

    const weak = await t
      .http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .send({ currentPassword: account.password, newPassword: '1234567890' });
    expect(weak.status).toBe(422);

    const ok = await t
      .http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .send({ currentPassword: account.password, newPassword: 'copper window 7 sunrise' });
    expect(ok.status).toBe(204);
    expect((await me(laptop.accessToken)).status).toBe(200); // this device stays signed in
    expect((await me(phone.accessToken)).status).toBe(401); // the other one is signed out
    expect((await refresh(phone.refreshToken)).status).toBe(401);
    expect((await loginMobile(account.email, account.password)).status).toBe(401);
    expect((await loginMobile(account.email, 'copper window 7 sunrise')).status).toBe(200);
    expect(t.mailer.lastTo(account.email)!.subject).toMatch(/password was changed/);
  });

  it('requires being signed in', async () => {
    const res = await t
      .http()
      .post('/v1/auth/change-password')
      .send({ currentPassword: 'x', newPassword: 'y' });
    expect(res.status).toBe(401);
  });
});

describe('two-step login with an authenticator app', () => {
  /** Sign in, set up and switch on two-step login. Returns what the test needs to continue. */
  async function withTotp(): Promise<{
    account: Account;
    secret: string;
    recoveryCodes: string[];
    accessToken: string;
  }> {
    const account = await registerVerified();
    const { accessToken } = await signedIn(account);
    const setup = await t
      .http()
      .post('/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(setup.status).toBe(200);
    expect(setup.body.otpAuthUri).toContain('otpauth://totp/Dumbbill');
    const code = totpAt(setup.body.secret, t.clock.now());
    const enable = await t
      .http()
      .post('/v1/auth/totp/enable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code });
    expect(enable.status).toBe(200);
    return {
      account,
      secret: setup.body.secret,
      recoveryCodes: enable.body.recoveryCodes,
      accessToken,
    };
  }

  it('stores the secret encrypted, never as the readable value', async () => {
    const { account, secret } = await withTotp();
    const user = await t.db.owner.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(user.totpSecretEnc).toMatch(/^v1\./);
    expect(user.totpSecretEnc).not.toContain(secret);
    expect(user.totpEnabledAt).not.toBeNull();
    expect(user.totpRecoveryHashes).toHaveLength(8);
  });

  it('gives 8 recovery codes once and keeps only their hashes', async () => {
    const { account, recoveryCodes } = await withTotp();
    expect(recoveryCodes).toHaveLength(8);
    const user = await t.db.owner.user.findUniqueOrThrow({ where: { id: account.userId } });
    for (const code of recoveryCodes) expect(user.totpRecoveryHashes.join(' ')).not.toContain(code);
  });

  it('asks for a code after the right password, accepts a right code, and refuses wrong ones', async () => {
    const { account, secret } = await withTotp();
    const needCode = await loginMobile(account.email, account.password);
    expect(needCode.status).toBe(401);
    expect(needCode.body.code).toBe('TOTP_REQUIRED');

    t.clock.advanceSeconds(30); // a fresh code (the one used to switch it on is spent)
    const wrong = await loginMobile(account.email, account.password, { totpCode: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_TOTP_CODE');

    const right = await loginMobile(account.email, account.password, {
      totpCode: totpAt(secret, t.clock.now()),
    });
    expect(right.status).toBe(200);
    expect(right.body.user.totpEnabled).toBe(true);
  });

  it('a code cannot be used twice (someone watching you type cannot reuse it)', async () => {
    const { account, secret } = await withTotp();
    t.clock.advanceSeconds(30);
    const code = totpAt(secret, t.clock.now());
    expect((await loginMobile(account.email, account.password, { totpCode: code })).status).toBe(
      200,
    );
    const replay = await loginMobile(account.email, account.password, { totpCode: code });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_TOTP_CODE');
  });

  it('the wrong password never reveals that two-step login exists', async () => {
    const { account } = await withTotp();
    const res = await loginMobile(account.email, 'completely wrong password', {
      totpCode: '123456',
    });
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('a recovery code works once', async () => {
    const { account, recoveryCodes } = await withTotp();
    const first = await loginMobile(account.email, account.password, {
      recoveryCode: recoveryCodes[0],
    });
    expect(first.status).toBe(200);
    const second = await loginMobile(account.email, account.password, {
      recoveryCode: recoveryCodes[0],
    });
    expect(second.status).toBe(401);
    expect(second.body.code).toBe('INVALID_TOTP_CODE');
    // ...and another one still works.
    expect(
      (
        await loginMobile(account.email, account.password, {
          recoveryCode: recoveryCodes[1]!.toLowerCase(),
        })
      ).status,
    ).toBe(200);
  });

  it('two different recovery codes used at the same moment are both spent (neither comes back)', async () => {
    const { account, recoveryCodes } = await withTotp();
    const [a, b] = await Promise.all([
      loginMobile(account.email, account.password, { recoveryCode: recoveryCodes[0] }),
      loginMobile(account.email, account.password, { recoveryCode: recoveryCodes[1] }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    for (const code of [recoveryCodes[0], recoveryCodes[1]]) {
      expect(
        (await loginMobile(account.email, account.password, { recoveryCode: code })).status,
      ).toBe(401);
    }
    const user = await t.db.owner.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(user.totpRecoveryHashes).toHaveLength(6);
  });

  it('the same recovery code submitted twice at once works only once', async () => {
    const { account, recoveryCodes } = await withTotp();
    const results = await Promise.all([
      loginMobile(account.email, account.password, { recoveryCode: recoveryCodes[0] }),
      loginMobile(account.email, account.password, { recoveryCode: recoveryCodes[0] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('wrong codes count towards the lockout', async () => {
    const { account } = await withTotp();
    for (let i = 0; i < 5; i++)
      await loginMobile(account.email, account.password, { totpCode: '000000' });
    expect(
      (await loginMobile(account.email, account.password, { totpCode: '000000' })).status,
    ).toBe(429);
  });

  it('cannot be switched on with a wrong first code, or without starting setup', async () => {
    const account = await registerVerified();
    const { accessToken } = await signedIn(account);
    const early = await t
      .http()
      .post('/v1/auth/totp/enable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '123456' });
    expect(early.status).toBe(422);
    await t.http().post('/v1/auth/totp/setup').set('Authorization', `Bearer ${accessToken}`);
    const wrong = await t
      .http()
      .post('/v1/auth/totp/enable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '123456' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_TOTP_CODE');
    // An unfinished setup does not affect sign-in.
    expect((await loginMobile(account.email, account.password)).status).toBe(200);
  });

  it('cannot be set up twice while on', async () => {
    const { accessToken } = await withTotp();
    const again = await t
      .http()
      .post('/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(again.status).toBe(409);
  });

  it('is switched off only with the password AND a valid code', async () => {
    const { account, secret, accessToken } = await withTotp();
    t.clock.advanceSeconds(30);
    const code = totpAt(secret, t.clock.now());
    const noPassword = await t
      .http()
      .post('/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'wrong password', code });
    expect(noPassword.status).toBe(401);
    const noCode = await t
      .http()
      .post('/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: account.password, code: '000000' });
    expect(noCode.status).toBe(401);
    const ok = await t
      .http()
      .post('/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: account.password, code });
    expect(ok.status).toBe(204);
    expect((await loginMobile(account.email, account.password)).status).toBe(200); // no code needed any more
  });
});

describe('browser sign-in (cookies and CSRF)', () => {
  /** Pull `name=value` pairs out of the Set-Cookie headers. */
  function cookies(res: { headers: Record<string, unknown> }): {
    raw: string[];
    jar: Record<string, string>;
  } {
    const raw = (res.headers['set-cookie'] as string[] | undefined) ?? [];
    const jar: Record<string, string> = {};
    for (const line of raw) {
      const [pair] = line.split(';');
      const index = pair!.indexOf('=');
      jar[pair!.slice(0, index)] = pair!.slice(index + 1);
    }
    return { raw, jar };
  }

  async function webLogin(account: Account) {
    const res = await t
      .http()
      .post('/v1/auth/login')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: account.email, password: account.password, clientType: 'WEB' });
    expect(res.status).toBe(200);
    return { res, ...cookies(res) };
  }

  it('keeps the refresh token in an httpOnly, SameSite=Strict cookie and out of the JSON', async () => {
    const account = await registerVerified();
    const { res, raw, jar } = await webLogin(account);
    expect(res.body.refreshToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(jar['dumbbill_rt']!);

    const refreshCookie = raw.find((c) => c.startsWith('dumbbill_rt='))!;
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/SameSite=Strict/i);
    expect(refreshCookie).toMatch(/Secure/i);
    expect(refreshCookie).toMatch(/Path=\/v1\/auth/);

    const csrfCookie = raw.find((c) => c.startsWith('dumbbill_csrf='))!;
    expect(csrfCookie).not.toMatch(/HttpOnly/i); // the web app must be able to read it
    expect(csrfCookie).toMatch(/SameSite=Strict/i);
  });

  it('refresh with only the cookie is refused (cross-site request forgery protection)', async () => {
    const account = await registerVerified();
    const { jar } = await webLogin(account);
    const noHeader = await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .set('Cookie', `dumbbill_rt=${jar['dumbbill_rt']}; dumbbill_csrf=${jar['dumbbill_csrf']}`)
      .send({});
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe('CSRF_FAILED');
    const wrongHeader = await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .set('X-CSRF-Token', 'guess')
      .set('Cookie', `dumbbill_rt=${jar['dumbbill_rt']}; dumbbill_csrf=${jar['dumbbill_csrf']}`)
      .send({});
    expect(wrongHeader.status).toBe(403);
    // An attacker's site can make the browser send the cookies, but cannot read the CSRF value to fill the header.
  });

  it('refresh with the cookie and the matching header works, and rotates both cookies', async () => {
    const account = await registerVerified();
    const { jar } = await webLogin(account);
    const res = await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .set('X-CSRF-Token', jar['dumbbill_csrf']!)
      .set('Cookie', `dumbbill_rt=${jar['dumbbill_rt']}; dumbbill_csrf=${jar['dumbbill_csrf']}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
    const next = cookies(res);
    expect(next.jar['dumbbill_rt']).toBeTruthy();
    expect(next.jar['dumbbill_rt']).not.toBe(jar['dumbbill_rt']);
    expect((await me(res.body.accessToken)).status).toBe(200);
  });

  it('a dead session clears the stale cookies', async () => {
    const account = await registerVerified();
    const { jar } = await webLogin(account);
    const headers = {
      'X-CSRF-Token': jar['dumbbill_csrf']!,
      Cookie: `dumbbill_rt=${jar['dumbbill_rt']}; dumbbill_csrf=${jar['dumbbill_csrf']}`,
    };
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .set(headers)
      .send({});
    t.clock.advanceSeconds(60);
    const replay = await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .set(headers)
      .send({});
    expect(replay.status).toBe(401);
    const cleared = setCookieLines(replay).join(' ');
    expect(cleared).toMatch(/dumbbill_rt=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('logout through the cookie needs the CSRF header, then ends the session and clears the cookies', async () => {
    const account = await registerVerified();
    const { jar } = await webLogin(account);
    const cookie = `dumbbill_rt=${jar['dumbbill_rt']}; dumbbill_csrf=${jar['dumbbill_csrf']}`;
    expect((await t.http().post('/v1/auth/logout').set('Cookie', cookie).send({})).status).toBe(
      403,
    );
    const out = await t
      .http()
      .post('/v1/auth/logout')
      .set('X-CSRF-Token', jar['dumbbill_csrf']!)
      .set('Cookie', cookie)
      .send({});
    expect(out.status).toBe(204);
    expect(setCookieLines(out).join(' ')).toMatch(/dumbbill_rt=;/);
    const after = await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .set('X-CSRF-Token', jar['dumbbill_csrf']!)
      .set('Cookie', cookie)
      .send({});
    expect(after.status).toBe(401);
  });

  it('allows the web app origin (with cookies) and nobody else', async () => {
    const allowed = await t
      .http()
      .options('/v1/auth/login')
      .set('Origin', 'https://app.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-allow-headers']).toMatch(/X-CSRF-Token/i);

    const stranger = await t
      .http()
      .options('/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('audit log', () => {
  it('records sign-up, sign-in, failures and password changes, with no secrets in it', async () => {
    const account = await registerVerified();
    await loginMobile(account.email, 'wrong password here');
    const { accessToken } = await signedIn(account);
    await t
      .http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: account.password, newPassword: 'copper window 7 sunrise' });

    const rows = await t.db.owner.auditLog.findMany({
      where: { tenantId: account.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'auth.signup',
        'auth.email_verified',
        'auth.login_failed',
        'auth.login',
        'auth.password_changed',
      ]),
    );
    const everything = JSON.stringify(rows);
    expect(everything).not.toContain(account.password);
    expect(everything).not.toContain('copper window');
    expect(everything).not.toMatch(/argon2/);
    const failed = rows.find((r) => r.action === 'auth.login_failed')!;
    expect(failed.requestId).toBeTruthy();
    expect(failed.actorUserId).toBe(account.userId);
  });

  it('can never be changed or deleted, not even by the database owner', async () => {
    const account = await registerVerified();
    await expect(
      t.db.owner.$executeRawUnsafe(
        `UPDATE audit_log SET action = 'x' WHERE tenant_id = '${account.tenantId}'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      t.db.owner.$executeRawUnsafe(`DELETE FROM audit_log WHERE tenant_id = '${account.tenantId}'`),
    ).rejects.toThrow(/append-only/);
  });
});

describe('business isolation of sign-in data', () => {
  it('each business only ever sees its own sessions, and tokens never cross', async () => {
    const a = await registerVerified({ business: 'Alpha Supplements' });
    const b = await registerVerified({ business: 'Beta Nutrition' });
    const sessionA = await signedIn(a);
    await signedIn(b);
    const list = await t
      .http()
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${sessionA.accessToken}`);
    const bSession = await t.db.owner.session.findFirstOrThrow({ where: { userId: b.userId } });
    expect(list.body.sessions.map((s: { id: string }) => s.id)).not.toContain(bSession.id);

    const profile = await me(sessionA.accessToken);
    expect(profile.body.tenant.name).toBe('Alpha Supplements');
  });
});
