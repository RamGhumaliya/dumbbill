import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';

/**
 * Encrypts small secrets that we must be able to READ BACK, as opposed to passwords, which we only
 * ever compare. Today that is the TOTP (authenticator app) secret: the server needs the real value to
 * calculate the expected code, so it cannot be a one-way hash, but it must not sit in the database in clear
 * text either.
 *
 * Method: AES-256-GCM (encryption that also detects tampering), a fresh random nonce per value.
 * Stored form: `v1.<nonce>.<tag>.<ciphertext>` (each part base64url). The `v1` lets us change the method later.
 * Key: DATA_ENCRYPTION_KEY, 32 random bytes as base64. It lives in the server's settings, not the database,
 * so a stolen database alone does not reveal the secrets.
 */
@Injectable()
export class SecretCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService, logger: Logger) {
    const configured = config.get<string>('DATA_ENCRYPTION_KEY');
    if (configured) {
      this.key = Buffer.from(configured, 'base64');
      if (this.key.length !== 32) {
        throw new Error(
          'DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64 (use `pnpm keys:generate`).',
        );
      }
    } else {
      logger.warn({
        msg: 'DATA_ENCRYPTION_KEY is not set: using a development key. Never do this in production.',
      });
      this.key = Buffer.alloc(32, 7);
    }
  }

  /** Encrypt a text value. */
  encrypt(plain: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      'v1',
      nonce.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      body.toString('base64url'),
    ].join('.');
  }

  /** Decrypt a value made by `encrypt`. Throws if it was changed or the key is wrong. */
  decrypt(stored: string): string {
    const [version, nonce, tag, body] = stored.split('.');
    if (version !== 'v1' || !nonce || !tag || !body)
      throw new Error('Unknown encrypted value format.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
