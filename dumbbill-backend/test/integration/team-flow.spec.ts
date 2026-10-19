import {
  AuthTestApp,
  createAuthTestApp,
  STRONG_PASSWORD,
  tokenFromEmail,
} from '../support/auth-test-app';
import {
  addTeamMember,
  as,
  createBusiness,
  newAddress,
  Person,
  roleId,
  signIn,
} from '../support/team-helpers';

/**
 * Roles, permissions and the team, end to end against the real application and a real PostgreSQL database with
 * row-level security. Each scenario is something an owner, a manager, a cashier or an attacker could actually do.
 * Every business is made fresh, so tests never affect each other's limits.
 */
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp();
});

afterAll(async () => {
  await t.close();
});

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await t.db.owner.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.action);
}

describe('a new business', () => {
  it('starts with the Owner, Admin and Cashier roles and a Main branch, and the owner holds the Owner role', async () => {
    const owner = await createBusiness(t);
    const roles = await t.db.owner.role.findMany({
      where: { tenantId: owner.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    expect(roles.map((r) => [r.name, r.systemKey])).toEqual([
      ['Owner', 'OWNER'],
      ['Admin', 'ADMIN'],
      ['Cashier', 'CASHIER'],
    ]);
    expect(roles.find((r) => r.systemKey === 'CASHIER')).toMatchObject({
      permissions: ['products.read', 'pos.sell', 'discount.apply'],
      discountLimitBp: 500,
      allBranches: false,
    });
    const branches = await t.db.owner.branch.findMany({ where: { tenantId: owner.tenantId } });
    expect(branches.map((b) => b.name)).toEqual(['Main branch']);
    const user = await t.db.owner.user.findUniqueOrThrow({
      where: { id: owner.userId },
      include: { role: true },
    });
    expect(user.role?.systemKey).toBe('OWNER');
  });

  it('tells the apps what the owner can do (every permission, every branch)', async () => {
    const owner = await createBusiness(t);
    const me = await as(t, owner).get('/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.access).toMatchObject({
      roleName: 'Owner',
      allBranches: true,
      discountLimitBp: 10000,
    });
    expect(me.body.access.permissions).toEqual(
      expect.arrayContaining(['team.manage', 'products.cost.read', 'reports.profit']),
    );
  });
});

describe('inviting a person', () => {
  it('adds them as INVITED, emails a link, and they cannot sign in until they accept', async () => {
    const owner = await createBusiness(t);
    const email = newAddress('asha');
    const res = await as(t, owner).post('/v1/team/members', {
      email: email.toUpperCase(),
      fullName: 'Asha Patil',
      roleId: await roleId(t, owner.tenantId, 'CASHIER'),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email,
      fullName: 'Asha Patil',
      status: 'INVITED',
      isOwner: false,
      role: { name: 'Cashier' },
      hasPin: false,
    });
    expect(res.body.effective.permissions).toEqual(['products.read', 'pos.sell', 'discount.apply']);

    const mail = t.mailer.lastTo(email)!;
    expect(mail.subject).toMatch(/invited you to FitFuel Nutrition/);
    expect(mail.text).toContain('https://app.example.test/accept-invitation?token=');
    expect(mail.text).toContain('Ravi Mehta');

    const early = await t
      .http()
      .post('/v1/auth/login')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email, password: STRONG_PASSWORD, clientType: 'MOBILE' });
    expect(early.status).toBe(401);
    expect(early.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('the person chooses their own password from the link, then signs in with the Cashier access', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    const me = await as(t, cashier).get('/v1/auth/me');
    expect(me.body.user).toMatchObject({ isOwner: false });
    expect(me.body.access).toMatchObject({
      roleName: 'Cashier',
      discountLimitBp: 500,
      allBranches: false,
    });
    expect(me.body.access.permissions.sort()).toEqual([
      'discount.apply',
      'pos.sell',
      'products.read',
    ]);
    const row = await t.db.owner.user.findUniqueOrThrow({ where: { id: cashier.userId } });
    expect(row.status).toBe('ACTIVE');
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.passwordHash).toMatch(/^v1:\$argon2id\$/);
  });

  it('a link works once, expires after 7 days, and a refused password does not use it up', async () => {
    const owner = await createBusiness(t);
    const post = async (email: string) =>
      as(t, owner).post('/v1/team/members', {
        email,
        fullName: 'Link Test',
        roleId: await roleId(t, owner.tenantId, 'CASHIER'),
      });
    const accept = (token: string, password: string) =>
      t
        .http()
        .post('/v1/auth/accept-invitation')
        .set('X-Forwarded-For', t.freshIp())
        .send({ token, password });

    const a = newAddress('once');
    await post(a);
    const token = tokenFromEmail(t.mailer.lastTo(a)!.text);
    const weak = await accept(token, 'password123');
    expect(weak.status).toBe(422);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    expect((await accept(token, STRONG_PASSWORD)).status).toBe(204);
    const again = await accept(token, STRONG_PASSWORD);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('INVALID_TOKEN');

    const b = newAddress('late');
    await post(b);
    const late = tokenFromEmail(t.mailer.lastTo(b)!.text);
    t.clock.advanceSeconds(7 * 24 * 3600 + 60);
    expect((await accept(late, STRONG_PASSWORD)).body.code).toBe('INVALID_TOKEN');
  });

  it('sending the invitation again makes the older link stop working', async () => {
    const owner = await createBusiness(t);
    const email = newAddress('resend');
    const created = await as(t, owner).post('/v1/team/members', {
      email,
      fullName: 'Resend Test',
      roleId: await roleId(t, owner.tenantId, 'CASHIER'),
    });
    const first = tokenFromEmail(t.mailer.lastTo(email)!.text);
    expect(
      (await as(t, owner).post(`/v1/team/members/${created.body.id}/resend-invitation`)).status,
    ).toBe(204);
    const second = tokenFromEmail(t.mailer.lastTo(email)!.text);
    expect(second).not.toBe(first);
    const accept = (token: string) =>
      t
        .http()
        .post('/v1/auth/accept-invitation')
        .set('X-Forwarded-For', t.freshIp())
        .send({ token, password: STRONG_PASSWORD });
    expect((await accept(first)).status).toBe(400);
    expect((await accept(second)).status).toBe(204);
    // After acceptance there is nothing to resend.
    expect(
      (await as(t, owner).post(`/v1/team/members/${created.body.id}/resend-invitation`)).body.code,
    ).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects made-up permissions, unknown fields and the Owner role', async () => {
    const owner = await createBusiness(t);
    const base = {
      email: newAddress('bad'),
      fullName: 'Bad Input',
      roleId: await roleId(t, owner.tenantId, 'CASHIER'),
    };
    expect(
      (
        await as(t, owner).post('/v1/team/members', {
          ...base,
          extraPermissions: ['root.everything'],
        })
      ).status,
    ).toBe(400);
    expect(
      (await as(t, owner).post('/v1/team/members', { ...base, isOwner: true })).body.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await as(t, owner).post('/v1/team/members', { ...base, tenantId: owner.tenantId })).status,
    ).toBe(400);
    const asOwner = await as(t, owner).post('/v1/team/members', {
      ...base,
      roleId: await roleId(t, owner.tenantId, 'OWNER'),
    });
    expect(asOwner.status).toBe(403);
  });

  it('refuses an address that already has an account, with the same answer as a repeat in the same business', async () => {
    const owner = await createBusiness(t);
    const other = await createBusiness(t); // an account in ANOTHER business
    const cashierRole = await roleId(t, owner.tenantId, 'CASHIER');
    const inOtherBusiness = await as(t, owner).post('/v1/team/members', {
      email: other.email,
      fullName: 'Taken',
      roleId: cashierRole,
    });
    await as(t, owner).post('/v1/team/members', {
      email: newAddress('dup'),
      fullName: 'First',
      roleId: cashierRole,
    });
    const repeat = await as(t, owner).get('/v1/team/members');
    const existing = repeat.body.members.find((m: { isOwner: boolean }) => !m.isOwner).email;
    const inSameBusiness = await as(t, owner).post('/v1/team/members', {
      email: existing,
      fullName: 'Again',
      roleId: cashierRole,
    });
    expect(inOtherBusiness.status).toBe(409);
    expect(inSameBusiness.status).toBe(409);
    for (const field of ['code', 'title', 'detail'])
      expect(inOtherBusiness.body[field]).toEqual(inSameBusiness.body[field]);
  });

  it('limits invitations to 20 an hour per business', async () => {
    const owner = await createBusiness(t);
    const roleIdValue = await roleId(t, owner.tenantId, 'CASHIER');
    let refused = 0;
    for (let i = 0; i < 22; i++) {
      const res = await as(t, owner).post('/v1/team/members', {
        email: newAddress('flood'),
        fullName: 'Flood Test',
        roleId: roleIdValue,
      });
      if (res.status === 429) refused++;
    }
    expect(refused).toBeGreaterThanOrEqual(1);
  });
});

describe('the plan limit', () => {
  it('stops invitations when all seats are used, and switching someone off frees a seat', async () => {
    const owner = await createBusiness(t);
    await t.db.owner.plan.update({ where: { code: 'STARTER' }, data: { maxUsers: 3 } });
    try {
      const a = await addTeamMember(t, owner, 'CASHIER', {}, 'seat1');
      await addTeamMember(t, owner, 'CASHIER', {}, 'seat2');
      const full = await as(t, owner).post('/v1/team/members', {
        email: newAddress('seat3'),
        fullName: 'No Room',
        roleId: await roleId(t, owner.tenantId, 'CASHIER'),
      });
      expect(full.status).toBe(422);
      expect(full.body.code).toBe('PLAN_LIMIT_REACHED');
      expect(full.body.detail).toMatch(/allows 3 people/);

      expect((await as(t, owner).post(`/v1/team/members/${a.userId}/disable`)).status).toBe(200);
      const room = await as(t, owner).post('/v1/team/members', {
        email: newAddress('seat3b'),
        fullName: 'Now Room',
        roleId: await roleId(t, owner.tenantId, 'CASHIER'),
      });
      expect(room.status).toBe(201);
      // Switching the first person back on now needs a seat that is gone.
      const back = await as(t, owner).post(`/v1/team/members/${a.userId}/enable`);
      expect(back.body.code).toBe('PLAN_LIMIT_REACHED');
    } finally {
      await t.db.owner.plan.update({ where: { code: 'STARTER' }, data: { maxUsers: 25 } });
    }
  });
});

describe('permissions are enforced by the API, not the screen', () => {
  it('refuses a cashier on team routes (403 problem+json) and records the attempt in the audit log', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    const res = await as(t, cashier).get('/v1/team/members');
    expect(res.status).toBe(403);
    expect(res.type).toBe('application/problem+json');
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.requestId).toBeTruthy();

    const denied = await t.db.owner.auditLog.findFirstOrThrow({
      where: { tenantId: owner.tenantId, action: 'authz.denied' },
    });
    expect(denied.actorUserId).toBe(cashier.userId);
    expect(denied.entityId).toBe('GET /v1/team/members');
    expect(denied.metadata).toMatchObject({ missing: 'team.manage' });
    expect(denied.requestId).toBeTruthy();
    expect(denied.ipAddress).toBeTruthy();
  });

  it('lets the owner and a person with the permission in, and refuses someone without a token', async () => {
    const owner = await createBusiness(t);
    expect((await as(t, owner).get('/v1/team/members')).status).toBe(200);
    expect((await t.http().get('/v1/team/members')).status).toBe(401);
    const manager = await addTeamMember(t, owner, 'ADMIN', { extraPermissions: ['team.manage'] });
    expect((await as(t, manager).get('/v1/team/members')).status).toBe(200);
  });

  it('a cashier can do what a cashier is for (pick an approver) and the Admin preset cannot manage the team', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    const admin = await addTeamMember(t, owner, 'ADMIN');
    expect((await as(t, cashier).get('/v1/team/approvers')).status).toBe(200);
    expect((await as(t, admin).get('/v1/team/members')).status).toBe(403);
  });

  it('a change of role applies to the very next request, with the SAME access token', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    expect((await as(t, cashier).get('/v1/team/approvers')).status).toBe(200);

    // The owner takes "sell at the till" away from the Cashier role.
    const cashierRole = await roleId(t, owner.tenantId, 'CASHIER');
    const edit = await as(t, owner).patch(`/v1/team/roles/${cashierRole}`, {
      permissions: ['products.read', 'discount.apply'],
    });
    expect(edit.status).toBe(200);
    expect((await as(t, cashier).get('/v1/team/approvers')).status).toBe(403);

    // ...and gives it back to just this person as an extra.
    const patch = await as(t, owner).patch(`/v1/team/members/${cashier.userId}`, {
      extraPermissions: ['pos.sell'],
    });
    expect(patch.status).toBe(200);
    expect((await as(t, cashier).get('/v1/team/approvers')).status).toBe(200);
  });

  it('"taken away" wins over the role', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    await as(t, owner).patch(`/v1/team/members/${cashier.userId}`, {
      deniedPermissions: ['pos.sell'],
    });
    expect((await as(t, cashier).get('/v1/team/approvers')).status).toBe(403);
    const me = await as(t, cashier).get('/v1/auth/me');
    expect(me.body.access.permissions).not.toContain('pos.sell');
  });

  it('a person with a role that has no permissions can only use their own account', async () => {
    const owner = await createBusiness(t);
    const empty = await as(t, owner).post('/v1/team/roles', { name: 'Nothing', permissions: [] });
    expect(empty.status).toBe(201);
    const person = await addTeamMember(t, owner, 'CASHIER', { roleId: empty.body.id });
    expect((await as(t, person).get('/v1/auth/me')).status).toBe(200);
    expect((await as(t, person).get('/v1/auth/sessions')).status).toBe(200);
    expect((await as(t, person).get('/v1/team/approvers')).status).toBe(403);
    expect((await as(t, person).get('/v1/team/roles')).status).toBe(403);
  });
});

describe('switching a person off', () => {
  it('ends their sessions at once: access token, refresh token and sign-in all stop', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    expect((await as(t, cashier).get('/v1/auth/me')).status).toBe(200);

    const off = await as(t, owner).post(`/v1/team/members/${cashier.userId}/disable`);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ status: 'DISABLED' });
    expect(off.body.disabledAt).toBeTruthy();

    const me = await as(t, cashier).get('/v1/auth/me');
    expect(me.status).toBe(401); // not "up to 15 minutes later"
    const refresh = await t
      .http()
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', t.freshIp())
      .send({ refreshToken: cashier.refreshToken });
    expect(refresh.status).toBe(401);
    const login = await t
      .http()
      .post('/v1/auth/login')
      .set('X-Forwarded-For', t.freshIp())
      .send({ email: cashier.email, password: cashier.password, clientType: 'MOBILE' });
    expect(login.body.code).toBe('INVALID_CREDENTIALS');

    const sessions = await t.db.owner.session.findMany({ where: { userId: cashier.userId } });
    expect(sessions.every((s) => s.revokedAt && s.revokedReason === 'USER_DISABLED')).toBe(true);
    expect(await auditActions(owner.tenantId)).toContain('team.member_disabled');
  });

  it('is a second line of defence: a person switched off directly in the database is refused even with live sessions', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    expect((await as(t, cashier).get('/v1/auth/me')).status).toBe(200);
    // Bypass the team endpoint entirely: no session is ended, no revocation is recorded.
    await t.db.owner.user.update({ where: { id: cashier.userId }, data: { status: 'DISABLED' } });
    const sessions = await t.db.owner.session.findMany({ where: { userId: cashier.userId } });
    expect(sessions.every((s) => s.revokedAt === null)).toBe(true);
    const res = await as(t, cashier).get('/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('switching back on restores sign-in, but the old sessions stay ended', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    await as(t, owner).post(`/v1/team/members/${cashier.userId}/disable`);
    expect((await as(t, owner).post(`/v1/team/members/${cashier.userId}/disable`)).status).toBe(
      409,
    );
    const on = await as(t, owner).post(`/v1/team/members/${cashier.userId}/enable`);
    expect(on.body).toMatchObject({ status: 'ACTIVE', disabledAt: null });
    expect((await as(t, cashier).get('/v1/auth/me')).status).toBe(401); // the old access token is still dead
    const fresh = await signIn(t, cashier.email);
    expect((await as(t, fresh).get('/v1/auth/me')).status).toBe(200);
  });

  it('a person switched off before accepting cannot use their invitation link', async () => {
    const owner = await createBusiness(t);
    const email = newAddress('pending');
    const created = await as(t, owner).post('/v1/team/members', {
      email,
      fullName: 'Pending',
      roleId: await roleId(t, owner.tenantId, 'CASHIER'),
    });
    const token = tokenFromEmail(t.mailer.lastTo(email)!.text);
    await as(t, owner).post(`/v1/team/members/${created.body.id}/disable`);
    const accept = await t
      .http()
      .post('/v1/auth/accept-invitation')
      .set('X-Forwarded-For', t.freshIp())
      .send({ token, password: STRONG_PASSWORD });
    expect(accept.body.code).toBe('INVALID_TOKEN');
    // Switched back on, they return to INVITED and need a new link.
    const on = await as(t, owner).post(`/v1/team/members/${created.body.id}/enable`);
    expect(on.body.status).toBe('INVITED');
  });
});

describe('nobody can escalate or touch the owner', () => {
  /** An admin who may manage the team (the owner granted team.manage) but has no `settings.manage` or `invoice`-less powers of the owner. */
  async function manager(): Promise<{ owner: Person; manager: Person; cashier: Person }> {
    const owner = await createBusiness(t);
    const mgr = await addTeamMember(
      t,
      owner,
      'ADMIN',
      { extraPermissions: ['team.manage'], discountLimitBp: 1000 },
      'mgr',
    );
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    return { owner, manager: mgr, cashier };
  }

  it('the owner cannot be edited, switched off, or have the Owner role taken or given', async () => {
    const { owner, manager: mgr, cashier } = await manager();
    for (const res of [
      await as(t, mgr).patch(`/v1/team/members/${owner.userId}`, {
        deniedPermissions: ['team.manage'],
      }),
      await as(t, mgr).post(`/v1/team/members/${owner.userId}/disable`),
      await as(t, owner).post(`/v1/team/members/${owner.userId}/disable`), // not even by themselves
    ]) {
      expect(res.status).toBe(403);
    }
    const ownerRole = await roleId(t, owner.tenantId, 'OWNER');
    expect(
      (await as(t, owner).patch(`/v1/team/roles/${ownerRole}`, { permissions: [] })).status,
    ).toBe(403);
    expect(
      (await as(t, owner).patch(`/v1/team/members/${cashier.userId}`, { roleId: ownerRole }))
        .status,
    ).toBe(403);
    expect((await as(t, owner).delete(`/v1/team/roles/${ownerRole}`)).body.code).toBe(
      'BUSINESS_RULE_VIOLATION',
    );
  });

  it('a manager cannot change their own role or permissions, or switch themselves off', async () => {
    const { manager: mgr } = await manager();
    expect(
      (
        await as(t, mgr).patch(`/v1/team/members/${mgr.userId}`, {
          extraPermissions: ['settings.manage'],
        })
      ).status,
    ).toBe(403);
    expect((await as(t, mgr).post(`/v1/team/members/${mgr.userId}/disable`)).status).toBe(403);
  });

  it('a manager cannot hand out a permission they do not hold', async () => {
    const { manager: mgr, cashier } = await manager();
    // The Admin preset has no settings.manage, so a manager built on it cannot give it away.
    const giveSettings = await as(t, mgr).patch(`/v1/team/members/${cashier.userId}`, {
      extraPermissions: ['settings.manage'],
    });
    expect(giveSettings.status).toBe(403);
    expect(giveSettings.body.detail).toMatch(/Missing: settings\.manage/);
    const invite = await as(t, mgr).post('/v1/team/members', {
      email: newAddress('esc'),
      fullName: 'Escalated',
      roleId: await roleId(t, mgr.tenantId, 'CASHIER'),
      extraPermissions: ['settings.manage'],
    });
    expect(invite.status).toBe(403);
    // ...but can hand out what they hold.
    expect(
      (
        await as(t, mgr).patch(`/v1/team/members/${cashier.userId}`, {
          extraPermissions: ['stock.adjust'],
        })
      ).status,
    ).toBe(200);
  });

  it('a manager cannot make a role more powerful than themselves, or create one that is', async () => {
    const { manager: mgr } = await manager();
    const cashierRole = await roleId(t, mgr.tenantId, 'CASHIER');
    const grant = await as(t, mgr).patch(`/v1/team/roles/${cashierRole}`, {
      permissions: ['products.read', 'pos.sell', 'discount.apply', 'settings.manage'],
    });
    expect(grant.status).toBe(403);
    const create = await as(t, mgr).post('/v1/team/roles', {
      name: 'Super',
      permissions: ['settings.manage'],
    });
    expect(create.status).toBe(403);
    // Taking power away from a role is always fine.
    expect(
      (await as(t, mgr).patch(`/v1/team/roles/${cashierRole}`, { permissions: ['products.read'] }))
        .status,
    ).toBe(200);
  });

  it('a manager cannot give a bigger discount limit than their own, or access to every branch they lack', async () => {
    const owner = await createBusiness(t);
    const branch = await t.db.owner.branch.findFirstOrThrow({
      where: { tenantId: owner.tenantId },
    });
    // A manager limited to one branch with a 10% limit.
    const customRole = await as(t, owner).post('/v1/team/roles', {
      name: 'Branch manager',
      permissions: ['team.manage', 'pos.sell', 'discount.apply'],
      discountLimitBp: 1000,
      allBranches: false,
    });
    const mgr = await addTeamMember(
      t,
      owner,
      'CASHIER',
      { roleId: customRole.body.id, branchIds: [branch.id] },
      'bm',
    );
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    const biggerLimit = await as(t, mgr).patch(`/v1/team/members/${cashier.userId}`, {
      discountLimitBp: 3000,
    });
    expect(biggerLimit.status).toBe(403);
    expect(biggerLimit.body.detail).toMatch(/bigger discount limit/);
    expect(
      (await as(t, mgr).patch(`/v1/team/members/${cashier.userId}`, { discountLimitBp: 800 }))
        .status,
    ).toBe(200);
    const allBranchesRole = await as(t, mgr).post('/v1/team/roles', {
      name: 'Everywhere',
      permissions: ['pos.sell'],
      allBranches: true,
    });
    expect(allBranchesRole.status).toBe(403);
    expect(allBranchesRole.body.detail).toMatch(/every branch/);
  });

  it('the owner can hand out anything', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    const res = await as(t, owner).patch(`/v1/team/members/${cashier.userId}`, {
      extraPermissions: ['reports.profit', 'settings.manage'],
      discountLimitBp: 9000,
    });
    expect(res.status).toBe(200);
    expect(res.body.effective.permissions).toEqual(
      expect.arrayContaining(['reports.profit', 'settings.manage']),
    );
  });
});

describe('roles', () => {
  it('can be created, edited and deleted, with sensible refusals', async () => {
    const owner = await createBusiness(t);
    const created = await as(t, owner).post('/v1/team/roles', {
      name: 'Stock keeper',
      description: 'Counts stock',
      permissions: ['products.read', 'stock.adjust'],
      discountLimitBp: 0,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Stock keeper',
      systemKey: null,
      locked: false,
      memberCount: 0,
    });

    expect(
      (await as(t, owner).post('/v1/team/roles', { name: 'Stock keeper', permissions: [] })).body
        .code,
    ).toBe('CONFLICT');
    expect(
      (
        await as(t, owner).post('/v1/team/roles', {
          name: 'Odd',
          permissions: ['not.a.permission'],
        })
      ).status,
    ).toBe(400);

    const renamed = await as(t, owner).patch(`/v1/team/roles/${created.body.id}`, {
      name: 'Storeroom',
      permissions: ['products.read'],
    });
    expect(renamed.body).toMatchObject({ name: 'Storeroom', permissions: ['products.read'] });

    const adminRole = await roleId(t, owner.tenantId, 'ADMIN');
    expect(
      (await as(t, owner).patch(`/v1/team/roles/${adminRole}`, { name: 'Boss' })).body.code,
    ).toBe('BUSINESS_RULE_VIOLATION');
    expect(
      (await as(t, owner).patch(`/v1/team/roles/${adminRole}`, { discountLimitBp: 1500 })).body
        .discountLimitBp,
    ).toBe(1500);
    expect((await as(t, owner).delete(`/v1/team/roles/${adminRole}`)).body.code).toBe(
      'BUSINESS_RULE_VIOLATION',
    );

    await addTeamMember(t, owner, 'CASHIER', { roleId: created.body.id });
    expect((await as(t, owner).delete(`/v1/team/roles/${created.body.id}`)).body.code).toBe(
      'CONFLICT',
    );
    const empty = await as(t, owner).post('/v1/team/roles', { name: 'Temporary', permissions: [] });
    expect((await as(t, owner).delete(`/v1/team/roles/${empty.body.id}`)).status).toBe(204);
    expect(
      (await as(t, owner).get('/v1/team/roles')).body.roles.map((r: { name: string }) => r.name),
    ).not.toContain('Temporary');
  });

  it('lists the options for the team screen: roles, branches, the permission catalogue and seats', async () => {
    const owner = await createBusiness(t);
    const options = await as(t, owner).get('/v1/team/options');
    expect(options.status).toBe(200);
    expect(options.body.roles).toHaveLength(3);
    expect(options.body.branches).toEqual([{ id: expect.any(String), name: 'Main branch' }]);
    expect(options.body.seats).toEqual({ max: 25, used: 1 });
    const profit = options.body.permissions.find(
      (p: { key: string }) => p.key === 'reports.profit',
    );
    expect(profit).toMatchObject({ group: 'Reports', confidential: true });
  });
});

describe('branches', () => {
  it('assigns branches to a person, replaces them on update, and rejects branches of another business', async () => {
    const owner = await createBusiness(t);
    const other = await createBusiness(t);
    const main = await t.db.owner.branch.findFirstOrThrow({ where: { tenantId: owner.tenantId } });
    const second = await t.db.owner.branch.create({
      data: { tenantId: owner.tenantId, name: 'Andheri West', invoicePrefix: 'AW' },
    });
    const foreign = await t.db.owner.branch.findFirstOrThrow({
      where: { tenantId: other.tenantId },
    });

    const cashier = await addTeamMember(t, owner, 'CASHIER', { branchIds: [main.id] });
    let me = await as(t, cashier).get('/v1/auth/me');
    expect(me.body.access).toMatchObject({ allBranches: false, branchIds: [main.id] });

    const moved = await as(t, owner).patch(`/v1/team/members/${cashier.userId}`, {
      branchIds: [second.id],
    });
    expect(moved.body.branchIds).toEqual([second.id]);
    me = await as(t, cashier).get('/v1/auth/me');
    expect(me.body.access.branchIds).toEqual([second.id]);

    const bad = await as(t, owner).patch(`/v1/team/members/${cashier.userId}`, {
      branchIds: [foreign.id],
    });
    expect(bad.status).toBe(404);
    const admin = await addTeamMember(t, owner, 'ADMIN');
    expect((await as(t, admin).get('/v1/auth/me')).body.access).toMatchObject({
      allBranches: true,
    });
  });
});

describe('the approval PIN', () => {
  /** A business with an admin who has set a PIN, and a cashier who may ask for approval. */
  async function withApprover() {
    const owner = await createBusiness(t);
    const admin = await addTeamMember(t, owner, 'ADMIN');
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    const set = await as(t, admin).put('/v1/auth/pin', {
      currentPassword: STRONG_PASSWORD,
      pin: '804213',
    });
    expect(set.status).toBe(204);
    return { owner, admin, cashier };
  }

  it('is set with the password, stored only as a peppered hash, and never returned', async () => {
    const { owner, admin } = await withApprover();
    const row = await t.db.owner.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(row.pinHash).toMatch(/^v1:\$argon2id\$/);
    expect(row.pinHash).not.toContain('804213');
    const member = await as(t, owner).get(`/v1/team/members/${admin.userId}`);
    expect(member.body.hasPin).toBe(true);
    expect(JSON.stringify(member.body)).not.toMatch(/804213|argon2|pinHash/);
    expect(await auditActions(owner.tenantId)).toContain('auth.pin_set');
  });

  it('refuses a wrong password, obvious PINs and malformed PINs', async () => {
    const owner = await createBusiness(t);
    const admin = await addTeamMember(t, owner, 'ADMIN');
    expect(
      (await as(t, admin).put('/v1/auth/pin', { currentPassword: 'wrong', pin: '804213' })).body
        .code,
    ).toBe('INVALID_CREDENTIALS');
    for (const pin of ['123456', '000000', '654321']) {
      const res = await as(t, admin).put('/v1/auth/pin', { currentPassword: STRONG_PASSWORD, pin });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('pin');
    }
    for (const pin of ['12345', '1234567', 'abcdef', '12 345']) {
      expect(
        (await as(t, admin).put('/v1/auth/pin', { currentPassword: STRONG_PASSWORD, pin })).status,
      ).toBe(400);
    }
  });

  it('lets a cashier pick an approver and have their PIN checked', async () => {
    const { admin, cashier } = await withApprover();
    const approvers = await as(t, cashier).get('/v1/team/approvers');
    expect(approvers.body.approvers).toEqual([expect.objectContaining({ id: admin.userId })]);
    const ok = await as(t, cashier).post('/v1/team/approvals/verify-pin', {
      approverUserId: admin.userId,
      pin: '804213',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.approver).toMatchObject({ id: admin.userId });
  });

  it('answers the SAME for a wrong PIN, no PIN, an unknown person and someone who cannot approve', async () => {
    const { owner, admin, cashier } = await withApprover();
    const noPinAdmin = await addTeamMember(t, owner, 'ADMIN', {}, 'nopin');
    const otherCashier = await addTeamMember(t, owner, 'CASHIER', {}, 'cashier2');
    await as(t, otherCashier).put('/v1/auth/pin', {
      currentPassword: STRONG_PASSWORD,
      pin: '370419',
    }); // has a PIN, may not approve
    const attempts = [
      { approverUserId: admin.userId, pin: '111222' }, // wrong PIN
      { approverUserId: noPinAdmin.userId, pin: '804213' }, // no PIN set
      { approverUserId: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b', pin: '804213' }, // nobody
      { approverUserId: otherCashier.userId, pin: '370419' }, // right PIN, but cannot approve discounts
    ];
    const answers = [];
    for (const attempt of attempts)
      answers.push(await as(t, cashier).post('/v1/team/approvals/verify-pin', attempt));
    for (const res of answers) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_PIN');
      expect(res.body.detail).toBe(answers[0]!.body.detail);
    }
  });

  it('locks the PIN for the person guessing after 5 wrong tries, even for the right PIN, but not for others', async () => {
    const { owner, admin, cashier } = await withApprover();
    const guesser = cashier;
    const bystander = await addTeamMember(t, owner, 'CASHIER', {}, 'bystander');
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await as(t, guesser).post('/v1/team/approvals/verify-pin', {
            approverUserId: admin.userId,
            pin: '000999',
          })
        ).body.code,
      ).toBe('INVALID_PIN');
    }
    const locked = await as(t, guesser).post('/v1/team/approvals/verify-pin', {
      approverUserId: admin.userId,
      pin: '804213',
    });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBe('60');
    // A different cashier is not affected by someone else's guessing.
    expect(
      (
        await as(t, bystander).post('/v1/team/approvals/verify-pin', {
          approverUserId: admin.userId,
          pin: '804213',
        })
      ).status,
    ).toBe(200);
    t.clock.advanceSeconds(61);
    expect(
      (
        await as(t, guesser).post('/v1/team/approvals/verify-pin', {
          approverUserId: admin.userId,
          pin: '804213',
        })
      ).status,
    ).toBe(200);
  });

  it('records every check in the audit log, and removing the PIN stops approvals', async () => {
    const { owner, admin, cashier } = await withApprover();
    await as(t, cashier).post('/v1/team/approvals/verify-pin', {
      approverUserId: admin.userId,
      pin: '000999',
    });
    await as(t, cashier).post('/v1/team/approvals/verify-pin', {
      approverUserId: admin.userId,
      pin: '804213',
    });
    const clear = await as(t, admin).post('/v1/auth/pin/clear', {
      currentPassword: STRONG_PASSWORD,
    });
    expect(clear.status).toBe(204);
    expect(
      (
        await as(t, cashier).post('/v1/team/approvals/verify-pin', {
          approverUserId: admin.userId,
          pin: '804213',
        })
      ).body.code,
    ).toBe('INVALID_PIN');
    expect((await as(t, cashier).get('/v1/team/approvers')).body.approvers).toEqual([]);
    const actions = await auditActions(owner.tenantId);
    expect(actions).toEqual(
      expect.arrayContaining([
        'approval.pin_rejected',
        'approval.pin_verified',
        'auth.pin_cleared',
      ]),
    );
  });

  it('someone switched off, or without discount.approve, can no longer approve', async () => {
    const { owner, admin, cashier } = await withApprover();
    await as(t, owner).patch(`/v1/team/members/${admin.userId}`, {
      deniedPermissions: ['discount.approve'],
    });
    expect(
      (
        await as(t, cashier).post('/v1/team/approvals/verify-pin', {
          approverUserId: admin.userId,
          pin: '804213',
        })
      ).body.code,
    ).toBe('INVALID_PIN');
    await as(t, owner).patch(`/v1/team/members/${admin.userId}`, { deniedPermissions: [] });
    expect(
      (
        await as(t, cashier).post('/v1/team/approvals/verify-pin', {
          approverUserId: admin.userId,
          pin: '804213',
        })
      ).status,
    ).toBe(200);
    await as(t, owner).post(`/v1/team/members/${admin.userId}/disable`);
    expect(
      (
        await as(t, cashier).post('/v1/team/approvals/verify-pin', {
          approverUserId: admin.userId,
          pin: '804213',
        })
      ).body.code,
    ).toBe('INVALID_PIN');
  });
});

describe('businesses stay separate', () => {
  it("another business's people and roles look like they do not exist (404), and cannot be changed", async () => {
    const a = await createBusiness(t, 'Alpha Supplements');
    const b = await createBusiness(t, 'Beta Nutrition');
    const bCashier = await addTeamMember(t, b, 'CASHIER');
    const bRole = await roleId(t, b.tenantId, 'CASHIER');

    expect((await as(t, a).get(`/v1/team/members/${bCashier.userId}`)).status).toBe(404);
    expect(
      (
        await as(t, a).patch(`/v1/team/members/${bCashier.userId}`, {
          deniedPermissions: ['pos.sell'],
        })
      ).status,
    ).toBe(404);
    expect((await as(t, a).post(`/v1/team/members/${bCashier.userId}/disable`)).status).toBe(404);
    expect((await as(t, a).patch(`/v1/team/roles/${bRole}`, { permissions: [] })).status).toBe(404);
    expect((await as(t, a).delete(`/v1/team/roles/${bRole}`)).status).toBe(404);
    // A role of another business cannot be used for an invitation either.
    const useForeignRole = await as(t, a).post('/v1/team/members', {
      email: newAddress('x'),
      fullName: 'Cross Tenant',
      roleId: bRole,
    });
    expect(useForeignRole.status).toBe(404);

    // Each business lists only its own people.
    const listA = await as(t, a).get('/v1/team/members');
    expect(listA.body.members).toHaveLength(1);
    // Nothing was changed.
    expect(
      (await t.db.owner.user.findUniqueOrThrow({ where: { id: bCashier.userId } })).status,
    ).toBe('ACTIVE');
  });
});

describe('the audit trail of the team', () => {
  it('records invitations, changes, switching off and role edits, with no secrets in them', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    await as(t, owner).patch(`/v1/team/members/${cashier.userId}`, {
      extraPermissions: ['stock.adjust'],
    });
    await as(t, owner).post(`/v1/team/members/${cashier.userId}/disable`);
    const role = await as(t, owner).post('/v1/team/roles', {
      name: 'Audit role',
      permissions: ['products.read'],
    });
    await as(t, owner).patch(`/v1/team/roles/${role.body.id}`, {
      permissions: ['products.read', 'stock.adjust'],
    });
    await as(t, owner).delete(`/v1/team/roles/${role.body.id}`);

    const rows = await t.db.owner.auditLog.findMany({ where: { tenantId: owner.tenantId } });
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'team.member_invited',
        'team.invitation_accepted',
        'team.member_updated',
        'team.member_disabled',
        'team.role_created',
        'team.role_updated',
        'team.role_deleted',
      ]),
    );
    const updated = rows.find((r) => r.action === 'team.member_updated')!;
    expect(updated.metadata).toMatchObject({ added: 'stock.adjust' });
    expect(updated.actorUserId).toBe(owner.userId);
    expect(JSON.stringify(rows)).not.toMatch(/argon2|password|token|804213/i);
  });
});
