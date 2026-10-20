import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** One encrypted secret, as stored in the database. All fields are base64. */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface SecretBox {
  /** `context` is authenticated but not stored; decrypting with a different one fails (see below). */
  encrypt(plaintext: string, context: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret, context: string): string;
}

const KEY_BYTES = 32;

/** Parses KEY_ENCRYPTION_SECRET: 32 random bytes, base64 (generate with `openssl rand -base64 32`). */
export function parseSecretKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`KEY_ENCRYPTION_SECRET must be ${KEY_BYTES} random bytes, base64 encoded (openssl rand -base64 32)`);
  }
  return key;
}

/**
 * AES-256-GCM with a fresh random 96-bit IV per secret. The caller passes a context string (we use
 * "<userId>:<provider>") as additional authenticated data: a ciphertext copied onto another user's row, or another
 * provider's row, then fails to decrypt instead of quietly handing one person's key to another.
 */
export function createSecretBox(key: Buffer): SecretBox {
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
      };
    },
    decrypt(secret, context) {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(secret.iv, 'base64'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}

/** What is safe to show a person about a key they pasted: the last four characters. */
export function last4(secret: string): string {
  return secret.trim().slice(-4);
}
