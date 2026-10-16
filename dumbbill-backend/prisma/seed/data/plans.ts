/**
 * Subscription plans.
 *
 * Limits come from the owner's decision on 16 Oct 2026: Starter 1 branch / 3 users,
 * Growth 3 / 10, Pro 10 / 30, with a 14-day free trial.
 *
 * Prices are intentionally null: the owner has not set pricing yet. When decided, put the
 * amounts here in PAISE (Rs 999 = 99900) and run `pnpm db:seed`. Plans are updated in place.
 */
export interface PlanSeed {
  code: string;
  name: string;
  maxBranches: number;
  maxUsers: number;
  trialDays: number;
  priceMonthlyPaise: bigint | null;
  priceYearlyPaise: bigint | null;
  sortOrder: number;
}

export const PLANS: readonly PlanSeed[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    maxBranches: 1,
    maxUsers: 3,
    trialDays: 14,
    priceMonthlyPaise: null,
    priceYearlyPaise: null,
    sortOrder: 1,
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    maxBranches: 3,
    maxUsers: 10,
    trialDays: 14,
    priceMonthlyPaise: null,
    priceYearlyPaise: null,
    sortOrder: 2,
  },
  {
    code: 'PRO',
    name: 'Pro',
    maxBranches: 10,
    maxUsers: 30,
    trialDays: 14,
    priceMonthlyPaise: null,
    priceYearlyPaise: null,
    sortOrder: 3,
  },
];
