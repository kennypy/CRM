/**
 * AES-256-GCM encryption / decryption — matches the pattern used by the auth
 * service for OAuth token storage.
 *
 * Key source: OAUTH_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * Never store plaintext credentials in the database.
 */

import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES   = 12; // 96-bit IV recommended for GCM
const TAG_BYTES  = 16;

function getKey(): Buffer {
  const hex = process.env.OAUTH_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext.
 * Returns a base64-encoded string of: IV (12 bytes) || ciphertext || auth tag (16 bytes).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv  = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/**
 * Decrypt a value produced by `encrypt`.
 * Throws if the ciphertext has been tampered with (GCM auth tag mismatch).
 */
export function decrypt(ciphertext: string): string {
  const key  = getKey();
  const buf  = Buffer.from(ciphertext, "base64");
  const iv   = buf.subarray(0, IV_BYTES);
  const tag  = buf.subarray(buf.length - TAG_BYTES);
  const data = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}
