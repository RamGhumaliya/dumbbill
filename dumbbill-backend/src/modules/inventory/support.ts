import { Branch, Product } from '@prisma/client';
import { Clock } from '../../common/clock';
import { DomainError, FieldError } from '../../common/errors/domain-error';
import { LoadedAccess } from '../permissions/access.service';
import { BranchScope } from '../permissions/branch-scope';
import { TenantTransaction } from '../tenancy/tenant-tx.service';

/**
 * Small helpers shared by purchasing and stock changes.
 */

/** Today's date in India (IST, UTC+5:30) as "YYYY-MM-DD". Shops reason about expiry in local calendar days. */
export function todayInIndia(clock: Clock): string {
  return new Date(clock.now().getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Read "YYYY-MM-DD" as a calendar date (midnight UTC, which is how a `date` column is stored). `null` if it is not a real date. */
export function parseDateOnly(text: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

/** A date column back to "YYYY-MM-DD". */
export function dateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * A branch the person may work in and that is switched on. Row-level security makes another business's branch a 404; the
 * branch scope makes a branch of this business that the person's role does not cover a 403.
 *
 * @throws DomainError NOT_FOUND, FORBIDDEN, or BUSINESS_RULE_VIOLATION for a switched-off branch.
 */
export async function usableBranch(
  tx: TenantTransaction,
  actor: LoadedAccess,
  branchId: string,
  field = 'branchId',
): Promise<Branch> {
  const branch = await tx.branch.findUnique({ where: { id: branchId } });
  if (!branch) {
    throw new DomainError('NOT_FOUND', 'This branch does not exist.', [
      { field, message: 'This branch does not exist.' },
    ]);
  }
  new BranchScope(actor).assert(branch.id);
  if (!branch.isActive) {
    throw new DomainError('BUSINESS_RULE_VIOLATION', `${branch.name} is switched off.`);
  }
  return branch;
}

/**
 * The products of a request, by id. Every id must be a product of this business (not another's; row-level security hides
 * those) and switched on.
 *
 * @param fieldFor builds the field name to blame, for example `(i) => "lines[" + i + "].productId"`.
 * @throws DomainError VALIDATION_FAILED listing every unknown or switched-off product.
 */
export async function usableProducts(
  tx: TenantTransaction,
  productIds: string[],
  fieldFor: (index: number) => string,
): Promise<Map<string, Product>> {
  const unique = [...new Set(productIds)];
  const rows = await tx.product.findMany({ where: { id: { in: unique } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const errors: FieldError[] = [];
  productIds.forEach((id, index) => {
    const product = byId.get(id);
    if (!product) errors.push({ field: fieldFor(index), message: 'This product does not exist.' });
    else if (!product.isActive)
      errors.push({ field: fieldFor(index), message: `${product.name} is switched off.` });
  });
  if (errors.length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Some products cannot be used.', errors);
  }
  return byId;
}

/**
 * The next number of a kind of document for this business ("DN" debit notes): 1, 2, 3, never skipped or repeated, even
 * when two requests ask at the same moment (the database does the counting in one atomic statement).
 */
export async function nextDocumentNumber(
  tx: TenantTransaction,
  tenantId: string,
  kind: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ no: number }>>`
    INSERT INTO document_counters (tenant_id, kind, next_no) VALUES (${tenantId}::uuid, ${kind}, 2)
    ON CONFLICT (tenant_id, kind) DO UPDATE SET next_no = document_counters.next_no + 1
    RETURNING next_no - 1 AS no`;
  return Number(rows[0]!.no);
}
