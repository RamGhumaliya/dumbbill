import { randomUUID } from 'node:crypto';
import { FileCategory, StorageValidationError } from './storage.types';

/**
 * Storage keys look like:  <tenant-id>/<category>/<random-uuid>.<extension>
 *
 * Why this shape:
 * - The tenant id is the first folder, so one business's files are never mixed with another's,
 *   and a whole business can be exported or deleted by removing one folder.
 * - The file name is a random UUID, never the name the user uploaded. User-supplied names can
 *   contain "../", odd characters or private information, so we never trust them.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every part of a key may only use these characters. No dots at the start, so "." and ".." are impossible. */
const KEY_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const MAX_KEY_LENGTH = 200;

/** File extensions we accept, mapped to the MIME type we serve them with. */
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  csv: 'text/csv',
};

export interface BuildKeyInput {
  tenantId: string;
  category: FileCategory;
  /** Extension without the dot, for example "png". Must be in `ALLOWED_EXTENSIONS`. */
  extension: string;
}

/** Create a new unique storage key for a file about to be saved. */
export function buildStorageKey({ tenantId, category, extension }: BuildKeyInput): string {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new StorageValidationError('INVALID_KEY', 'Tenant id must be a UUID.');
  }
  const ext = extension.toLowerCase();
  if (!(ext in ALLOWED_EXTENSIONS)) {
    throw new StorageValidationError('TYPE_NOT_ALLOWED', `File type ".${ext}" is not allowed.`);
  }
  return `${tenantId}/${category}/${randomUUID()}.${ext}`;
}

/**
 * Check that a key is safe to turn into a file path.
 * This is the main defence against "path traversal" attacks (for example "../../etc/passwd").
 * It is called by every storage operation, so a bad key can never reach the disk.
 */
export function assertValidKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new StorageValidationError('INVALID_KEY', 'Storage key is empty or too long.');
  }
  const segments = key.split('/');
  // Exactly <tenant>/<category>/<file>: three parts, nothing deeper.
  if (segments.length !== 3 || !segments.every((s) => KEY_SEGMENT_PATTERN.test(s))) {
    throw new StorageValidationError('INVALID_KEY', 'Storage key has an invalid format.');
  }
  if (segments.some((s) => s.includes('..'))) {
    throw new StorageValidationError('INVALID_KEY', 'Storage key must not contain "..".');
  }
}

/** The MIME type for a key, based on its extension. Throws if the extension is not allowed. */
export function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const contentType = ALLOWED_EXTENSIONS[ext];
  if (!contentType) {
    throw new StorageValidationError('TYPE_NOT_ALLOWED', `File type ".${ext}" is not allowed.`);
  }
  return contentType;
}
