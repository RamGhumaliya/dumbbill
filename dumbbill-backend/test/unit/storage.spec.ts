import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage } from '../../src/modules/storage/local-disk.storage';
import { buildStorageKey } from '../../src/modules/storage/storage-key';
import {
  StorageObjectNotFoundError,
  StorageValidationError,
} from '../../src/modules/storage/storage.types';

const TENANT = '0b6f1c2e-8f4a-4a52-9c63-1f2d3e4a5b6c';

// Smallest byte sequences that start like real files. Enough to pass the signature check.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const PDF = Buffer.from('%PDF-1.7\n%test');

/** Read an entire stream into a Buffer (test helper). */
async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('LocalDiskStorage', () => {
  let dir: string;
  let storage: LocalDiskStorage;

  // Each test gets a fresh temporary folder so tests never touch real uploads.
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dumbbill-storage-'));
    storage = new LocalDiskStorage({ rootDir: dir, maxFileBytes: 1024 });
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('saves a file and reads the same bytes back', async () => {
    const key = buildStorageKey({ tenantId: TENANT, category: 'product-images', extension: 'png' });
    const stored = await storage.put({ key, data: PNG, contentType: 'image/png' });

    expect(stored.size).toBe(PNG.length);
    expect(stored.sha256).toHaveLength(64);
    expect(await readFile(join(dir, key))).toEqual(PNG);

    const opened = await storage.get(key);
    expect(opened.contentType).toBe('image/png');
    expect(await readAll(opened.stream)).toEqual(PNG);
  });

  it('keeps each business in its own folder', async () => {
    const key = buildStorageKey({ tenantId: TENANT, category: 'invoices', extension: 'pdf' });
    expect(key.startsWith(`${TENANT}/invoices/`)).toBe(true);
  });

  it('reports exists() correctly and delete() is safe to repeat', async () => {
    const key = buildStorageKey({ tenantId: TENANT, category: 'invoices', extension: 'pdf' });
    expect(await storage.exists(key)).toBe(false);
    await storage.put({ key, data: PDF, contentType: 'application/pdf' });
    expect(await storage.exists(key)).toBe(true);
    await storage.delete(key);
    await storage.delete(key); // second delete must not throw
    expect(await storage.exists(key)).toBe(false);
  });

  it('throws a not-found error for a missing file', async () => {
    const key = buildStorageKey({ tenantId: TENANT, category: 'misc', extension: 'png' });
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  describe('rejects unsafe or invalid uploads', () => {
    const key = () => buildStorageKey({ tenantId: TENANT, category: 'misc', extension: 'png' });

    it.each([
      ['path traversal', `${TENANT}/misc/../../etc/passwd`],
      ['absolute path', '/etc/passwd'],
      ['too deep', `${TENANT}/misc/sub/file.png`],
      ['uppercase / odd characters', `${TENANT}/misc/File Name.png`],
      ['empty key', ''],
    ])('invalid key: %s', async (_name, badKey) => {
      await expect(
        storage.put({ key: badKey, data: PNG, contentType: 'image/png' }),
      ).rejects.toMatchObject({
        code: 'INVALID_KEY',
      });
      await expect(storage.get(badKey)).rejects.toBeInstanceOf(StorageValidationError);
    });

    it('empty file', async () => {
      await expect(
        storage.put({ key: key(), data: Buffer.alloc(0), contentType: 'image/png' }),
      ).rejects.toMatchObject({
        code: 'EMPTY_FILE',
      });
    });

    it('file over the size limit', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(2048)]);
      await expect(
        storage.put({ key: key(), data: big, contentType: 'image/png' }),
      ).rejects.toMatchObject({
        code: 'FILE_TOO_LARGE',
      });
    });

    it('type that is not on the allow-list', async () => {
      await expect(
        storage.put({ key: key(), data: Buffer.from('<script>'), contentType: 'text/html' }),
      ).rejects.toMatchObject({ code: 'TYPE_NOT_ALLOWED' });
    });

    it('a script disguised as a PNG', async () => {
      await expect(
        storage.put({
          key: key(),
          data: Buffer.from('<script>alert(1)</script>'),
          contentType: 'image/png',
        }),
      ).rejects.toMatchObject({ code: 'CONTENT_MISMATCH' });
    });

    it('extension that disagrees with the declared type', async () => {
      await expect(
        storage.put({ key: key(), data: PDF, contentType: 'application/pdf' }),
      ).rejects.toMatchObject({
        code: 'CONTENT_MISMATCH',
      });
    });
  });

  it('refuses to build a key for a tenant id that is not a UUID', () => {
    expect(() =>
      buildStorageKey({ tenantId: '../evil', category: 'misc', extension: 'png' }),
    ).toThrow(StorageValidationError);
  });

  it('leaves no temporary files behind after a successful save', async () => {
    const key = buildStorageKey({ tenantId: TENANT, category: 'misc', extension: 'png' });
    await storage.put({ key, data: PNG, contentType: 'image/png' });
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(dir, TENANT, 'misc'));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('.tmp-');
  });
});
