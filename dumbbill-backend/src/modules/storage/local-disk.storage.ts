import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { matchesContentType } from './file-signature';
import { ALLOWED_EXTENSIONS, assertValidKey, contentTypeForKey } from './storage-key';
import {
  FileStorage,
  OpenedFile,
  PutFileInput,
  StorageObjectNotFoundError,
  StorageValidationError,
  StoredFile,
} from './storage.types';

export interface LocalDiskStorageOptions {
  /** Folder on the server where files are kept. Created automatically if missing. */
  rootDir: string;
  /** Largest file we accept, in bytes. */
  maxFileBytes: number;
}

/**
 * Stores files in a folder on the server's disk.
 *
 * Important behaviour:
 * - Files are NOT served as a public static folder. They can only be read through `get()`,
 *   which the API will call after checking the user's login and permissions.
 * - Writes are atomic: we write to a temporary file and rename it, so a crash halfway
 *   through never leaves a half-written file under the real name.
 * - Every key is validated first, so a request can never escape the root folder.
 *
 * Back up the root folder together with the database, because invoices and product
 * images live here.
 */
export class LocalDiskStorage extends FileStorage {
  private readonly root: string;

  constructor(private readonly options: LocalDiskStorageOptions) {
    super();
    this.root = resolve(options.rootDir);
  }

  async put({ key, data, contentType }: PutFileInput): Promise<StoredFile> {
    assertValidKey(key);
    this.assertFileAllowed(key, data, contentType);

    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    // Write to a temp name first, then rename. A rename is atomic on the same disk.
    const tempPath = `${path}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(tempPath, data);
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }); // do not leave junk behind on failure
      throw error;
    }

    return {
      key,
      size: data.length,
      contentType,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  async get(key: string): Promise<OpenedFile> {
    assertValidKey(key);
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new StorageObjectNotFoundError(key);
      return {
        stream: createReadStream(path),
        size: info.size,
        contentType: contentTypeForKey(key),
      };
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    // force: true means "no error if it is already gone", which makes deletes safe to retry.
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** Turn a validated key into an absolute path, and double-check it stays inside the root folder. */
  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    // Second line of defence after `assertValidKey`: the final path must be inside the root.
    if (!path.startsWith(this.root + sep)) {
      throw new StorageValidationError('INVALID_KEY', 'Storage key escapes the storage folder.');
    }
    return path;
  }

  /** Apply our upload rules: not empty, not too big, allowed type, and contents match the type. */
  private assertFileAllowed(key: string, data: Buffer, contentType: string): void {
    if (data.length === 0) {
      throw new StorageValidationError('EMPTY_FILE', 'The file is empty.');
    }
    if (data.length > this.options.maxFileBytes) {
      const limitMb = Math.round(this.options.maxFileBytes / (1024 * 1024));
      throw new StorageValidationError(
        'FILE_TOO_LARGE',
        `File is larger than the ${limitMb} MB limit.`,
      );
    }
    if (!Object.values(ALLOWED_EXTENSIONS).includes(contentType)) {
      throw new StorageValidationError(
        'TYPE_NOT_ALLOWED',
        `Content type "${contentType}" is not allowed.`,
      );
    }
    // The extension in the key must agree with the declared type ("a.png" cannot be a PDF).
    if (contentTypeForKey(key) !== contentType) {
      throw new StorageValidationError(
        'CONTENT_MISMATCH',
        'File extension does not match the content type.',
      );
    }
    // And the real bytes must agree too.
    if (!matchesContentType(data, contentType)) {
      throw new StorageValidationError(
        'CONTENT_MISMATCH',
        'File contents do not match the declared type.',
      );
    }
  }
}

/** True for the "file or folder does not exist" error from the operating system. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
