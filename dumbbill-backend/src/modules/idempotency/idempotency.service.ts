import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';
import { stableJson } from '../../common/stable-json';
import { TenantTransaction } from '../tenancy/tenant-tx.service';

/**
 * Idempotency keys (hard rule 6): a retry must never do the work twice.
 *
 * THE PROBLEM: a person taps "Save purchase", the connection drops before the answer arrives, they tap again. Without
 * protection the bill is entered twice and the stock doubles. THE SOLUTION: the app makes ONE random key per form (a "fresh
 * form" means a fresh key) and sends it in the `Idempotency-Key` header on every attempt. The first attempt does the work
 * and the server remembers the answer under the key; any later attempt with the same key gets that same answer back, and
 * does nothing.
 *
 * HOW IT STAYS SAFE
 *  - The key is stored in the SAME database transaction as the work. If the work fails, the key disappears with it, so a
 *    retry after a failure runs normally. If it succeeds, the key and the work are saved together or not at all.
 *  - Two attempts at the same moment: the second waits on the unique key until the first commits, then finds the answer.
 *  - The same key with a DIFFERENT request body is a mistake (a reused key), answered with IDEMPOTENCY_KEY_REUSED.
 *  - Keys are per business and per operation (`scope`), so one business's key can never collide with another's.
 *
 * Old keys can be deleted after a day or two (a later clean-up job); a key only needs to outlive a person's retries.
 */
@Injectable()
export class IdempotencyService {
  /**
   * Run `work` once per key and return its answer; later calls with the same key return the stored answer.
   *
   * @param scope which operation this key is for, for example `purchase.create`.
   * @param key the value of the Idempotency-Key header.
   * @param body the request body, used to detect "same key, different request".
   * @param work does the work and returns the HTTP status and the response body to remember. Must return plain JSON.
   * @throws DomainError BAD_REQUEST for a missing or malformed key; IDEMPOTENCY_KEY_REUSED for a different body.
   */
  async run<T extends object>(
    tx: TenantTransaction,
    tenantId: string,
    scope: string,
    key: string | undefined,
    body: unknown,
    work: () => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    const clean = readKey(key);
    const requestHash = createHash('sha256').update(stableJson(body)).digest('hex');

    // Claim the key. Only the first claim inserts a row; a concurrent second claim waits here, then inserts nothing.
    const claimed = await tx.idempotencyKey.createMany({
      data: [{ tenantId, scope, key: clean, requestHash, responseStatus: 0, responseBody: {} }],
      skipDuplicates: true,
    });

    if (claimed.count === 0) {
      const earlier = await tx.idempotencyKey.findUniqueOrThrow({
        where: { tenantId_scope_key: { tenantId, scope, key: clean } },
      });
      if (earlier.requestHash !== requestHash) {
        throw new DomainError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request. Make a new key for a new form.',
        );
      }
      return { status: earlier.responseStatus, body: earlier.responseBody as T, replayed: true };
    }

    const result = await work();
    await tx.idempotencyKey.update({
      where: { tenantId_scope_key: { tenantId, scope, key: clean } },
      data: { responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue },
    });
    return { ...result, replayed: false };
  }
}

/** A key is 8 to 100 letters, digits, dashes or underscores (a UUID is ideal). */
function readKey(key: string | undefined): string {
  if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    throw new DomainError(
      'BAD_REQUEST',
      'Send an Idempotency-Key header of 8 to 100 letters, digits, dashes or underscores (a UUID is ideal).',
    );
  }
  return key;
}
