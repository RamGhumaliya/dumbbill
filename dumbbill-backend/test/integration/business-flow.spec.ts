import { gstinCheckCharacter } from '../../src/modules/business/domain/gstin';
import { AuthTestApp, createAuthTestApp } from '../support/auth-test-app';
import { addTeamMember, as, createBusiness, Person } from '../support/team-helpers';

/**
 * Business profile, branches and the first-steps checklist, end to end against the real application and a real
 * PostgreSQL database with row-level security. Each scenario is something an owner, a cashier or a curious
 * outsider could really do.
 */
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp();
  // A second plan so tests can have more than one branch (the test STARTER plan allows one).
  await t.db.owner.plan.create({
    data: { code: 'GROWTH', name: 'Growth', maxBranches: 3, maxUsers: 25, trialDays: 14 },
  });
});

afterAll(async () => {
  await t.close();
});

/** A GSTIN with a correct check character: state, PAN, entity digit, Z, check. */
function gstin(state: string, pan = 'AAPFU0939F'): string {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckCharacter(first14);
}

const PROFILE = {
  name: 'FitFuel Nutrition',
  stateCode: '27',
  gstin: gstin('27'),
  addressLine: '12, Ganesh Peth',
  city: 'Pune',
  pincode: '411002',
  phone: '+919822012345',
};

function branchBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Kothrud shop',
    invoicePrefix: 'KOT',
    printerWidthMm: 80,
    stateCode: '27',
    addressLine: '45, Paud Road',
    city: 'Pune',
    pincode: '411038',
    ...overrides,
  };
}

/** A business on the Growth plan (three branches). */
async function growthBusiness(): Promise<Person> {
  const owner = await createBusiness(t);
  const plan = await t.db.owner.plan.findUniqueOrThrow({ where: { code: 'GROWTH' } });
  await t.db.owner.tenant.update({ where: { id: owner.tenantId }, data: { planId: plan.id } });
  return owner;
}

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await t.db.owner.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.action);
}

describe('the business profile', () => {
  it('is saved by the owner and read back with the state name', async () => {
    const owner = await createBusiness(t);
    const saved = await as(t, owner).put('/v1/business', PROFILE);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      name: 'FitFuel Nutrition',
      gstin: PROFILE.gstin,
      stateCode: '27',
      stateName: 'Maharashtra',
      city: 'Pune',
    });
    const read = await as(t, owner).get('/v1/business');
    expect(read.body.gstin).toBe(PROFILE.gstin);
    expect(await auditActions(owner.tenantId)).toContain('business.profile_updated');
  });

  it('accepts no GSTIN at all (a shop that is not registered for GST)', async () => {
    const owner = await createBusiness(t);
    const res = await as(t, owner).put('/v1/business', { ...PROFILE, gstin: '' });
    expect(res.status).toBe(200);
    expect(res.body.gstin).toBeNull();
    const checklist = await as(t, owner).get('/v1/business/onboarding');
    expect(checklist.body.gstinMissing).toBe(true);
  });

  it('cleans up a pasted GSTIN (lower case, spaces)', async () => {
    const owner = await createBusiness(t);
    const messy = gstin('27')
      .toLowerCase()
      .replace(/^(.{2})(.{5})/, '$1 $2 ');
    const res = await as(t, owner).put('/v1/business', { ...PROFILE, gstin: messy });
    expect(res.status).toBe(200);
    expect(res.body.gstin).toBe(PROFILE.gstin);
  });

  it('names the GSTIN field when the check character is wrong', async () => {
    const owner = await createBusiness(t);
    const wrong = PROFILE.gstin.slice(0, 14) + (PROFILE.gstin.endsWith('V') ? 'W' : 'V');
    const res = await as(t, owner).put('/v1/business', { ...PROFILE, gstin: wrong });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('gstin');
    expect(res.body.errors[0].message).toMatch(/typing mistake/);
  });

  it('refuses a GSTIN whose state disagrees with the chosen state', async () => {
    const owner = await createBusiness(t);
    const res = await as(t, owner).put('/v1/business', { ...PROFILE, stateCode: '29' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('gstin');
  });

  it('refuses a state that is not a real GST state', async () => {
    const owner = await createBusiness(t);
    const res = await as(t, owner).put('/v1/business', { ...PROFILE, gstin: '', stateCode: '55' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('stateCode');
  });

  it('rejects fields the client must never set', async () => {
    const owner = await createBusiness(t);
    const res = await as(t, owner).put('/v1/business', { ...PROFILE, tenantId: 'x', logoKey: 'y' });
    expect(res.status).toBe(400);
  });

  it('can be read by a cashier but only changed with settings.manage', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    expect((await as(t, cashier).get('/v1/business')).status).toBe(200);
    const denied = await as(t, cashier).put('/v1/business', PROFILE);
    expect(denied.status).toBe(403);
    expect((await as(t, cashier).get('/v1/business/onboarding')).status).toBe(403);
  });

  it('lists the GST states for the picker', async () => {
    const owner = await createBusiness(t);
    const res = await as(t, owner).get('/v1/business/gst-states');
    expect(res.status).toBe(200);
    const codes = res.body.states.map((s: { code: string }) => s.code);
    expect(codes).toEqual(expect.arrayContaining(['27', '29', '07']));
  });

  it('does not let one business see or change another', async () => {
    const first = await createBusiness(t, 'First Shop');
    const second = await createBusiness(t, 'Second Shop');
    await as(t, first).put('/v1/business', PROFILE);
    const seen = await as(t, second).get('/v1/business');
    expect(seen.body.name).toBe('Second Shop');
    expect(seen.body.gstin).toBeNull();
  });
});

/** A real 1x1 PNG image. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('the logo', () => {
  const upload = (person: Person, data: Buffer, filename: string, contentType: string) =>
    t
      .http()
      .put('/v1/business/logo')
      .set('Authorization', `Bearer ${person.accessToken}`)
      .set('X-Forwarded-For', t.freshIp())
      .attach('file', data, { filename, contentType });

  it('is uploaded, shown to everyone in the business, and removed', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    expect((await as(t, cashier).get('/v1/business/logo')).status).toBe(404);

    const saved = await upload(owner, TINY_PNG, 'my logo.png', 'image/png');
    expect(saved.status).toBe(200);
    expect(saved.body.hasLogo).toBe(true);

    const download = await t
      .http()
      .get('/v1/business/logo')
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('X-Forwarded-For', t.freshIp())
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['cache-control']).toContain('private');
    expect((download.body as Buffer).equals(TINY_PNG)).toBe(true);

    expect((await as(t, owner).delete('/v1/business/logo')).status).toBe(204);
    expect((await as(t, owner).delete('/v1/business/logo')).status).toBe(204);
    expect((await as(t, owner).get('/v1/business/logo')).status).toBe(404);
    expect(await auditActions(owner.tenantId)).toEqual(
      expect.arrayContaining(['business.logo_changed', 'business.logo_removed']),
    );
  });

  it('refuses a file that only pretends to be an image, a type that is not an image, and no file', async () => {
    const owner = await createBusiness(t);
    const fake = await upload(
      owner,
      Buffer.from('<script>alert(1)</script>'),
      'logo.png',
      'image/png',
    );
    expect(fake.status).toBe(422);
    expect(fake.body.code).toBe('FILE_CONTENT_MISMATCH');
    const pdf = await upload(owner, Buffer.from('%PDF-1.4'), 'logo.pdf', 'application/pdf');
    expect(pdf.status).toBe(415);
    const none = await t
      .http()
      .put('/v1/business/logo')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('X-Forwarded-For', t.freshIp())
      .field('note', 'no file here');
    expect(none.status).toBe(400);
    expect((await as(t, owner).get('/v1/business')).body.hasLogo).toBe(false);
  });

  it('refuses a file over 2 MB', async () => {
    const owner = await createBusiness(t);
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    expect((await upload(owner, big, 'big.png', 'image/png')).status).toBe(413);
  });

  it('can be changed only with settings.manage, and each business sees only its own', async () => {
    const owner = await createBusiness(t);
    const cashier = await addTeamMember(t, owner, 'CASHIER');
    expect((await upload(cashier, TINY_PNG, 'a.png', 'image/png')).status).toBe(403);
    expect((await as(t, cashier).delete('/v1/business/logo')).status).toBe(403);

    await upload(owner, TINY_PNG, 'a.png', 'image/png');
    const other = await createBusiness(t);
    expect((await as(t, other).get('/v1/business/logo')).status).toBe(404);
    expect((await as(t, other).get('/v1/business')).body.hasLogo).toBe(false);
  });
});

describe('branches', () => {
  it('starts with one default branch that has a prefix', async () => {
    const owner = await createBusiness(t);
    const res = await as(t, owner).get('/v1/branches');
    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(1);
    expect(res.body.branches[0]).toMatchObject({
      name: 'Main branch',
      invoicePrefix: 'MAIN',
      printerWidthMm: 80,
    });
    expect(res.body.limit).toEqual({ max: 1, used: 1 });
  });

  it('refuses another branch when the plan limit is reached (and says so with a stable code)', async () => {
    const owner = await createBusiness(t);
    const res = await as(t, owner).post('/v1/branches', branchBody());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('creates, edits, switches off and on a branch, auditing each step', async () => {
    const owner = await growthBusiness();
    const created = await as(t, owner).post('/v1/branches', branchBody());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      invoicePrefix: 'KOT',
      stateName: 'Maharashtra',
      isActive: true,
    });
    const id = created.body.id;

    const edited = await as(t, owner).put(
      `/v1/branches/${id}`,
      branchBody({ printerWidthMm: 58, city: 'Pune West' }),
    );
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ printerWidthMm: 58, city: 'Pune West' });

    const off = await as(t, owner).post(`/v1/branches/${id}/deactivate`);
    expect(off.body.isActive).toBe(false);
    const list = await as(t, owner).get('/v1/branches');
    expect(list.body.limit).toEqual({ max: 3, used: 1 });

    const on = await as(t, owner).post(`/v1/branches/${id}/activate`);
    expect(on.body.isActive).toBe(true);

    expect(await auditActions(owner.tenantId)).toEqual(
      expect.arrayContaining([
        'branch.created',
        'branch.updated',
        'branch.deactivated',
        'branch.activated',
      ]),
    );
  });

  it('keeps invoice prefixes and names unique inside a business but not across businesses', async () => {
    const owner = await growthBusiness();
    expect((await as(t, owner).post('/v1/branches', branchBody())).status).toBe(201);
    const samePrefix = await as(t, owner).post('/v1/branches', branchBody({ name: 'Baner shop' }));
    expect(samePrefix.status).toBe(409);
    expect(samePrefix.body.code).toBe('CONFLICT');
    expect(samePrefix.body.errors[0].field).toBe('invoicePrefix');
    const sameName = await as(t, owner).post('/v1/branches', branchBody({ invoicePrefix: 'ZZ' }));
    expect(sameName.body.errors[0].field).toBe('name');

    const other = await growthBusiness();
    expect((await as(t, other).post('/v1/branches', branchBody())).status).toBe(201);
  });

  it('upper-cases and tidies the prefix, and rejects symbols', async () => {
    const owner = await growthBusiness();
    const ok = await as(t, owner).post('/v1/branches', branchBody({ invoicePrefix: ' kot ' }));
    expect(ok.body.invoicePrefix).toBe('KOT');
    const bad = await as(t, owner).post(
      '/v1/branches',
      branchBody({ name: 'Other', invoicePrefix: 'K-1' }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].field).toBe('invoicePrefix');
  });

  it('accepts only 58 or 80 mm receipt paper', async () => {
    const owner = await growthBusiness();
    const res = await as(t, owner).post('/v1/branches', branchBody({ printerWidthMm: 70 }));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('printerWidthMm');
  });

  it('checks a branch GSTIN: right state, valid check character, same PAN as the business', async () => {
    const owner = await growthBusiness();
    await as(t, owner).put('/v1/business', PROFILE);
    const good = await as(t, owner).post(
      '/v1/branches',
      branchBody({ stateCode: '29', gstin: gstin('29') }),
    );
    expect(good.status).toBe(201);
    const otherPan = await as(t, owner).post(
      '/v1/branches',
      branchBody({
        name: 'Goa',
        invoicePrefix: 'GOA',
        stateCode: '30',
        gstin: gstin('30', 'BBBBB1111B'),
      }),
    );
    expect(otherPan.status).toBe(400);
    expect(otherPan.body.errors[0].message).toMatch(/same PAN/);
    const wrongState = await as(t, owner).post(
      '/v1/branches',
      branchBody({ name: 'Goa', invoicePrefix: 'GOA', stateCode: '27', gstin: gstin('29') }),
    );
    expect(wrongState.status).toBe(400);
  });

  it('refuses a business GSTIN whose PAN contradicts a branch GSTIN already saved', async () => {
    const owner = await growthBusiness();
    await as(t, owner).put('/v1/business', PROFILE);
    await as(t, owner).post('/v1/branches', branchBody({ stateCode: '29', gstin: gstin('29') }));
    const res = await as(t, owner).put('/v1/business', {
      ...PROFILE,
      gstin: gstin('27', 'BBBBB1111B'),
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('never switches off the last active branch', async () => {
    const owner = await createBusiness(t);
    const [only] = (await as(t, owner).get('/v1/branches')).body.branches;
    const res = await as(t, owner).post(`/v1/branches/${only.id}/deactivate`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('does not let a switched-off branch be switched on beyond the plan limit', async () => {
    const owner = await growthBusiness();
    const ids: string[] = [];
    for (const [name, invoicePrefix] of [
      ['A', 'AA'],
      ['B', 'BB'],
    ] as const) {
      const res = await as(t, owner).post(
        '/v1/branches',
        branchBody({ name: `Shop ${name}`, invoicePrefix }),
      );
      ids.push(res.body.id);
    }
    await as(t, owner).post(`/v1/branches/${ids[0]}/deactivate`);
    // Back to three active only after reactivation; fill the freed place, then try to reactivate.
    await as(t, owner).post('/v1/branches', branchBody({ name: 'Shop C', invoicePrefix: 'CC' }));
    const res = await as(t, owner).post(`/v1/branches/${ids[0]}/activate`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('shows a cashier only the branches assigned to them and refuses the rest', async () => {
    const owner = await growthBusiness();
    const second = await as(t, owner).post('/v1/branches', branchBody());
    const [main] = (await as(t, owner).get('/v1/branches')).body.branches.filter(
      (b: { id: string }) => b.id !== second.body.id,
    );
    const cashier = await addTeamMember(t, owner, 'CASHIER', { branchIds: [main.id] });

    const list = await as(t, cashier).get('/v1/branches');
    expect(list.body.branches.map((b: { id: string }) => b.id)).toEqual([main.id]);
    expect((await as(t, cashier).get(`/v1/branches/${main.id}`)).status).toBe(200);
    const denied = await as(t, cashier).get(`/v1/branches/${second.body.id}`);
    expect(denied.status).toBe(403);
    expect(
      (await as(t, cashier).post('/v1/branches', branchBody({ name: 'X', invoicePrefix: 'X' })))
        .status,
    ).toBe(403);
    expect((await as(t, cashier).put(`/v1/branches/${main.id}`, branchBody())).status).toBe(403);
    expect((await as(t, cashier).post(`/v1/branches/${main.id}/deactivate`)).status).toBe(403);
  });

  it("answers 404 for another business's branch, for reading and for changing", async () => {
    const mine = await createBusiness(t);
    const theirs = await createBusiness(t);
    const [theirBranch] = (await as(t, theirs).get('/v1/branches')).body.branches;
    expect((await as(t, mine).get(`/v1/branches/${theirBranch.id}`)).status).toBe(404);
    expect((await as(t, mine).put(`/v1/branches/${theirBranch.id}`, branchBody())).status).toBe(
      404,
    );
    expect((await as(t, mine).post(`/v1/branches/${theirBranch.id}/deactivate`)).status).toBe(404);
    expect((await as(t, mine).post(`/v1/branches/${theirBranch.id}/activate`)).status).toBe(404);
  });
});

describe('the first-steps checklist', () => {
  it('turns each step done by doing the work', async () => {
    const owner = await growthBusiness();
    const steps = async (): Promise<Record<string, boolean>> => {
      const res = await as(t, owner).get('/v1/business/onboarding');
      return Object.fromEntries(
        res.body.steps.map((s: { key: string; done: boolean }) => [s.key, s.done]),
      );
    };
    expect(await steps()).toEqual({ PROFILE: false, BRANCH: false, TEAM: false });

    await as(t, owner).put('/v1/business', PROFILE);
    expect((await steps()).PROFILE).toBe(true);

    const [main] = (await as(t, owner).get('/v1/branches')).body.branches;
    await as(t, owner).put(
      `/v1/branches/${main.id}`,
      branchBody({ name: 'Main branch', invoicePrefix: 'MAIN' }),
    );
    expect((await steps()).BRANCH).toBe(true);

    await addTeamMember(t, owner, 'CASHIER');
    expect(await steps()).toEqual({ PROFILE: true, BRANCH: true, TEAM: true });
  });
});
