# File Storage (server disk)

Uploaded files (product images, invoice PDFs, exports, logos) are saved in a folder on the server's disk. This was chosen to keep things simple for now. An S3 option can be added later without changing the rest of the code.

## How it is set up

| Setting | Default | Meaning |
|---|---|---|
| `STORAGE_DRIVER` | `local` | Server disk |
| `STORAGE_LOCAL_DIR` | `./storage` | Folder to use. Use an absolute path on a server, for example `/var/lib/dumbbill/storage` |
| `STORAGE_MAX_FILE_MB` | `5` | Largest file accepted |

The folder is created automatically. It is excluded from git.

## Folder layout

```
storage/
  <business-id>/
    product-images/<random-uuid>.png
    invoices/<random-uuid>.pdf
    exports/<random-uuid>.csv
    logos/...
```

Why:
- One folder per business keeps businesses separate, and lets you export or delete a whole business by its folder.
- File names are random. The name a user uploaded is never used, because names can contain tricks like `../../` or private information.

## What is allowed

JPEG, PNG, WebP, PDF and CSV only, up to the size limit. Product pictures and the business logo are decoded and re-encoded (product pictures as 800 px and 160 px WebP by the `sharp` library) before they are stored, so what is kept is never the raw upload. Every file is checked three ways:
1. Its extension is on the allow-list.
2. The declared type matches the extension.
3. The first bytes of the file really look like that type, so a script renamed `photo.png` is rejected.

## Using it in code

```ts
import { FileStorage } from '../storage/storage.types';
import { buildStorageKey } from '../storage/storage-key';

constructor(private readonly storage: FileStorage) {}

const key = buildStorageKey({ tenantId, category: 'product-images', extension: 'png' });
await this.storage.put({ key, data: buffer, contentType: 'image/png' });
const file = await this.storage.get(key);      // { stream, size, contentType }
await this.storage.delete(key);
```

Errors: `StorageValidationError` (bad key, too large, wrong type; return HTTP 422) and `StorageObjectNotFoundError` (HTTP 404).

## Security rules

- **Never** serve the folder as public static files. Files must be streamed through an API route that checks login, permission and that the file belongs to the caller's business.
- Save the returned `key` in the database next to the record that owns the file (for example the product). Do not save the path.
- Writes are atomic (temp file then rename), so a crash never leaves a half-written file.

## Status

The storage service is complete and tested (`test/unit/storage.spec.ts`). There is **no upload or download HTTP route yet**: those arrive in Phase 1 (step P1-4) with login and permissions, so that no file route ever exists without authentication.

## Backups and servers

- Back up this folder together with the database. Restoring one without the other leaves missing images or broken invoice links.
- One server only: local disk does not work if you run several API servers behind a load balancer, because each would have its own folder. When that time comes, add the S3 driver (one new class and one line in `storage.module.ts`).
- Watch free disk space once you deploy.
