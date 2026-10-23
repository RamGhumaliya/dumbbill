import { allocateProRata, divideRoundHalfUp } from './rounding';

/**
 * The bill calculator: from a cart to every figure on a GST invoice, as pure functions (no database, no clock).
 *
 * VOCABULARY
 *  - PAISE: Rs 1 = 100 paise. Every amount here is a whole number of paise (ADR 004).
 *  - BASIS POINTS (bp): 1% = 100 bp, so GST of 18% is 1800 and 2.5% is 250.
 *  - GST: Goods and Services Tax. On a sale inside one state it is split into CGST (central) and SGST (state); on a sale
 *    to another state it is one IGST (integrated). The rates are the same in total (18% = 9% + 9% = 18%).
 *  - HSN: the product's tax classification code. An invoice lists tax per HSN code and rate (the "HSN summary").
 *  - TAX INVOICE: issued by a business registered for GST, shows the tax. BILL OF SUPPLY: issued by a business that is not
 *    registered (or sells exempt goods); it shows NO tax and may not charge any.
 *  - TAX-INCLUSIVE price: the price on the shelf already contains the GST (how Indian retail MRPs work). TAX-EXCLUSIVE:
 *    GST is added on top.
 *
 * THE STEPS, IN ORDER (fixed here and in the golden files the CA reviews; ADR 004 section 6 and docs/04-qa/gst-golden/)
 *  1. Gross of a line = quantity x unit price.
 *  2. Item discount (a percentage or a fixed amount) comes off that line. It cannot exceed the line.
 *  3. Bill discount (a percentage of what is left, or a fixed amount) comes off the whole bill and is SHARED between lines
 *     in proportion to what each has left (see `allocateProRata`; leftover paise are given by one fixed rule). It cannot
 *     exceed what is left, so no line and no bill can go below zero.
 *  4. What a line has left now is its NET.
 *  5. Tax, per line, on the net:
 *       - inclusive: taxable value = net x 10000 / (10000 + rate), rounded half-up; tax = net - taxable value.
 *       - exclusive: tax = taxable value x rate / 10000, rounded half-up; line total = net + tax.
 *     Bill of supply: no tax; taxable value = net.
 *  6. The tax of a line is split: for a sale in the same state CGST = tax / 2 rounded DOWN and SGST = the rest (so SGST is
 *     never smaller than CGST, and they differ by at most one paisa); for another state it is all IGST.
 *  7. The invoice total is the sum of the line totals rounded to the nearest whole rupee (half-up), and the difference
 *     is shown as a separate ROUND-OFF line (never more than 50 paise either way).
 *
 * Because every step rounds ONCE, to whole paise, in a fixed way, these identities always hold (and are property-tested):
 * sum of line totals = subtotal; taxable + tax = line total; total = subtotal + round-off; nothing is ever negative.
 */

/** Which kind of document the bill becomes. */
export type DocumentType = 'TAX_INVOICE' | 'BILL_OF_SUPPLY';

/** Does the unit price already contain the GST? */
export type PriceBasis = 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE';

/** Same state as the shop (CGST + SGST) or another state (IGST). */
export type SupplyKind = 'INTRA_STATE' | 'INTER_STATE';

/** A discount: a percentage in basis points (1000 = 10%) or a fixed amount in paise. */
export type Discount = { kind: 'PERCENT'; basisPoints: number } | { kind: 'AMOUNT'; paise: number };

/** One line of the cart, as the server knows it (price and rate come from the catalogue, never from the client). */
export interface LineInput {
  /** HSN code of the product, or null if it has none (a business without a GSTIN). */
  hsn: string | null;
  /** GST rate in basis points (1800 = 18%). Ignored on a bill of supply. */
  gstRateBp: number;
  /** Whole units sold, at least 1. */
  qty: number;
  /** Price of one unit in force right now, in paise. */
  unitPricePaise: number;
  /** Discount on this line only. */
  discount?: Discount;
}

/** A whole cart. */
export interface BillInput {
  documentType: DocumentType;
  priceBasis: PriceBasis;
  supply: SupplyKind;
  lines: readonly LineInput[];
  /** Discount on the whole bill, shared across the lines. */
  billDiscount?: Discount;
}

/** All the figures of one line, in paise. */
export interface LinePricing {
  /** Quantity x unit price. */
  grossPaise: number;
  /** The line's own discount. */
  itemDiscountPaise: number;
  /** This line's share of the bill discount. */
  billDiscountPaise: number;
  /** What the line has left after both discounts (tax-inclusive or exclusive, as the prices are). */
  netPaise: number;
  /** The value tax is charged on. */
  taxableValuePaise: number;
  /** The rate applied, in basis points (0 on a bill of supply). */
  gstRateBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** cgst + sgst + igst. */
  taxPaise: number;
  /** Taxable value + tax: what the customer pays for this line. */
  totalPaise: number;
}

/** One row of the HSN summary printed on the invoice. */
export interface HsnSummaryRow {
  /** The HSN code, or an empty string when the lines have none. */
  hsn: string;
  gstRateBp: number;
  qty: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
}

/** The whole bill. */
export interface BillPricing {
  documentType: DocumentType;
  priceBasis: PriceBasis;
  supply: SupplyKind;
  lines: LinePricing[];
  grossPaise: number;
  itemDiscountPaise: number;
  billDiscountPaise: number;
  /** itemDiscount + billDiscount. */
  discountPaise: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  /** Sum of the line totals, before rounding off. */
  subtotalPaise: number;
  /** Added (or taken off, when negative) to reach a whole rupee. Between -49 and +50. */
  roundOffPaise: number;
  /** What the customer pays: a whole number of rupees, in paise. */
  totalPaise: number;
  hsnSummary: HsnSummaryRow[];
}

/** Why a cart could not be priced. The checkout turns these into the API's error answers. */
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

/** Most units on one line: a guard against a typo or a runaway scan. */
export const MAX_LINE_QTY = 100_000;
/** Largest unit price: Rs 1 crore (the same guard as the catalogue). */
export const MAX_UNIT_PRICE_PAISE = 1_000_000_000;
/** Most lines on one bill. */
export const MAX_LINES = 200;
/**
 * Largest bill before discounts: Rs 10 crore. Keeps every figure far inside what a JavaScript number holds exactly, and
 * stops a runaway quantity from reaching an invoice.
 */
export const MAX_BILL_PAISE = 10_000_000_000;

const BP = 10_000n;

function wholeNumber(
  value: number,
  code: PricingErrorCode,
  what: string,
  lineIndex?: number,
): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PricingError(code, `${what} must be a whole number of at least zero.`, lineIndex);
  }
  return BigInt(value);
}

/** The amount a discount takes off `base`, rounded half-up for a percentage. Checks the discount is well formed. */
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
  const amount = wholeNumber(discount.paise, 'INVALID_DISCOUNT', 'A discount amount', lineIndex);
  if (amount > base) {
    throw new PricingError(
      'DISCOUNT_EXCEEDS_AMOUNT',
      'A discount cannot be more than the amount it is taken from.',
      lineIndex,
    );
  }
  return amount;
}

/** Decide the tax of one line from its net, per the steps in the file comment. Returns the amounts as BigInt paise. */
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

/**
 * Price a whole cart.
 *
 * @throws PricingError for an empty cart, a bad quantity, price, rate or discount, or a discount larger than what it is
 *         taken from. A cart that prices successfully always satisfies the invariants in the file comment.
 */
export function calculateBill(input: BillInput): BillPricing {
  if (input.lines.length === 0) throw new PricingError('EMPTY_CART', 'The cart is empty.');
  if (input.lines.length > MAX_LINES) {
    throw new PricingError('TOO_MANY_LINES', `A bill can have at most ${MAX_LINES} lines.`);
  }

  // Steps 1 and 2: gross and item discount per line.
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
  const afterItem = grosses.map((gross, index) => gross - itemDiscounts[index]!);

  // Step 3: the bill discount, shared in proportion to what each line has left.
  const afterItemSum = afterItem.reduce((sum, value) => sum + value, 0n);
  const billDiscount = discountAmount(input.billDiscount, afterItemSum);
  const billShares = allocateProRata(billDiscount, afterItem);

  // Steps 4 to 6: net, tax and its split, per line.
  const lines: LinePricing[] = input.lines.map((line, index) => {
    const net = afterItem[index]! - billShares[index]!;
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

  // Step 7: the invoice totals and the round-off to a whole rupee.
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

/**
 * The HSN summary: one row per HSN code and rate, adding up the quantity, taxable value and tax of the lines that share
 * them. Rows are sorted by HSN then rate so the printed order never depends on the order things were scanned.
 */
export function summariseByHsn(
  inputs: readonly LineInput[],
  priced: readonly LinePricing[],
): HsnSummaryRow[] {
  const rows = new Map<string, HsnSummaryRow>();
  priced.forEach((line, index) => {
    const hsn = inputs[index]!.hsn ?? '';
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
    row.qty += inputs[index]!.qty;
    row.taxableValuePaise += line.taxableValuePaise;
    row.cgstPaise += line.cgstPaise;
    row.sgstPaise += line.sgstPaise;
    row.igstPaise += line.igstPaise;
    row.taxPaise += line.taxPaise;
    rows.set(key, row);
  });
  return [...rows.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.gstRateBp - b.gstRateBp);
}

/**
 * Is a sale inside the shop's own state? For a counter sale the place of supply is where the shop is, so the answer is
 * "inside" unless the customer's state is known and different (a delivery to another state). State codes are the two-digit
 * GST state codes ("27" = Maharashtra).
 */
export function supplyKind(
  shopStateCode: string,
  placeOfSupplyStateCode?: string | null,
): SupplyKind {
  return !placeOfSupplyStateCode || placeOfSupplyStateCode === shopStateCode
    ? 'INTRA_STATE'
    : 'INTER_STATE';
}
