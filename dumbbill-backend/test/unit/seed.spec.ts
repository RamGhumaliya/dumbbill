import { CATEGORY_TEMPLATES } from '../../prisma/seed/data/category-templates';
import { GST_STATES } from '../../prisma/seed/data/gst-states';
import { PLANS } from '../../prisma/seed/data/plans';
import { ALL_SEEDERS } from '../../prisma/seed/registry';
import { runSeeders } from '../../prisma/seed/runner';
import { checkSeedAllowed } from '../../prisma/seed/safety';
import { Seeder } from '../../prisma/seed/types';

/** These tests protect the seed DATA and the seed SAFETY rules. They need no database. */

describe('seed data', () => {
  it('has unique plan codes with limits that grow from Starter to Pro', () => {
    expect(new Set(PLANS.map((p) => p.code)).size).toBe(PLANS.length);
    const [starter, growth, pro] = PLANS;
    expect([starter?.maxBranches, growth?.maxBranches, pro?.maxBranches]).toEqual([1, 3, 10]);
    expect([starter?.maxUsers, growth?.maxUsers, pro?.maxUsers]).toEqual([3, 10, 30]);
    expect(PLANS.every((p) => p.trialDays === 14)).toBe(true);
  });

  it('never stores a price as a fractional number (paise must be whole bigint or null)', () => {
    for (const plan of PLANS) {
      for (const price of [plan.priceMonthlyPaise, plan.priceYearlyPaise]) {
        expect(price === null || typeof price === 'bigint').toBe(true);
      }
    }
  });

  it('has valid two-digit, unique GST state codes including Maharashtra and Gujarat', () => {
    const codes = GST_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^\d{2}$/.test(c))).toBe(true);
    expect(GST_STATES.find((s) => s.code === '27')?.name).toBe('Maharashtra');
    expect(GST_STATES.find((s) => s.code === '24')?.name).toBe('Gujarat');
    expect(codes).not.toContain('25'); // merged into 26 in 2020
  });

  it('has unique category codes, numeric HSN codes and sane GST rates', () => {
    expect(new Set(CATEGORY_TEMPLATES.map((c) => c.code)).size).toBe(CATEGORY_TEMPLATES.length);
    for (const category of CATEGORY_TEMPLATES) {
      expect(category.defaultHsn).toMatch(/^\d{4,8}$/);
      // Valid GST slabs are 0, 5, 12, 18 and 28 percent, stored in basis points.
      expect([0, 500, 1200, 1800, 2800]).toContain(category.defaultGstRateBp);
    }
  });

  it('covers the four category groups the owner asked for', () => {
    const names = CATEGORY_TEMPLATES.map((c) => c.name).join(' | ');
    expect(names).toMatch(/Protein/);
    expect(names).toMatch(/Performance/);
    expect(names).toMatch(/Vitamins/);
    expect(names).toMatch(/Accessories/);
    expect(names).toMatch(/Apparel/);
  });
});

describe('seed registry', () => {
  it('has unique seeder names and unique run order', () => {
    expect(new Set(ALL_SEEDERS.map((s) => s.name)).size).toBe(ALL_SEEDERS.length);
    expect(new Set(ALL_SEEDERS.map((s) => s.order)).size).toBe(ALL_SEEDERS.length);
  });
});

describe('seed safety rules', () => {
  const local = 'postgresql://u:p@localhost:5432/db';
  const remote = 'postgresql://u:p@db.example.com:5432/db';

  it('always allows reference data, even in production on a remote database', () => {
    expect(
      checkSeedAllowed('reference', { NODE_ENV: 'production', DATABASE_URL: remote }, false),
    ).toBeNull();
  });

  it('allows demo data on a local development database', () => {
    expect(
      checkSeedAllowed('demo', { NODE_ENV: 'development', DATABASE_URL: local }, false),
    ).toBeNull();
    expect(checkSeedAllowed('demo', { DATABASE_URL: local }, false)).toBeNull(); // NODE_ENV unset
  });

  it('refuses demo data in production, even on a local host and even with --allow-remote', () => {
    expect(
      checkSeedAllowed('demo', { NODE_ENV: 'production', DATABASE_URL: local }, false),
    ).toMatch(/production/);
    expect(checkSeedAllowed('demo', { NODE_ENV: 'production', DATABASE_URL: local }, true)).toMatch(
      /production/,
    );
  });

  it('refuses demo data on a remote database unless explicitly allowed', () => {
    expect(
      checkSeedAllowed('demo', { NODE_ENV: 'development', DATABASE_URL: remote }, false),
    ).toMatch(/local/);
    expect(
      checkSeedAllowed('demo', { NODE_ENV: 'development', DATABASE_URL: remote }, true),
    ).toBeNull();
  });

  it('refuses demo data when the app connection is remote even though the owner connection is local', () => {
    // The loader writes through APP_DATABASE_URL, so that is the address that must be checked too.
    expect(
      checkSeedAllowed(
        'demo',
        { NODE_ENV: 'development', DATABASE_URL: local, APP_DATABASE_URL: remote },
        false,
      ),
    ).toMatch(/local/);
    expect(
      checkSeedAllowed(
        'demo',
        { NODE_ENV: 'development', DATABASE_URL: local, APP_DATABASE_URL: local },
        false,
      ),
    ).toBeNull();
  });

  it('refuses demo data when the database address cannot be read', () => {
    expect(
      checkSeedAllowed('demo', { NODE_ENV: 'development', DATABASE_URL: 'not a url' }, false),
    ).toMatch(/unknown/);
  });
});

describe('seed runner', () => {
  const fakePrisma = {} as never;
  const lines: string[] = [];
  const make = (name: string, group: Seeder['group'], order: number, ran: string[]): Seeder => ({
    name,
    group,
    order,
    run: async () => {
      ran.push(name);
      return { created: 1, updated: 0 };
    },
  });
  const baseOptions = {
    allowRemote: false,
    env: { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' },
    log: (l: string) => lines.push(l),
  };

  it('runs only the selected groups, in order', async () => {
    const ran: string[] = [];
    const seeders = [
      make('b', 'reference', 2, ran),
      make('a', 'reference', 1, ran),
      make('d', 'demo', 3, ran),
    ];
    // Real registry sorts by order; the runner trusts the order it is given, so sort here like the registry does.
    const sorted = [...seeders].sort((x, y) => x.order - y.order);
    await runSeeders(fakePrisma, sorted, { ...baseOptions, groups: ['reference'] });
    expect(ran).toEqual(['a', 'b']);
  });

  it('refuses to run anything when a demo group is not allowed, leaving no partial data', async () => {
    const ran: string[] = [];
    const seeders = [make('ref', 'reference', 1, ran), make('demo', 'demo', 2, ran)];
    await expect(
      runSeeders(fakePrisma, seeders, {
        ...baseOptions,
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost/db' },
        groups: ['reference', 'demo'],
      }),
    ).rejects.toThrow(/Refusing to seed "demo"/);
    expect(ran).toEqual([]); // even the reference seeder did not run
  });

  it('refuses a requested demo group in production even when it has no seeders yet', async () => {
    await expect(
      runSeeders(fakePrisma, [make('ref', 'reference', 1, [])], {
        ...baseOptions,
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost/db' },
        groups: ['reference', 'demo'],
      }),
    ).rejects.toThrow(/Refusing to seed "demo"/);
  });

  it('explains available names when --only does not match', async () => {
    await expect(
      runSeeders(fakePrisma, [make('plans', 'reference', 1, [])], {
        ...baseOptions,
        groups: ['reference'],
        only: 'nope',
      }),
    ).rejects.toThrow(/Available: plans/);
  });
});
