import sharp from 'sharp';
import { StorageValidationError } from '../../storage/storage.types';

/**
 * Turns an uploaded picture into the two WebP files we keep: a full image (at most 800 px on the long side) and a
 * thumbnail (at most 160 px) for tables.
 *
 * Why re-encode instead of storing the upload: decoding the file proves it really is an image of the type it claims,
 * and writing a new file throws away everything else the upload carried (embedded scripts, GPS position and other
 * metadata in the photo). We also cap the decoded size, so a tiny file that expands to a gigantic picture cannot
 * exhaust memory (a "decompression bomb").
 */

/** Largest upload accepted (2 MB, US-PROD-01). Enforced by the upload route; repeated here for the service. */
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Refuse pictures bigger than 25 megapixels once decoded. */
const MAX_INPUT_PIXELS = 25_000_000;

const FULL_SIZE = 800;
const THUMB_SIZE = 160;

/** The pictures we keep for a product. */
export interface ProductImages {
  full: Buffer;
  thumb: Buffer;
}

/**
 * @throws StorageValidationError TYPE_NOT_ALLOWED for a picture that is not JPEG, PNG or WebP;
 *         CONTENT_MISMATCH when the bytes cannot be decoded as an image at all.
 */
export async function makeProductImages(input: Buffer): Promise<ProductImages> {
  try {
    const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const { format } = await source.metadata();
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
      throw new StorageValidationError(
        'TYPE_NOT_ALLOWED',
        'A product image must be a JPEG, PNG or WebP picture.',
      );
    }
    // `rotate()` applies the camera's orientation before the metadata is dropped, so photos are not turned sideways.
    const resize = (size: number): Promise<Buffer> =>
      source
        .clone()
        .rotate()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    const [full, thumb] = await Promise.all([resize(FULL_SIZE), resize(THUMB_SIZE)]);
    return { full, thumb };
  } catch (error) {
    if (error instanceof StorageValidationError) throw error;
    throw new StorageValidationError('CONTENT_MISMATCH', 'This file is not a readable picture.');
  }
}
