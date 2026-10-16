/**
 * Starter categories copied into every new business.
 *
 * Categories chosen by the owner on 16 Oct 2026:
 * protein & whey, performance, vitamins & wellness, accessories & apparel.
 *
 * IMPORTANT: the HSN codes and GST rates below are SUGGESTED DEFAULTS, not tax advice.
 * GST rates change, and the right HSN/rate depends on the exact product (for example some
 * vitamins are classified as medicines, and apparel rates depend on the price slab).
 * They MUST be confirmed by the CA who reviews the invoice format (planned before the end of Phase 2).
 * Retailers can also override them per product.
 *
 * Rates are in basis points: 1800 = 18.00%, 500 = 5.00%.
 */
export interface CategoryTemplateSeed {
  code: string;
  name: string;
  defaultHsn: string;
  defaultGstRateBp: number;
  sortOrder: number;
}

export const CATEGORY_TEMPLATES: readonly CategoryTemplateSeed[] = [
  // 2106 90 99: "food preparations not elsewhere specified", where most protein powders are classified.
  {
    code: 'PROTEIN_WHEY',
    name: 'Protein & whey',
    defaultHsn: '21069099',
    defaultGstRateBp: 1800,
    sortOrder: 1,
  },
  {
    code: 'PERFORMANCE',
    name: 'Performance (creatine, pre-workout, BCAA)',
    defaultHsn: '21069099',
    defaultGstRateBp: 1800,
    sortOrder: 2,
  },
  // Some vitamin products may fall under medicaments (HSN 3004) with a different rate. CA to confirm.
  {
    code: 'VITAMINS_WELLNESS',
    name: 'Vitamins & wellness',
    defaultHsn: '21069099',
    defaultGstRateBp: 1800,
    sortOrder: 3,
  },
  // 9506 91: general physical-exercise and gym equipment and accessories.
  {
    code: 'ACCESSORIES',
    name: 'Accessories (shakers, belts, gloves)',
    defaultHsn: '95069190',
    defaultGstRateBp: 1800,
    sortOrder: 4,
  },
  // 6109: T-shirts and similar knitted apparel. Rate depends on the price slab. CA to confirm.
  { code: 'APPAREL', name: 'Apparel', defaultHsn: '6109', defaultGstRateBp: 500, sortOrder: 5 },
];
