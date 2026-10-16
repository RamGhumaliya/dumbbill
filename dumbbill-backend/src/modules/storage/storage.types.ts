import { Readable } from 'node:stream';

/**
 * File categories we store. The category becomes part of the storage key, which keeps
 * each kind of file in its own folder and lets us apply different rules per kind later
 * (for example, longer retention for invoices than for product images).
 */
export type FileCategory = 'product-images' | 'invoices' | 'exports' | 'logos' | 'misc';

/** What the caller hands over when saving a file. */
export interface PutFileInput {
  /** Where to store it. Build it with `buildStorageKey`, never by hand. */
  key: string;
  /** The whole file in memory. Our limit is a few MB, so streaming is not needed on the way in. */
  data: Buffer;
  /** MIME type the client claims. It is checked against the file's real contents. */
  contentType: string;
}

/** What we remember about a saved file. */
export interface StoredFile {
  key: string;
  /** Size in bytes. */
  size: number;
  contentType: string;
  /** SHA-256 of the contents (hex). Useful for de-duplication and integrity checks. */
  sha256: string;
}

/** A file opened for reading. The caller must consume or destroy `stream`. */
export interface OpenedFile {
  stream: Readable;
  size: number;
  contentType: string;
}

/**
 * The storage contract used by the rest of the app.
 *
 * Today the only implementation writes to the server's disk (`LocalDiskStorage`).
 * An S3 implementation can be added later without changing any caller, because
 * callers only depend on this abstract class.
 *
 * An abstract class (not an interface) is used so it can double as the NestJS injection token.
 */
export abstract class FileStorage {
  /** Save a file. Overwrites the same key if it already exists. */
  abstract put(input: PutFileInput): Promise<StoredFile>;

  /** Open a file for reading. Throws `StorageObjectNotFoundError` if it does not exist. */
  abstract get(key: string): Promise<OpenedFile>;

  /** Delete a file. Deleting a file that is already gone is not an error. */
  abstract delete(key: string): Promise<void>;

  /** Check whether a file exists. */
  abstract exists(key: string): Promise<boolean>;
}

/** Thrown when a requested file is not in storage. Maps to HTTP 404 at the API layer. */
export class StorageObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Stored file not found: ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

/** Thrown when a file or key is rejected by our rules. Maps to HTTP 422 at the API layer. */
export class StorageValidationError extends Error {
  constructor(
    public readonly code:
      'INVALID_KEY' | 'FILE_TOO_LARGE' | 'EMPTY_FILE' | 'TYPE_NOT_ALLOWED' | 'CONTENT_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'StorageValidationError';
  }
}
