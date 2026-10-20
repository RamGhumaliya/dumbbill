import { CATEGORY_TEMPLATES } from '../../prisma/seed/data/category-templates';
import { checkGstin } from '../../src/modules/business/domain/gstin';
import { isAllowedGstRate } from '../../src/modules/catalogue/domain/gst-rates';
import { productFieldErrors } from '../../src/modules/catalogue/domain/product-rules';
import { buildDemoCatalogue, ean13CheckDigit } from '../../src/demo/demo-catalogue';
import { DEMO_SHOPS, demoGstin } from '../../src/demo/demo-shops';

/**
 * The demo data must be something the product itself would accept. If a rule tightens (a new GST slab list, a stricter
 * barcode check), these tests fail and the demo data is fixed in the same change, instead of the seed breaking later on
 * someone's machine.
 */
describe('the demo catalogue', () => {
  const catalogue = buildDemoCatalogue();

  it('has exactly 200 products and is the same every time', () => {
    expect(catalogue).toHaveLength(200);
    expect(buildDemoCatalogue()).toEqual(catalogue);
  });

  it('gives every product its own barcode and SKU, and a name+brand+variant nobody else has', () => {
    expect(new Set(catalogue.map((p) => p.barcode)).size).toBe(200);
    expect(new Set(catalogue.map((p) => p.sku)).size).toBe(200);
    const identities = catalogue.map((p) => `${p.name}|${p.brand}|${p.variant}`.toLowerCase());
    expect(new Set(identities).size).toBe(200);
  });

  it('uses real EAN-13 barcodes with the Indian 890 prefix and a correct check digit', () => {
    for (const product of catalogue) {
      expect(product.barcode).toMatch(/^890[0-9]{10}$/);
      expect(Number(product.barcode[12])).toBe(ean13CheckDigit(product.barcode.slice(0, 12)));
    }
  });

  it('passes the same product rules as a product entered by hand (HSN, GST slab, shape)', () => {
    for (const product of catalogue) {
      expect(isAllowedGstRate(product.gstRateBp)).toBe(true);
      expect(
        productFieldErrors(
          {
            name: product.name,
            brand: product.brand,
            variant: product.variant,
            sku: product.sku,
            barcode: product.barcode,
            hsn: product.hsn,
            gstRateBp: product.gstRateBp,
          },
          true,
        ),
      ).toEqual([]);
    }
  });

  it('prices are sane: whole rupees, price never above MRP, cost below price (a shop that makes a margin)', () => {
    for (const product of catalogue) {
      expect(product.mrpPaise % 100).toBe(0);
      expect(product.pricePaise % 100).toBe(0);
      expect(product.pricePaise).toBeLessThanOrEqual(product.mrpPaise);
      expect(product.typicalCostPaise).toBeGreaterThan(0);
      expect(product.typicalCostPaise).toBeLessThan(product.pricePaise);
    }
  });

  it('spreads products over the four starter categories plus apparel, with mixed GST rates', () => {
    const names = new Set(CATEGORY_TEMPLATES.map((template) => template.name));
    for (const product of catalogue) expect(names.has(product.category)).toBe(true);
    expect(new Set(catalogue.map((p) => p.category)).size).toBe(5);
    expect(new Set(catalogue.map((p) => p.gstRateBp)).size).toBeGreaterThanOrEqual(2);
  });
});

describe('the demo businesses', () => {
  it('are three, each with two branches that have different invoice prefixes', () => {
    expect(DEMO_SHOPS).toHaveLength(3);
    for (const shop of DEMO_SHOPS)
      expect(new Set(shop.branches.map((branch) => branch.prefix)).size).toBe(2);
  });

  it('have GSTINs that pass the product checks, in the right state, with the shop PAN', () => {
    for (const shop of DEMO_SHOPS) {
      for (const entity of [1, 2, 3]) {
        const result = checkGstin(demoGstin(shop.stateCode, shop.pan, entity));
        expect(result).toMatchObject({ valid: true, stateCode: shop.stateCode, pan: shop.pan });
      }
    }
  });

  it('use reserved .test e-mail domains, so no demo address can ever receive real mail', () => {
    for (const shop of DEMO_SHOPS) expect(shop.emailDomain.endsWith('.test')).toBe(true);
  });
});
