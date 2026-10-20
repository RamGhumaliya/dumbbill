/**
 * The demo catalogue: 200 realistic products for a protein and supplement shop in India, built the same way every
 * time (no random numbers) so every developer sees the same shelf.
 *
 * Where the numbers come from: names, pack sizes and approximate maximum retail prices (MRP) follow what Indian
 * retailers list for these brands in 2026; they are demo values, NOT a price list. HSN codes and GST rates follow the
 * category defaults in `prisma/seed/data/category-templates.ts` (supplements and accessories 18%, knitted apparel 5%) and
 * must be confirmed by the retailer's CA before real use. Money is in paise (Rs 1 = 100 paise).
 *
 * Owner of this data: the product owner. Changing a line here changes what `pnpm db:seed:shops` loads next time.
 */

/** The four starter categories every business gets (their names come from the category templates). */
export type DemoCategory =
  | 'Protein & whey'
  | 'Performance (creatine, pre-workout, BCAA)'
  | 'Vitamins & wellness'
  | 'Accessories (shakers, belts, gloves)'
  | 'Apparel';

/** One product ready to be created through the products service. */
export interface DemoProduct {
  name: string;
  brand: string;
  variant: string;
  category: DemoCategory;
  sku: string;
  /** EAN-13 barcode, Indian prefix 890, with a correct check digit. */
  barcode: string;
  /** Goods classification code printed on a tax invoice. */
  hsn: string;
  /** GST rate in basis points (1800 = 18.00%). */
  gstRateBp: number;
  mrpPaise: number;
  /** Selling price, never above the MRP. */
  pricePaise: number;
  /** What a typical purchase costs per unit; used to build purchase bills, never shown to cashiers. */
  typicalCostPaise: number;
}

/** A product family: one name sold in several sizes and flavours. */
interface Family {
  brand: string;
  name: string;
  category: DemoCategory;
  hsn: string;
  gstRateBp: number;
  /** Pack sizes with their MRP in whole rupees. */
  sizes: Array<{ label: string; mrp: number }>;
  /** Flavours or colours; empty means one unflavoured product per size. */
  flavours: string[];
}

const PROTEIN: Pick<Family, 'category' | 'hsn' | 'gstRateBp'> = {
  category: 'Protein & whey',
  hsn: '21069099',
  gstRateBp: 1800,
};
const PERFORMANCE: Pick<Family, 'category' | 'hsn' | 'gstRateBp'> = {
  category: 'Performance (creatine, pre-workout, BCAA)',
  hsn: '21069099',
  gstRateBp: 1800,
};
const WELLNESS: Pick<Family, 'category' | 'hsn' | 'gstRateBp'> = {
  category: 'Vitamins & wellness',
  hsn: '21069099',
  gstRateBp: 1800,
};
const ACCESSORY: Pick<Family, 'category' | 'hsn' | 'gstRateBp'> = {
  category: 'Accessories (shakers, belts, gloves)',
  hsn: '95069190',
  gstRateBp: 1800,
};
const APPAREL: Pick<Family, 'category' | 'hsn' | 'gstRateBp'> = {
  category: 'Apparel',
  hsn: '6109',
  gstRateBp: 500,
};

const WHEY_FLAVOURS = [
  'Double Rich Chocolate',
  'Vanilla Ice Cream',
  'Strawberry',
  'Cookies & Cream',
];
const SHIRT_SIZES = ['S', 'M', 'L', 'XL'];

const FAMILIES: Family[] = [
  // --- Protein & whey (about 70) ---
  {
    brand: 'Optimum Nutrition',
    name: 'Gold Standard 100% Whey',
    ...PROTEIN,
    sizes: [
      { label: '1 kg', mrp: 3999 },
      { label: '2 kg', mrp: 7499 },
      { label: '4.5 kg', mrp: 14999 },
    ],
    flavours: WHEY_FLAVOURS,
  },
  {
    brand: 'MuscleBlaze',
    name: 'Biozyme Performance Whey',
    ...PROTEIN,
    sizes: [
      { label: '1 kg', mrp: 3799 },
      { label: '2 kg', mrp: 6999 },
      { label: '4 kg', mrp: 12999 },
    ],
    flavours: ['Rich Chocolate', 'Café Mocha', 'Ice Cream Chocolate'],
  },
  {
    brand: 'MyProtein',
    name: 'Impact Whey Isolate',
    ...PROTEIN,
    sizes: [
      { label: '1 kg', mrp: 4999 },
      { label: '2.5 kg', mrp: 10999 },
    ],
    flavours: ['Chocolate Smooth', 'Vanilla', 'Salted Caramel'],
  },
  {
    brand: 'Avvatar',
    name: 'Whey Protein',
    ...PROTEIN,
    sizes: [
      { label: '1 kg', mrp: 2899 },
      { label: '2 kg', mrp: 5499 },
    ],
    flavours: ['Chocolate Fudge', 'Mango', 'Coffee'],
  },
  {
    brand: 'Dymatize',
    name: 'ISO100 Hydrolyzed',
    ...PROTEIN,
    sizes: [
      { label: '725 g', mrp: 5499 },
      { label: '2.2 kg', mrp: 12999 },
    ],
    flavours: ['Gourmet Chocolate', 'Fruity Pebbles'],
  },
  {
    brand: 'Oziva',
    name: 'Plant Protein',
    ...PROTEIN,
    sizes: [{ label: '1 kg', mrp: 3299 }],
    flavours: ['Chocolate', 'Coffee Caramel', 'Vanilla'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'Mass Gainer XXL',
    ...PROTEIN,
    sizes: [
      { label: '3 kg', mrp: 3999 },
      { label: '6.6 kg', mrp: 6799 },
    ],
    flavours: ['Chocolate', 'Banana', 'Vanilla'],
  },
  {
    brand: 'Optimum Nutrition',
    name: 'Serious Mass',
    ...PROTEIN,
    sizes: [
      { label: '2.7 kg', mrp: 4899 },
      { label: '5.4 kg', mrp: 8999 },
    ],
    flavours: ['Chocolate', 'Vanilla'],
  },
  {
    brand: 'MuscleTech',
    name: 'Mass-Tech Extreme 2000',
    ...PROTEIN,
    sizes: [{ label: '2.7 kg', mrp: 5299 }],
    flavours: ['Chocolate Milkshake', 'Vanilla Milkshake'],
  },
  {
    brand: 'GNC',
    name: 'Pro Performance Whey',
    ...PROTEIN,
    sizes: [
      { label: '2 lb', mrp: 4599 },
      { label: '5 lb', mrp: 9999 },
    ],
    flavours: ['Chocolate', 'Vanilla'],
  },
  {
    brand: 'Labrada',
    name: 'Lean Body Meal Replacement',
    ...PROTEIN,
    sizes: [{ label: '2.5 lb', mrp: 6499 }],
    flavours: ['Chocolate', 'Vanilla'],
  },
  {
    brand: 'Optimum Nutrition',
    name: 'Gold Standard 100% Casein',
    ...PROTEIN,
    sizes: [{ label: '1.8 kg', mrp: 6999 }],
    flavours: ['Chocolate Supreme', 'Creamy Vanilla'],
  },
  {
    brand: 'Nutrabay',
    name: 'Pure Whey Protein',
    ...PROTEIN,
    sizes: [
      { label: '1 kg', mrp: 2699 },
      { label: '2 kg', mrp: 4999 },
    ],
    flavours: ['Chocolate', 'Mocha', 'Malai Kulfi'],
  },
  {
    brand: 'Big Muscles',
    name: 'Nitro Whey',
    ...PROTEIN,
    sizes: [{ label: '1 kg', mrp: 2499 }],
    flavours: ['Chocolate', 'Vanilla'],
  },
  {
    brand: 'BSN',
    name: 'Syntha-6',
    ...PROTEIN,
    sizes: [{ label: '2.27 kg', mrp: 7999 }],
    flavours: ['Chocolate Milkshake', 'Vanilla Ice Cream'],
  },

  // --- Performance (about 45) ---
  {
    brand: 'MuscleBlaze',
    name: 'Creatine Monohydrate',
    ...PERFORMANCE,
    sizes: [
      { label: '100 g', mrp: 799 },
      { label: '250 g', mrp: 1599 },
      { label: '500 g', mrp: 2599 },
    ],
    flavours: [],
  },
  {
    brand: 'Optimum Nutrition',
    name: 'Micronized Creatine Powder',
    ...PERFORMANCE,
    sizes: [
      { label: '250 g', mrp: 1899 },
      { label: '600 g', mrp: 3999 },
    ],
    flavours: [],
  },
  {
    brand: 'Cellucor',
    name: 'C4 Original Pre-Workout',
    ...PERFORMANCE,
    sizes: [{ label: '30 servings', mrp: 3199 }],
    flavours: ['Icy Blue Razz', 'Fruit Punch', 'Watermelon'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'Wrathx Pre-Workout',
    ...PERFORMANCE,
    sizes: [{ label: '30 servings', mrp: 1999 }],
    flavours: ['Blue Raspberry', 'Green Apple', 'Fruit Punch'],
  },
  {
    brand: 'Scivation',
    name: 'Xtend BCAA',
    ...PERFORMANCE,
    sizes: [
      { label: '30 servings', mrp: 2899 },
      { label: '90 servings', mrp: 6499 },
    ],
    flavours: ['Watermelon', 'Blue Raspberry', 'Mango'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'BCAA 6000',
    ...PERFORMANCE,
    sizes: [{ label: '250 g', mrp: 1599 }],
    flavours: ['Orange', 'Cola', 'Watermelon'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'EAA Xtreme',
    ...PERFORMANCE,
    sizes: [{ label: '30 servings', mrp: 2299 }],
    flavours: ['Lemon Ice Tea', 'Fruit Punch'],
  },
  {
    brand: 'Optimum Nutrition',
    name: 'Glutamine Powder',
    ...PERFORMANCE,
    sizes: [
      { label: '300 g', mrp: 1799 },
      { label: '600 g', mrp: 2999 },
    ],
    flavours: [],
  },
  {
    brand: 'Avvatar',
    name: 'Beta Alanine',
    ...PERFORMANCE,
    sizes: [{ label: '250 g', mrp: 1299 }],
    flavours: [],
  },
  {
    brand: 'Fast&Up',
    name: 'Reload Electrolyte',
    ...PERFORMANCE,
    sizes: [{ label: '20 tablets', mrp: 599 }],
    flavours: ['Orange', 'Lemon Lime', 'Cola'],
  },
  {
    brand: 'Optimum Nutrition',
    name: 'Amino Energy',
    ...PERFORMANCE,
    sizes: [{ label: '30 servings', mrp: 2599 }],
    flavours: ['Green Apple', 'Fruit Fusion', 'Orange Cooler'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'Creatine Creapure',
    ...PERFORMANCE,
    sizes: [
      { label: '250 g', mrp: 2199 },
      { label: '500 g', mrp: 3799 },
    ],
    flavours: [],
  },
  {
    brand: 'Fast&Up',
    name: 'Charge Energy Drink',
    ...PERFORMANCE,
    sizes: [{ label: '10 tablets', mrp: 399 }],
    flavours: ['Lemon', 'Orange', 'Berry'],
  },
  {
    brand: 'Avvatar',
    name: 'Citrulline Malate',
    ...PERFORMANCE,
    sizes: [
      { label: '250 g', mrp: 1199 },
      { label: '500 g', mrp: 1999 },
    ],
    flavours: [],
  },
  {
    brand: 'MuscleBlaze',
    name: 'L-Carnitine Liquid',
    ...PERFORMANCE,
    sizes: [{ label: '450 ml', mrp: 1499 }],
    flavours: ['Orange', 'Lemon'],
  },

  // --- Vitamins & wellness (about 40) ---
  {
    brand: 'MuscleBlaze',
    name: 'MB-Vite Multivitamin',
    ...WELLNESS,
    sizes: [
      { label: '60 tablets', mrp: 599 },
      { label: '90 tablets', mrp: 849 },
    ],
    flavours: [],
  },
  {
    brand: 'Optimum Nutrition',
    name: 'Opti-Men Multivitamin',
    ...WELLNESS,
    sizes: [
      { label: '90 tablets', mrp: 2299 },
      { label: '150 tablets', mrp: 3399 },
    ],
    flavours: [],
  },
  {
    brand: 'Optimum Nutrition',
    name: 'Opti-Women Multivitamin',
    ...WELLNESS,
    sizes: [{ label: '60 capsules', mrp: 1799 }],
    flavours: [],
  },
  {
    brand: 'MuscleBlaze',
    name: 'Fish Oil Omega-3',
    ...WELLNESS,
    sizes: [
      { label: '60 capsules', mrp: 699 },
      { label: '90 capsules', mrp: 949 },
    ],
    flavours: [],
  },
  {
    brand: 'GNC',
    name: 'Triple Strength Fish Oil',
    ...WELLNESS,
    sizes: [{ label: '60 softgels', mrp: 1499 }],
    flavours: [],
  },
  {
    brand: 'HealthKart',
    name: 'HK Vitals Vitamin D3',
    ...WELLNESS,
    sizes: [{ label: '60 tablets', mrp: 449 }],
    flavours: [],
  },
  {
    brand: 'Himalaya',
    name: 'Ashvagandha',
    ...WELLNESS,
    sizes: [
      { label: '60 tablets', mrp: 195 },
      { label: '120 tablets', mrp: 349 },
    ],
    flavours: [],
  },
  {
    brand: 'MuscleBlaze',
    name: 'ZMA',
    ...WELLNESS,
    sizes: [{ label: '90 capsules', mrp: 899 }],
    flavours: [],
  },
  {
    brand: 'HealthKart',
    name: 'Biotin 10000 mcg',
    ...WELLNESS,
    sizes: [{ label: '90 tablets', mrp: 599 }],
    flavours: [],
  },
  {
    brand: 'Oziva',
    name: 'Protein & Herbs Women',
    ...WELLNESS,
    sizes: [{ label: '500 g', mrp: 1999 }],
    flavours: ['Chocolate', 'Coffee'],
  },
  {
    brand: 'Yogabar',
    name: 'Wholegrain Protein Bar',
    ...WELLNESS,
    sizes: [
      { label: 'Box of 6', mrp: 599 },
      { label: 'Box of 12', mrp: 1099 },
    ],
    flavours: ['Choco Almond', 'Peanut Butter', 'Cranberry'],
  },
  {
    brand: 'RiteBite',
    name: 'Max Protein Bar',
    ...WELLNESS,
    sizes: [{ label: 'Box of 6', mrp: 540 }],
    flavours: ['Choco Fudge', 'Peanut Butter'],
  },
  {
    brand: 'Pintola',
    name: 'All Natural Peanut Butter',
    ...WELLNESS,
    sizes: [
      { label: '510 g', mrp: 349 },
      { label: '1 kg', mrp: 599 },
    ],
    flavours: ['Creamy', 'Crunchy'],
  },
  {
    brand: 'Dr Reddys',
    name: 'Revital H Men',
    ...WELLNESS,
    sizes: [
      { label: '30 capsules', mrp: 325 },
      { label: '60 capsules', mrp: 599 },
    ],
    flavours: [],
  },
  {
    brand: 'HealthKart',
    name: 'HK Vitals Zinc',
    ...WELLNESS,
    sizes: [{ label: '60 tablets', mrp: 399 }],
    flavours: [],
  },
  {
    brand: 'Boldfit',
    name: 'Magnesium Citrate',
    ...WELLNESS,
    sizes: [{ label: '90 tablets', mrp: 549 }],
    flavours: [],
  },
  {
    brand: 'WOW Life Science',
    name: 'Vitamin C 1000 mg',
    ...WELLNESS,
    sizes: [
      { label: '60 tablets', mrp: 499 },
      { label: '120 tablets', mrp: 849 },
    ],
    flavours: [],
  },
  {
    brand: 'Oziva',
    name: 'Collagen Peptides',
    ...WELLNESS,
    sizes: [{ label: '200 g', mrp: 1699 }],
    flavours: ['Orange', 'Unflavoured'],
  },
  {
    brand: 'Dr. Morepen',
    name: 'Apple Cider Vinegar',
    ...WELLNESS,
    sizes: [{ label: '500 ml', mrp: 349 }],
    flavours: ['Original', 'Ginger'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'Joint Support Glucosamine',
    ...WELLNESS,
    sizes: [
      { label: '60 tablets', mrp: 749 },
      { label: '120 tablets', mrp: 1349 },
    ],
    flavours: [],
  },

  // --- Accessories (about 25) ---
  {
    brand: 'Boldfit',
    name: 'Gym Shaker',
    ...ACCESSORY,
    sizes: [{ label: '700 ml', mrp: 399 }],
    flavours: ['Black', 'Blue', 'Red', 'Grey'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'Shaker with Mixer Ball',
    ...ACCESSORY,
    sizes: [{ label: '600 ml', mrp: 349 }],
    flavours: ['Black', 'Neon'],
  },
  {
    brand: 'Boldfit',
    name: 'Weightlifting Gloves',
    ...ACCESSORY,
    sizes: [
      { label: 'M', mrp: 599 },
      { label: 'L', mrp: 599 },
    ],
    flavours: [],
  },
  {
    brand: 'Strauss',
    name: 'Leather Lifting Belt',
    ...ACCESSORY,
    sizes: [
      { label: 'M', mrp: 1499 },
      { label: 'L', mrp: 1499 },
      { label: 'XL', mrp: 1599 },
    ],
    flavours: [],
  },
  {
    brand: 'Boldfit',
    name: 'Resistance Band Set',
    ...ACCESSORY,
    sizes: [{ label: 'Set of 5', mrp: 699 }],
    flavours: [],
  },
  {
    brand: 'Strauss',
    name: 'Skipping Rope',
    ...ACCESSORY,
    sizes: [{ label: 'Adjustable', mrp: 299 }],
    flavours: ['Black', 'Blue'],
  },
  {
    brand: 'Boldfit',
    name: 'Wrist Wraps',
    ...ACCESSORY,
    sizes: [{ label: 'Pair', mrp: 449 }],
    flavours: [],
  },
  {
    brand: 'Nivia',
    name: 'Gym Duffel Bag',
    ...ACCESSORY,
    sizes: [{ label: '35 L', mrp: 1199 }],
    flavours: ['Black', 'Navy'],
  },
  {
    brand: 'Boldfit',
    name: 'Yoga Mat 6 mm',
    ...ACCESSORY,
    sizes: [{ label: '6 mm', mrp: 799 }],
    flavours: ['Purple', 'Green', 'Blue'],
  },
  {
    brand: 'Strauss',
    name: 'Rubber Hex Dumbbell',
    ...ACCESSORY,
    sizes: [
      { label: '5 kg pair', mrp: 1499 },
      { label: '10 kg pair', mrp: 2799 },
    ],
    flavours: [],
  },
  {
    brand: 'Boldfit',
    name: 'Hand Gripper',
    ...ACCESSORY,
    sizes: [{ label: 'Adjustable', mrp: 349 }],
    flavours: [],
  },
  {
    brand: 'Strauss',
    name: 'Ab Roller',
    ...ACCESSORY,
    sizes: [{ label: 'Standard', mrp: 599 }],
    flavours: [],
  },
  {
    brand: 'Boldfit',
    name: 'Foam Roller',
    ...ACCESSORY,
    sizes: [{ label: '45 cm', mrp: 899 }],
    flavours: [],
  },
  {
    brand: 'Nivia',
    name: 'Microfibre Gym Towel',
    ...ACCESSORY,
    sizes: [{ label: '40 x 80 cm', mrp: 299 }],
    flavours: ['Grey', 'Black'],
  },

  // --- Apparel (about 20) ---
  {
    brand: 'MuscleBlaze',
    name: 'Dry-Fit Training T-Shirt',
    ...APPAREL,
    sizes: SHIRT_SIZES.map((s) => ({ label: s, mrp: 899 })),
    flavours: ['Black', 'Charcoal'],
  },
  {
    brand: 'Gymshark',
    name: 'Arrival Tank',
    ...APPAREL,
    sizes: SHIRT_SIZES.map((s) => ({ label: s, mrp: 1799 })),
    flavours: ['Black'],
  },
  {
    brand: 'Boldfit',
    name: 'Gym Shorts',
    ...APPAREL,
    sizes: SHIRT_SIZES.map((s) => ({ label: s, mrp: 699 })),
    flavours: ['Black', 'Navy'],
  },
  {
    brand: 'MuscleBlaze',
    name: 'Zip Hoodie',
    ...APPAREL,
    sizes: SHIRT_SIZES.map((s) => ({ label: s, mrp: 1999 })),
    flavours: ['Black'],
  },
];

/** A small repeatable number generator (mulberry32) so "random-looking" prices are the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  const sum = [...first12].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10;
}

/** A valid Indian-prefix (890) EAN-13 barcode for the n-th product. */
export function demoBarcode(index: number): string {
  const first12 = `890${String(1_000_000 + index * 37).padStart(9, '0')}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

/**
 * The full demo catalogue, in a stable order.
 *
 * Selling price is the MRP less 5 to 12 percent (rounded to a whole rupee, never above the MRP); the typical purchase
 * cost is 66 to 74 percent of the selling price, so margins look like a real shop's (about 25 to 35 percent).
 */
export function buildDemoCatalogue(): DemoProduct[] {
  const random = seededRandom(20261021);
  const products: DemoProduct[] = [];
  for (const family of FAMILIES) {
    const flavours = family.flavours.length > 0 ? family.flavours : [''];
    for (const size of family.sizes) {
      for (const flavour of flavours) {
        const index = products.length + 1;
        const mrpPaise = size.mrp * 100;
        const discount = 0.05 + random() * 0.07;
        const pricePaise = Math.min(mrpPaise, Math.round((mrpPaise * (1 - discount)) / 100) * 100);
        const typicalCostPaise = Math.round((pricePaise * (0.66 + random() * 0.08)) / 100) * 100;
        products.push({
          name: family.name,
          brand: family.brand,
          variant: [size.label, flavour].filter(Boolean).join(' / '),
          category: family.category,
          sku: `DB-${String(index).padStart(4, '0')}`,
          barcode: demoBarcode(index),
          hsn: family.hsn,
          gstRateBp: family.gstRateBp,
          mrpPaise,
          pricePaise,
          typicalCostPaise,
        });
      }
    }
  }
  return products;
}
