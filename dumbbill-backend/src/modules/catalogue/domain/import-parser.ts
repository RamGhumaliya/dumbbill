import { FieldError } from '../../../common/errors/domain-error';
import { parseCsv } from './csv';
import { percentToBasisPoints } from './gst-rates';
import { rupeesToPaise } from './money';
import { identityKey, priceErrors, productFieldErrors } from './product-rules';

/**
 * Reads a product CSV into checked rows, reporting every problem per row (US-PROD-01: "CSV import with row-level error
 * report"). Pure: it does not touch the database. The service adds the checks that need it (existing barcodes,
 * categories).
 *
 * Columns (case does not matter, order does not matter, unknown columns are ignored with a note):
 *   name*, brand, category, variant, sku, barcode, hsn, gst_percent, mrp*, price*, cost
 * Amounts are in RUPEES ("1499.50"), read as text and converted to paise without decimal arithmetic.
 */

/** Most rows one import may carry. Keeps a request small and its report readable. */
export const MAX_IMPORT_ROWS = 2000;

const KNOWN_COLUMNS = [
  'name',
  'brand',
  'category',
  'variant',
  'sku',
  'barcode',
  'hsn',
  'gst_percent',
  'mrp',
  'price',
  'cost',
] as const;
type Column = (typeof KNOWN_COLUMNS)[number];

/** One product asked for by the file. */
export interface ImportDraft {
  name: string;
  brand: string;
  variant: string;
  categoryName: string | null;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  gstRateBp: number | null;
  mrpPaise: number;
  pricePaise: number;
  purchaseCostPaise: number | null;
}

/** One line of the file with what was found. `draft` is present only when `errors` is empty. */
export interface ImportRow {
  /** Row number as a spreadsheet shows it: the header is row 1, so the first product is row 2. */
  rowNumber: number;
  errors: FieldError[];
  draft?: ImportDraft;
}

export interface ParsedImport {
  /** Problems with the file as a whole (missing column, too many rows). When present, `rows` is empty. */
  fileErrors: string[];
  /** Columns in the file that we do not use. */
  ignoredColumns: string[];
  rows: ImportRow[];
}

/** The shared rules name fields the way the API does; a CSV user knows the column names. */
function toColumnName(error: FieldError): FieldError {
  const names: Record<string, string> = {
    mrpPaise: 'mrp',
    pricePaise: 'price',
    gstRateBp: 'gst_percent',
  };
  return { ...error, field: names[error.field] ?? error.field };
}

/**
 * @param gstRegistered whether the business has a GSTIN (HSN and GST rate become required).
 */
export function parseProductImport(text: string, gstRegistered: boolean): ParsedImport {
  const grid = parseCsv(text);
  const header = (grid[0] ?? []).map((name) => name.trim().toLowerCase().replace(/\s+/g, '_'));
  const column = (name: Column): number => header.indexOf(name);
  const fileErrors: string[] = [];

  for (const required of ['name', 'mrp', 'price'] as const) {
    if (column(required) < 0) fileErrors.push(`The file has no "${required}" column.`);
  }
  const dataRows = grid.slice(1);
  if (dataRows.length === 0) fileErrors.push('The file has no product rows.');
  if (dataRows.length > MAX_IMPORT_ROWS)
    fileErrors.push(`The file has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`);
  const ignoredColumns = header.filter(
    (name) => name !== '' && !(KNOWN_COLUMNS as readonly string[]).includes(name),
  );
  if (fileErrors.length > 0) return { fileErrors, ignoredColumns, rows: [] };

  const cell = (row: string[], name: Column): string => (row[column(name)] ?? '').trim();
  const orNull = (value: string): string | null => (value === '' ? null : value);
  const seen = {
    barcode: new Map<string, number>(),
    sku: new Map<string, number>(),
    identity: new Map<string, number>(),
  };

  const rows = dataRows.map((cells, index): ImportRow => {
    const rowNumber = index + 2;
    const errors: FieldError[] = [];

    const gstText = cell(cells, 'gst_percent');
    const gstRateBp = gstText === '' ? null : percentToBasisPoints(gstText);
    if (gstText !== '' && gstRateBp === null)
      errors.push({
        field: 'gst_percent',
        message: 'Write the GST rate as a percentage, for example 18.',
      });

    const mrpPaise = rupeesToPaise(cell(cells, 'mrp'));
    const pricePaise = rupeesToPaise(cell(cells, 'price'));
    if (mrpPaise === null)
      errors.push({ field: 'mrp', message: 'Write the MRP in rupees, for example 1499.50.' });
    if (pricePaise === null)
      errors.push({ field: 'price', message: 'Write the price in rupees, for example 1299.' });
    if (mrpPaise !== null && pricePaise !== null)
      errors.push(...priceErrors(mrpPaise, pricePaise).map(toColumnName));

    const costText = cell(cells, 'cost');
    const purchaseCostPaise = costText === '' ? null : rupeesToPaise(costText);
    if (costText !== '' && purchaseCostPaise === null)
      errors.push({ field: 'cost', message: 'Write the cost in rupees, for example 950.' });

    const fields = {
      name: cell(cells, 'name'),
      brand: cell(cells, 'brand'),
      variant: cell(cells, 'variant'),
      sku: orNull(cell(cells, 'sku')),
      barcode: orNull(cell(cells, 'barcode')),
      hsn: orNull(cell(cells, 'hsn')),
      gstRateBp,
    };
    errors.push(...productFieldErrors(fields, gstRegistered).map(toColumnName));

    // The same barcode, SKU or product twice inside the file: the LATER row is the one refused.
    const clash = (
      map: Map<string, number>,
      key: string | null,
      field: string,
      label: string,
    ): void => {
      if (key === null) return;
      const earlier = map.get(key);
      if (earlier !== undefined)
        errors.push({ field, message: `Same ${label} as row ${earlier} in this file.` });
      else map.set(key, rowNumber);
    };
    clash(seen.barcode, fields.barcode, 'barcode', 'barcode');
    clash(seen.sku, fields.sku?.toLowerCase() ?? null, 'sku', 'SKU');
    clash(seen.identity, identityKey(fields), 'name', 'name, brand and variant');

    if (errors.length > 0 || mrpPaise === null || pricePaise === null) return { rowNumber, errors };
    return {
      rowNumber,
      errors,
      draft: {
        ...fields,
        categoryName: orNull(cell(cells, 'category')),
        mrpPaise,
        pricePaise,
        purchaseCostPaise,
      },
    };
  });
  return { fileErrors, ignoredColumns, rows };
}
