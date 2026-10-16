import { categoryTemplatesSeeder, gstStatesSeeder, plansSeeder } from './seeders/reference.seeders';
import { Seeder } from './types';

/**
 * The list of every seeder. To add seed data for a new table:
 *   1. Put the raw data in prisma/seed/data/<thing>.ts (typed, with comments explaining where it came from).
 *   2. Write a Seeder (see types.ts for the rules) in prisma/seed/seeders/.
 *   3. Add it to the right list below.
 *
 * Demo data (fake shops, products, sales) is added from Phase 1, once the tables for
 * businesses, products and invoices exist. The group and the safety checks are already in place.
 */
const referenceSeeders: Seeder[] = [plansSeeder, gstStatesSeeder, categoryTemplatesSeeder];

const demoSeeders: Seeder[] = [];

export const ALL_SEEDERS: readonly Seeder[] = [...referenceSeeders, ...demoSeeders].sort(
  (a, b) => a.order - b.order,
);
