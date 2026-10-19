import { FieldError } from '../../../common/errors/domain-error';
import { isAllowedGstRate } from './gst-rates';
import { MAX_PAISE } from './money';

/**
 * Product rules that do not need the database (pure functions, easy to test). The API and the CSV import both call
 * them, so a product is judged by the same rules whichever way it arrives.
 */

/** The text fields of a product, already trimmed by the caller. Empty text means "not given". */
export interface ProductFields {
  name: string;
  brand: string;
  variant: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  gstRateBp: number | null;
}

const HSN = /^([0-9]{4}|[0-9]{6}|[0-9]{8})$/;
const BARCODE = /^[A-Za-z0-9._-]{3,32}$/;
const SKU = /^[A-Za-z0-9._\-/ ]{1,40}$/;

/**
 * Check the descriptive fields of one product.
 *
 * HSN (the goods classification code printed on a tax invoice) and the GST rate are REQUIRED when the business has a
 * GSTIN, because every tax invoice it issues must carry them (US-PROD-01). A business without a GSTIN may leave them blank.
 *
 * @param gstRegistered true when the business has a GSTIN.
 * @returns the problems found; an empty list means the fields are acceptable.
 */
export function productFieldErrors(fields: ProductFields, gstRegistered: boolean): FieldError[] {
  const errors: FieldError[] = [];
  if (fields.name.length < 2 || fields.name.length > 150)
    errors.push({ field: 'name', message: 'Use 2 to 150 characters.' });
  if (fields.brand.length > 80)
    errors.push({ field: 'brand', message: 'Use 80 characters or fewer.' });
  if (fields.variant.length > 80)
    errors.push({ field: 'variant', message: 'Use 80 characters or fewer.' });
  if (fields.sku !== null && !SKU.test(fields.sku))
    errors.push({
      field: 'sku',
      message: 'Use letters, digits and - _ . / only, up to 40 characters.',
    });
  if (fields.barcode !== null && !BARCODE.test(fields.barcode))
    errors.push({ field: 'barcode', message: 'A barcode is 3 to 32 letters or digits.' });
  if (fields.hsn !== null && !HSN.test(fields.hsn))
    errors.push({ field: 'hsn', message: 'An HSN code has 4, 6 or 8 digits.' });
  if (fields.gstRateBp !== null && !isAllowedGstRate(fields.gstRateBp))
    errors.push({
      field: 'gstRateBp',
      message: 'Choose a GST rate from the list (0, 5, 18 or 40 percent).',
    });
  if (gstRegistered && fields.hsn === null)
    errors.push({ field: 'hsn', message: 'HSN is required because your business has a GSTIN.' });
  if (gstRegistered && fields.gstRateBp === null)
    errors.push({
      field: 'gstRateBp',
      message: 'GST rate is required because your business has a GSTIN.',
    });
  return errors;
}

/**
 * Check a price pair: both positive whole paise, and the selling price not above the MRP (maximum retail price, the
 * most the pack may legally be sold for in India).
 */
export function priceErrors(mrpPaise: number, pricePaise: number): FieldError[] {
  const errors: FieldError[] = [];
  if (!Number.isInteger(mrpPaise) || mrpPaise <= 0 || mrpPaise > MAX_PAISE)
    errors.push({ field: 'mrpPaise', message: 'Enter the MRP as an amount above zero.' });
  if (!Number.isInteger(pricePaise) || pricePaise <= 0 || pricePaise > MAX_PAISE)
    errors.push({
      field: 'pricePaise',
      message: 'Enter the selling price as an amount above zero.',
    });
  else if (errors.length === 0 && pricePaise > mrpPaise)
    errors.push({
      field: 'pricePaise',
      message: 'The selling price cannot be higher than the MRP.',
    });
  return errors;
}

/** Margin of a selling price over a cost, in basis points of the price (2500 = 25%). `null` when there is no price. */
export function marginBp(pricePaise: number, costPaise: number): number | null {
  if (pricePaise <= 0) return null;
  return Math.round(((pricePaise - costPaise) * 10_000) / pricePaise);
}

/** The key that identifies "the same product" inside one business: name, brand and variant, ignoring case. */
export function identityKey(fields: Pick<ProductFields, 'name' | 'brand' | 'variant'>): string {
  return [fields.name, fields.brand, fields.variant]
    .map((part) => part.trim().toLowerCase())
    .join('\u0001');
}
