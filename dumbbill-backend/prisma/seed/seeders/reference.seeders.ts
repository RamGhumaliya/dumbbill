import { CATEGORY_TEMPLATES } from '../data/category-templates';
import { GST_STATES } from '../data/gst-states';
import { PLANS } from '../data/plans';
import { Seeder } from '../types';

/**
 * Reference-data seeders: one per table, each using upsert so they are safe to repeat.
 *
 * "created vs updated" is worked out by checking which keys already exist before the upsert.
 * Editing a value in the data files and re-running the seed updates the row in place.
 */

export const plansSeeder: Seeder = {
  name: 'plans',
  group: 'reference',
  order: 10,
  async run(prisma) {
    const existing = new Set(
      (await prisma.plan.findMany({ select: { code: true } })).map((p) => p.code),
    );
    for (const plan of PLANS) {
      // Only seed-owned columns are written. `isActive` is not touched on update, so an owner
      // who deactivated a plan in the admin screen keeps that choice after a re-seed.
      await prisma.plan.upsert({
        where: { code: plan.code },
        create: plan,
        update: {
          name: plan.name,
          maxBranches: plan.maxBranches,
          maxUsers: plan.maxUsers,
          trialDays: plan.trialDays,
          priceMonthlyPaise: plan.priceMonthlyPaise,
          priceYearlyPaise: plan.priceYearlyPaise,
          sortOrder: plan.sortOrder,
        },
      });
    }
    const created = PLANS.filter((p) => !existing.has(p.code)).length;
    return { created, updated: PLANS.length - created };
  },
};

export const gstStatesSeeder: Seeder = {
  name: 'gst-states',
  group: 'reference',
  order: 20,
  async run(prisma) {
    const existing = new Set(
      (await prisma.gstState.findMany({ select: { code: true } })).map((s) => s.code),
    );
    for (const state of GST_STATES) {
      await prisma.gstState.upsert({ where: { code: state.code }, create: state, update: state });
    }
    const created = GST_STATES.filter((s) => !existing.has(s.code)).length;
    return { created, updated: GST_STATES.length - created };
  },
};

export const categoryTemplatesSeeder: Seeder = {
  name: 'category-templates',
  group: 'reference',
  order: 30,
  async run(prisma) {
    const existing = new Set(
      (await prisma.categoryTemplate.findMany({ select: { code: true } })).map((c) => c.code),
    );
    for (const template of CATEGORY_TEMPLATES) {
      await prisma.categoryTemplate.upsert({
        where: { code: template.code },
        create: template,
        update: template,
      });
    }
    const created = CATEGORY_TEMPLATES.filter((c) => !existing.has(c.code)).length;
    return { created, updated: CATEGORY_TEMPLATES.length - created };
  },
};
