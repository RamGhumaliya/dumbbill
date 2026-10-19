import { AuthTestApp, STRONG_PASSWORD, tokenFromEmail } from './auth-test-app';

/**
 * Small building blocks for the team tests: make a business, invite people into it, and sign them in. Every call goes
 * through the real HTTP API of the test app, exactly as a browser or phone would.
 */
let counter = 0;

/** A person who is signed in: their address, password, access token and ids. */
export interface Person {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
}

/** A unique address so tests never collide. */
export function newAddress(label = 'person'): string {
  return `${label}.${Date.now().toString(36)}.${++counter}@team.test`;
}

/** Sign a person in (mobile style, so the refresh token comes back in the JSON). */
export async function signIn(
  t: AuthTestApp,
  email: string,
  password = STRONG_PASSWORD,
): Promise<Person> {
  const res = await t
    .http()
    .post('/v1/auth/login')
    .set('X-Forwarded-For', t.freshIp())
    .send({ email, password, clientType: 'MOBILE' });
  if (res.status !== 200)
    throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const user = await t.db.owner.user.findUniqueOrThrow({ where: { email } });
  return {
    email,
    password,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: user.id,
    tenantId: user.tenantId,
  };
}

/** A business with its owner, signed in. */
export async function createBusiness(t: AuthTestApp, name = 'FitFuel Nutrition'): Promise<Person> {
  const email = newAddress('owner');
  const signup = await t
    .http()
    .post('/v1/auth/signup')
    .set('X-Forwarded-For', t.freshIp())
    .send({ businessName: name, ownerName: 'Ravi Mehta', email, password: STRONG_PASSWORD });
  if (signup.status !== 202) throw new Error(`signup failed: ${signup.status}`);
  await t
    .http()
    .post('/v1/auth/verify-email')
    .set('X-Forwarded-For', t.freshIp())
    .send({ token: tokenFromEmail(t.mailer.lastTo(email)!.text) });
  return signIn(t, email);
}

/** The id of a built-in role of a business, by its key. */
export async function roleId(
  t: AuthTestApp,
  tenantId: string,
  systemKey: 'OWNER' | 'ADMIN' | 'CASHIER',
): Promise<string> {
  return (await t.db.owner.role.findFirstOrThrow({ where: { tenantId, systemKey } })).id;
}

/** Send a request as a person. */
export function as(t: AuthTestApp, person: Pick<Person, 'accessToken'>) {
  return {
    get: (path: string) =>
      t
        .http()
        .get(path)
        .set('Authorization', `Bearer ${person.accessToken}`)
        .set('X-Forwarded-For', t.freshIp()),
    post: (path: string, body: object = {}) =>
      t
        .http()
        .post(path)
        .set('Authorization', `Bearer ${person.accessToken}`)
        .set('X-Forwarded-For', t.freshIp())
        .send(body),
    put: (path: string, body: object = {}) =>
      t
        .http()
        .put(path)
        .set('Authorization', `Bearer ${person.accessToken}`)
        .set('X-Forwarded-For', t.freshIp())
        .send(body),
    patch: (path: string, body: object = {}) =>
      t
        .http()
        .patch(path)
        .set('Authorization', `Bearer ${person.accessToken}`)
        .set('X-Forwarded-For', t.freshIp())
        .send(body),
    delete: (path: string) =>
      t
        .http()
        .delete(path)
        .set('Authorization', `Bearer ${person.accessToken}`)
        .set('X-Forwarded-For', t.freshIp()),
  };
}

/**
 * Invite a person and have them accept and sign in, like a real team member would.
 * `body` may carry extra permissions, branches and so on; `role` picks the built-in role.
 */
export async function addTeamMember(
  t: AuthTestApp,
  inviter: Person,
  role: 'ADMIN' | 'CASHIER',
  body: Record<string, unknown> = {},
  label = role.toLowerCase(),
): Promise<Person> {
  const email = newAddress(label);
  const invite = await as(t, inviter).post('/v1/team/members', {
    email,
    fullName: `${label} person`,
    roleId: await roleId(t, inviter.tenantId, role),
    ...body,
  });
  if (invite.status !== 201)
    throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  const accept = await t
    .http()
    .post('/v1/auth/accept-invitation')
    .set('X-Forwarded-For', t.freshIp())
    .send({ token: tokenFromEmail(t.mailer.lastTo(email)!.text), password: STRONG_PASSWORD });
  if (accept.status !== 204)
    throw new Error(`accept failed: ${accept.status} ${JSON.stringify(accept.body)}`);
  return signIn(t, email);
}
