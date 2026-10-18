// Prints fresh secrets for the sign-in system. Nothing is written to disk: copy the lines you need into the
// server's settings (the real environment variables in production, or your own `.env` for a trial run).
//
//   pnpm keys:generate
//
// WHAT EACH ONE IS FOR (see docs/runbooks/rotate-secrets.md):
//   JWT_PRIVATE_KEY      signs the 15-minute access tokens (Ed25519). Base64 of the PEM so it fits on one line.
//   JWT_KEY_ID           a name for that key, written in every token, so keys can be rotated safely.
//   DATA_ENCRYPTION_KEY  32 random bytes that encrypt secrets we must read back (authenticator-app secrets).
//   PASSWORD_PEPPERS     a server-side secret mixed into every password before hashing. Entries are
//                        `version:secret`; to rotate, ADD a higher version and keep the old one listed.
//
// SAFETY: run this on a machine you trust, put the values straight into a secret store, and never commit
// them, paste them into chat or write them in a ticket. A leaked value must be rotated, not just deleted.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const stamp = new Date().toISOString().slice(0, 7); // for example 2026-10

process.stdout.write(`# Generated ${new Date().toISOString()} - keep these secret
JWT_KEY_ID=prod-${stamp}
JWT_PRIVATE_KEY=${Buffer.from(pem).toString('base64')}
DATA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}
PASSWORD_PEPPERS=1:${randomBytes(32).toString('hex')}
`);
