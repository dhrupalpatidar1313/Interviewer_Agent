import { createSecretBox, parseSecretKey, type SecretBox } from './crypto.js';
import { env } from './env.js';
import { HttpError } from './http.js';

let box: SecretBox | null = null;

/** The box that encrypts candidates' provider keys. Fails with a clear 503 when the server has no secret configured. */
export function getSecretBox(): SecretBox {
  if (box) return box;
  if (!env.KEY_ENCRYPTION_SECRET) {
    throw new HttpError(
      503,
      'Saving your own API keys is not set up on this server yet.',
      'KEYS_NOT_CONFIGURED',
    );
  }
  box = createSecretBox(parseSecretKey(env.KEY_ENCRYPTION_SECRET));
  return box;
}

/** Binds a ciphertext to its owner and provider, so it cannot be replayed on another row. */
export function keyContext(userId: string, provider: string): string {
  return `${userId}:${provider}`;
}
