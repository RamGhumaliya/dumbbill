/**
 * The till's bill PREVIEW: the same arithmetic as the server's bill calculator, for showing a total at once while the
 * person scans, and for billing offline.
 *
 * THE SERVER IS THE TRUTH. This file mirrors `dumbbill-backend/src/modules/pos/domain/pricing.ts` by hand (apps never
 * import each other's code). Both must give identical answers to every cart in the golden file
 * `docs/04-qa/gst-golden/cases.json` (copied to `tests/fixtures/gst-golden/`), which a chartered accountant reviews. If you
 * change a rule here, change it in the backend and in the golden file's generator in the same change.
 *
 * Money is whole PAISE (Rs 1 = 100 paise); rates are basis points (1800 = 18%). The steps and the reasons for each
 * rounding choice are explained in the backend file; in short: gross, then item discount, then the bill discount shared
 * across lines by what each has left, then tax per line (inclusive or exclusive), CGST/SGST or IGST, then a round-off line
 * to a whole rupee. BigInt is used for every multiplication so large bills stay exact.
 */

export type DocumentType = 'TAX_INVOICE' | 'BILL_OF_SUPPLY';
export type PriceBasis = 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE';
export type SupplyKind = 'INTRA_STATE' | 'INTER_STATE';

/** A discount: a percentage in basis points (1000 = 10%) or a fixed amount in paise. */
export type Discount = { kind: 'PERCENT'; basisPoints: number } | { kind: 'AMOUNT'; paise: number };

export interface LineInput {
  hsn: string | null;
  gstRateBp: number;
  qty: number;
  unitPricePaise: number;
  discount?: Discount;
}

export interface BillInput {
  documentType: DocumentType;
  priceBasis: PriceBasis;
  supply: SupplyKind;
  lines: readonly LineInput[];
  billDiscount?: Discount;
}

export interface LinePricing {
  grossPaise: number;
  itemDiscountPaise: number;
  billDiscountPaise: number;
  netPaise: number;
  taxableValuePaise: number;
  gstRateBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface HsnSummaryRow {
  hsn: string;
  gstRateBp: number;
  qty: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
}

export interface BillPricing {
  documentType: DocumentType;
  priceBasis: PriceBasis;
  supply: SupplyKind;
  lines: LinePricing[];
  grossPaise: number;
  itemDiscountPaise: number;
  billDiscountPaise: number;
  discountPaise: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  subtotalPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  hsnSummary: HsnSummaryRow[];
}

export type PricingErrorCode =
  | 'EMPTY_CART'
  | 'TOO_MANY_LINES'
  | 'INVALID_QUANTITY'
  | 'INVALID_AMOUNT'
  | 'INVALID_RATE'
  | 'INVALID_DISCOUNT'
  | 'DISCOUNT_EXCEEDS_AMOUNT';

/** Thrown for a cart that cannot be priced; `code` says why, `lineIndex` names the line when one line is at fault. */
export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    message: string,
    public readonly lineIndex?: number,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

export const MAX_LINE_QTY = 100_000;
export const MAX_UNIT_PRICE_PAISE = 1_000_000_000;
export const MAX_LINES = 200;
export const MAX_BILL_PAISE = 10_000_000_000;

const BP = 10_000n;

/** `numerator / denominator` to the nearest whole number, exact halves rounded UP (non-negative inputs). */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Share `total` over `weights` so the shares add up exactly: whole paise first, then the leftover paise one each to the
 * biggest fractional remainders, the earlier line winning a tie.
 */
function allocateProRata(total: bigint, weights: readonly bigint[]): bigint[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total === 0n) return weights.map(() => 0n);
  if (weightSum === 0n) throw new RangeError('Nothing to share the amount between.');
  const shares = weights.map((weight) => (total * weight) / weightSum);
  const remainders = weights.map((weight) => (total * weight) % weightSum);
  let leftover = Number(total - shares.reduce((sum, share) => sum + share, 0n));
  const order = weights
    .map((_weight, index) => index)
    .sort((a, b) => {
      const ra = remainders[a] as bigint;
      const rb = remainders[b] as bigint;
      const byRemainder = ra === rb ? 0 : ra > rb ? -1 : 1;
      return byRemainder !== 0 ? byRemainder : a - b;
    });
  for (const index of order) {
    if (leftover === 0) break;
    shares[index] = (shares[index] as bigint) + 1n;
    leftover -= 1;
  }
  return shares;
}

function discountAmount(discount: Discount | undefined, base: bigint, lineIndex?: number): bigint {
  if (!discount) return 0n;
  if (discount.kind === 'PERCENT') {
    if (
      !Number.isSafeInteger(discount.basisPoints) ||
      discount.basisPoints < 0 ||
      discount.basisPoints > 10_000
    ) {
      throw new PricingError(
        'INVALID_DISCOUNT',
        'A percentage discount must be from 0 to 100.',
        lineIndex,
      );
    }
    return divideRoundHalfUp(base * BigInt(discount.basisPoints), BP);
  }
  if (!Number.isSafeInteger(discount.paise) || discount.paise < 0) {
    throw new PricingError(
      'INVALID_DISCOUNT',
      'A discount amount must be a whole number of at least zero.',
      lineIndex,
    );
  }
  const amount = BigInt(discount.paise);
  if (amount > base) {
    throw new PricingError(
      'DISCOUNT_EXCEEDS_AMOUNT',
      'A discount cannot be more than the amount it is taken from.',
      lineIndex,
    );
  }
  return amount;
}

function taxOfLine(
  net: bigint,
  rateBp: bigint,
  document: DocumentType,
  basis: PriceBasis,
  supply: SupplyKind,
): { taxable: bigint; cgst: bigint; sgst: bigint; igst: bigint; total: bigint } {
  if (document === 'BILL_OF_SUPPLY') {
    return { taxable: net, cgst: 0n, sgst: 0n, igst: 0n, total: net };
  }
  let taxable: bigint;
  let tax: bigint;
  if (basis === 'TAX_INCLUSIVE') {
    taxable = divideRoundHalfUp(net * BP, BP + rateBp);
    tax = net - taxable;
  } else {
    taxable = net;
    tax = divideRoundHalfUp(net * rateBp, BP);
  }
  if (supply === 'INTER_STATE') {
    return { taxable, cgst: 0n, sgst: 0n, igst: tax, total: taxable + tax };
  }
  const cgst = tax / 2n;
  return { taxable, cgst, sgst: tax - cgst, igst: 0n, total: taxable + tax };
}

/** Price a whole cart. @throws PricingError for a cart that cannot be priced. */
export function calculateBill(input: BillInput): BillPricing {
  if (input.lines.length === 0) throw new PricingError('EMPTY_CART', 'The cart is empty.');
  if (input.lines.length > MAX_LINES) {
    throw new PricingError('TOO_MANY_LINES', `A bill can have at most ${MAX_LINES} lines.`);
  }

  const grosses: bigint[] = [];
  const itemDiscounts: bigint[] = [];
  input.lines.forEach((line, index) => {
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > MAX_LINE_QTY) {
      throw new PricingError(
        'INVALID_QUANTITY',
        `Quantity must be from 1 to ${MAX_LINE_QTY}.`,
        index,
      );
    }
    if (
      !Number.isSafeInteger(line.unitPricePaise) ||
      line.unitPricePaise < 0 ||
      line.unitPricePaise > MAX_UNIT_PRICE_PAISE
    ) {
      throw new PricingError('INVALID_AMOUNT', 'The price is not a valid amount.', index);
    }
    if (!Number.isSafeInteger(line.gstRateBp) || line.gstRateBp < 0 || line.gstRateBp > 10_000) {
      throw new PricingError('INVALID_RATE', 'The GST rate is not valid.', index);
    }
    const gross = BigInt(line.qty) * BigInt(line.unitPricePaise);
    grosses.push(gross);
    itemDiscounts.push(discountAmount(line.discount, gross, index));
  });
  if (grosses.reduce((sum, gross) => sum + gross, 0n) > BigInt(MAX_BILL_PAISE)) {
    throw new PricingError('INVALID_AMOUNT', 'The bill is larger than the system allows.');
  }
  const afterItem = grosses.map((gross, index) => gross - (itemDiscounts[index] as bigint));

  const afterItemSum = afterItem.reduce((sum, value) => sum + value, 0n);
  const billDiscount = discountAmount(input.billDiscount, afterItemSum);
  const billShares = allocateProRata(billDiscount, afterItem);

  const lines: LinePricing[] = input.lines.map((line, index) => {
    const net = (afterItem[index] as bigint) - (billShares[index] as bigint);
    const rate = input.documentType === 'BILL_OF_SUPPLY' ? 0n : BigInt(line.gstRateBp);
    const tax = taxOfLine(net, rate, input.documentType, input.priceBasis, input.supply);
    return {
      grossPaise: Number(grosses[index]),
      itemDiscountPaise: Number(itemDiscounts[index]),
      billDiscountPaise: Number(billShares[index]),
      netPaise: Number(net),
      taxableValuePaise: Number(tax.taxable),
      gstRateBp: Number(rate),
      cgstPaise: Number(tax.cgst),
      sgstPaise: Number(tax.sgst),
      igstPaise: Number(tax.igst),
      taxPaise: Number(tax.cgst + tax.sgst + tax.igst),
      totalPaise: Number(tax.total),
    };
  });

  const sum = (pick: (line: LinePricing) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  const subtotalPaise = sum((line) => line.totalPaise);
  const totalPaise = Number(divideRoundHalfUp(BigInt(subtotalPaise), 100n) * 100n);

  return {
    documentType: input.documentType,
    priceBasis: input.priceBasis,
    supply: input.supply,
    lines,
    grossPaise: sum((line) => line.grossPaise),
    itemDiscountPaise: sum((line) => line.itemDiscountPaise),
    billDiscountPaise: sum((line) => line.billDiscountPaise),
    discountPaise: sum((line) => line.itemDiscountPaise + line.billDiscountPaise),
    taxableValuePaise: sum((line) => line.taxableValuePaise),
    cgstPaise: sum((line) => line.cgstPaise),
    sgstPaise: sum((line) => line.sgstPaise),
    igstPaise: sum((line) => line.igstPaise),
    taxPaise: sum((line) => line.taxPaise),
    subtotalPaise,
    roundOffPaise: totalPaise - subtotalPaise,
    totalPaise,
    hsnSummary: summariseByHsn(input.lines, lines),
  };
}

/** One row per HSN code and rate, sorted so the printed order never depends on scanning order. */
export function summariseByHsn(
  inputs: readonly LineInput[],
  priced: readonly LinePricing[],
): HsnSummaryRow[] {
  const rows = new Map<string, HsnSummaryRow>();
  priced.forEach((line, index) => {
    const input = inputs[index] as LineInput;
    const hsn = input.hsn ?? '';
    const key = `${hsn}|${line.gstRateBp}`;
    const row = rows.get(key) ?? {
      hsn,
      gstRateBp: line.gstRateBp,
      qty: 0,
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
    };
    row.qty += input.qty;
    row.taxableValuePaise += line.taxableValuePaise;
    row.cgstPaise += line.cgstPaise;
    row.sgstPaise += line.sgstPaise;
    row.igstPaise += line.igstPaise;
    row.taxPaise += line.taxPaise;
    rows.set(key, row);
  });
  return [...rows.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.gstRateBp - b.gstRateBp);
}

/** Same state as the shop unless the customer's state is known and different. */
export function supplyKind(
  shopStateCode: string,
  placeOfSupplyStateCode?: string | null,
): SupplyKind {
  return !placeOfSupplyStateCode || placeOfSupplyStateCode === shopStateCode
    ? 'INTRA_STATE'
    : 'INTER_STATE';
}
