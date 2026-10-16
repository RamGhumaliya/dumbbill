/**
 * "Magic byte" checks: the first bytes of a file tell us what it really is.
 *
 * We do this because the MIME type and file name sent by a client can be faked.
 * Without this check, someone could upload an HTML or script file called "photo.png".
 * Here the real contents must match what the client says they are.
 */

/** Return true if `data` starts with the given byte pattern. */
function startsWith(data: Buffer, bytes: number[], offset = 0): boolean {
  if (data.length < offset + bytes.length) return false;
  return bytes.every((b, i) => data[offset + i] === b);
}

/** Does the content really look like the claimed MIME type? */
export function matchesContentType(data: Buffer, contentType: string): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return startsWith(data, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      // "RIFF" at the start and "WEBP" at byte 8.
      return (
        startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case 'application/pdf':
      // "%PDF-"
      return startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'text/csv':
      // CSV has no signature. We only make sure it is not binary (no NUL bytes in the first 1 KB).
      return !data.subarray(0, 1024).includes(0x00);
    default:
      return false;
  }
}
