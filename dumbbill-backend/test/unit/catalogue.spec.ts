import sharp from 'sharp';
import { CsvFormatError, parseCsv } from '../../src/modules/catalogue/domain/csv';
import {
  ALLOWED_GST_RATES_BP,
  isAllowedGstRate,
  percentToBasisPoints,
} from '../../src/modules/catalogue/domain/gst-rates';
import {
  MAX_IMPORT_ROWS,
  parseProductImport,
} from '../../src/modules/catalogue/domain/import-parser';
import { MAX_PAISE, rupeesToPaise } from '../../src/modules/catalogue/domain/money';
import {
  marginBp,
  priceErrors,
  productFieldErrors,
} from '../../src/modules/catalogue/domain/product-rules';
import { makeProductImages } from '../../src/modules/catalogue/images/product-images';
import { StorageValidationError } from '../../src/modules/storage/storage.types';

/**
 * The catalogue rules that need no database. They protect what lands on invoices: money is read without decimal
 * arithmetic, a tax rate must come from the allowed list, and a spreadsheet's mistakes are reported row by row.
 */

describe('rupeesToPaise', () => {
  it.each([
    ['1499', 149_900],
    ['1499.5', 149_950],
    ['1499.50', 149_950],
    ['0.05', 5],
    ['1,24,500.00', 12_450_000],
    ['₹ 299', 29_900],
    ['Rs. 99.9', 9_990],
  ])('reads %s as %i paise', (text, paise) => {
    expect(rupeesToPaise(text)).toBe(paise);
  });

  it('is exact where decimal arithmetic is not (0.1 + 0.2 style amounts)', () => {
    // 19.99 * 100 is 1998.9999999999998 in floating point; reading the digits as text gives the right answer.
    expect(rupeesToPaise('19.99')).toBe(1_999);
    expect(rupeesToPaise('1.15')).toBe(115);
  });

  it.each(['', 'abc', '-5', '1.234', '1..5', '12.', '1e5', '10000000000'])('refuses %j', (text) => {
    expect(rupeesToPaise(text)).toBeNull();
  });

  it('refuses an amount above the Rs 1 crore guard', () => {
    expect(rupeesToPaise('10000000')).toBe(MAX_PAISE);
    expect(rupeesToPaise('10000001')).toBeNull();
  });
});

describe('GST rates', () => {
  it('allows only the listed slabs', () => {
    expect(ALLOWED_GST_RATES_BP).toEqual([0, 25, 300, 500, 1800, 4000]);
    expect(isAllowedGstRate(1800)).toBe(true);
    expect(isAllowedGstRate(180)).toBe(false);
    expect(isAllowedGstRate(2800)).toBe(false);
  });

  it.each([
    ['18', 1800],
    ['18%', 1800],
    ['5.0', 500],
    ['0.25', 25],
    ['0', 0],
  ])('reads the percentage %s as %i basis points', (text, bp) => {
    expect(percentToBasisPoints(text)).toBe(bp);
  });

  it.each(['', 'eighteen', '-5', '18.123'])('refuses the percentage %j', (text) => {
    expect(percentToBasisPoints(text)).toBeNull();
  });
});

describe('parseCsv', () => {
  it('reads quoted values with commas, quotes and line breaks inside', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('accepts Windows line ends and the Excel byte-order mark, and skips blank lines', () => {
    expect(parseCsv('﻿name,price\r\nWhey,100\r\n\r\nBar,20\r\n')).toEqual([
      ['name', 'price'],
      ['Whey', '100'],
      ['Bar', '20'],
    ]);
  });

  it('keeps empty cells and trims spaces around plain values', () => {
    expect(parseCsv(' a , ,c')).toEqual([['a', '', 'c']]);
  });

  it('refuses a quote that is never closed instead of swallowing the rest of the file', () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(CsvFormatError);
  });
});

describe('productFieldErrors', () => {
  const fine = {
    name: 'Whey',
    brand: 'ON',
    variant: '2 kg',
    sku: 'ON-2KG',
    barcode: '748927052145',
    hsn: '21069099',
    gstRateBp: 1800,
  };

  it('accepts a complete product, registered for GST or not', () => {
    expect(productFieldErrors(fine, true)).toEqual([]);
    expect(productFieldErrors(fine, false)).toEqual([]);
  });

  it('requires HSN and GST rate only when the business has a GSTIN', () => {
    const bare = { ...fine, hsn: null, gstRateBp: null };
    expect(productFieldErrors(bare, false)).toEqual([]);
    expect(
      productFieldErrors(bare, true)
        .map((e) => e.field)
        .sort(),
    ).toEqual(['gstRateBp', 'hsn']);
  });

  it('refuses a wrongly shaped HSN, barcode and SKU, and a rate that is not a real slab', () => {
    const fields = productFieldErrors(
      { ...fine, hsn: '2106', sku: 'bad*sku', barcode: 'a b', gstRateBp: 1200 },
      false,
    ).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['sku', 'barcode', 'gstRateBp']));
    expect(productFieldErrors({ ...fine, hsn: '210' }, false).map((e) => e.field)).toEqual(['hsn']);
    // 4, 6 and 8 digit HSN codes are all valid.
    for (const hsn of ['2106', '210690', '21069099'])
      expect(productFieldErrors({ ...fine, hsn }, false)).toEqual([]);
  });
});

describe('priceErrors and marginBp', () => {
  it('accepts a price at or below the MRP', () => {
    expect(priceErrors(349_900, 299_900)).toEqual([]);
    expect(priceErrors(349_900, 349_900)).toEqual([]);
  });

  it('refuses a price above the MRP (selling above MRP is illegal in India), zero and fractions', () => {
    expect(priceErrors(100, 101)[0]?.field).toBe('pricePaise');
    expect(priceErrors(0, 0).map((e) => e.field)).toEqual(['mrpPaise', 'pricePaise']);
    expect(priceErrors(100.5, 50)[0]?.field).toBe('mrpPaise');
  });

  it('computes margin as a share of the price, in basis points', () => {
    expect(marginBp(1_000, 750)).toBe(2_500);
    expect(marginBp(1_000, 1_200)).toBe(-2_000);
    expect(marginBp(0, 10)).toBeNull();
  });
});

describe('parseProductImport', () => {
  const header = 'name,brand,category,variant,sku,barcode,hsn,gst_percent,mrp,price,cost';

  it('reads good rows into drafts with money in paise and the rate in basis points', () => {
    const result = parseProductImport(
      `${header}\nWhey,ON,Protein,2 kg,S1,111111,21069099,18,3499,2999.50,2400`,
      true,
    );
    expect(result.fileErrors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      errors: [],
      draft: {
        name: 'Whey',
        categoryName: 'Protein',
        mrpPaise: 349_900,
        pricePaise: 299_950,
        purchaseCostPaise: 240_000,
        gstRateBp: 1800,
        hsn: '21069099',
      },
    });
  });

  it('accepts columns in any order and in any letter case, and notes columns it does not use', () => {
    const result = parseProductImport('PRICE,Name,MRP,Colour\n99,Bar,120,Red', false);
    expect(result.rows[0]?.draft).toMatchObject({
      name: 'Bar',
      pricePaise: 9_900,
      mrpPaise: 12_000,
    });
    expect(result.ignoredColumns).toEqual(['colour']);
  });

  it('refuses a file with no name, mrp or price column, or with no rows', () => {
    expect(parseProductImport('brand\nON', false).fileErrors).toHaveLength(3);
    expect(parseProductImport('name,mrp,price', false).fileErrors).toEqual([
      'The file has no product rows.',
    ]);
  });

  it('reports every problem of every bad row, with the spreadsheet row number', () => {
    const result = parseProductImport(
      [header, 'Whey,ON,,,,,,18,abc,100,', 'Bar,,,,,,,,50,60,', 'Good,,,,,,,,50,40,'].join('\n'),
      false,
    );
    const [first, second, third] = result.rows;
    expect(first?.rowNumber).toBe(2);
    expect(first?.errors.map((e) => e.field)).toEqual(['mrp']);
    expect(second?.errors).toEqual([
      { field: 'price', message: 'The selling price cannot be higher than the MRP.' },
    ]);
    expect(third?.errors).toEqual([]);
    expect(third?.draft).toBeDefined();
    expect(first?.draft).toBeUndefined();
  });

  it('requires HSN and GST rate on every row when the business has a GSTIN', () => {
    const result = parseProductImport(`${header}\nWhey,,,,,,,,100,90,`, true);
    expect(result.rows[0]?.errors.map((e) => e.field).sort()).toEqual(['gst_percent', 'hsn']);
  });

  it('refuses a barcode, SKU or product that appears twice in the file (the later row fails)', () => {
    const result = parseProductImport(
      [
        header,
        'Aa,,,,sku1,111,,,10,9,',
        'Bb,,,,SKU1,222,,,10,9,',
        'Cc,,,,,111,,,10,9,',
        'aa,,,,,333,,,10,9,',
      ].join('\n'),
      false,
    );
    expect(result.rows[0]?.errors).toEqual([]);
    expect(result.rows[1]?.errors).toEqual([
      { field: 'sku', message: 'Same SKU as row 2 in this file.' },
    ]);
    expect(result.rows[2]?.errors).toEqual([
      { field: 'barcode', message: 'Same barcode as row 2 in this file.' },
    ]);
    expect(result.rows[3]?.errors[0]?.field).toBe('name');
  });

  it('refuses a file over the row limit', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i},,,,,,,,10,9,`);
    expect(parseProductImport([header, ...rows].join('\n'), false).fileErrors[0]).toMatch(
      /more than 2000/,
    );
  });
});

describe('makeProductImages', () => {
  const picture = (width: number, height: number, format: 'png' | 'jpeg' | 'gif' = 'png') =>
    sharp({ create: { width, height, channels: 3, background: '#c6f432' } })
      [format]()
      .toBuffer();

  it('keeps a clean WebP full image (at most 800 px) and thumbnail (at most 160 px), keeping proportions', async () => {
    const { full, thumb } = await makeProductImages(await picture(1600, 1200));
    const fullInfo = await sharp(full).metadata();
    const thumbInfo = await sharp(thumb).metadata();
    expect(fullInfo.format).toBe('webp');
    expect([fullInfo.width, fullInfo.height]).toEqual([800, 600]);
    expect([thumbInfo.width, thumbInfo.height]).toEqual([160, 120]);
  });

  it('does not enlarge a small picture', async () => {
    const { full } = await makeProductImages(await picture(100, 50));
    expect((await sharp(full).metadata()).width).toBe(100);
  });

  it('refuses text pretending to be a picture, and pictures of other types', async () => {
    await expect(makeProductImages(Buffer.from('<script>alert(1)</script>'))).rejects.toMatchObject(
      {
        code: 'CONTENT_MISMATCH',
      },
    );
    await expect(makeProductImages(await picture(10, 10, 'gif'))).rejects.toMatchObject({
      code: 'TYPE_NOT_ALLOWED',
    });
    await expect(makeProductImages(Buffer.alloc(0))).rejects.toBeInstanceOf(StorageValidationError);
  });

  it('refuses a picture that decodes to an absurd number of pixels (a decompression bomb)', async () => {
    // 30000 x 1000 = 30 megapixels, over the 25 megapixel cap, yet a flat colour compresses to a few kilobytes.
    const bomb = await picture(30_000, 1_000);
    await expect(makeProductImages(bomb)).rejects.toMatchObject({ code: 'CONTENT_MISMATCH' });
  });
});
