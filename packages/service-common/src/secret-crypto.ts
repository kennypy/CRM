/**
 * AES-256-GCM secret encryption shared by the Node services.
 *
 * Key source: OAUTH_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 *
 * Canonical wire format (writes): "iv:authTag:ciphertext", all hex.
 *
 * Historically three services each rolled their own incompatible format over
 * the SAME oauth_tokens table:
 *   - api-gateway: hex(iv):hex(tag):hex(ct)        ← canonical, kept
 *   - auth:        base64(iv):base64(tag):base64(ct)
 *   - outreach:    base64(iv ‖ ct ‖ tag), no separators
 * A token written by auth could not be decrypted by outreach. decryptSecret()
 * therefore accepts ALL THREE formats so existing rows keep working, while
 * every new write uses the canonical hex format.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16;

function getKey(): Buffer {
  const hex = process.env.OAUTH_ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt a string with AES-256-GCM. Returns "iv:authTag:ciphertext" (all hex). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptParts(iv: Buffer, tag: Buffer, data: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const HEX_RE = /^[0-9a-fA-F]+$/;

/** Decrypt a value produced by any historical encrypt variant (see header).
 * Throws if the ciphertext is malformed or has been tampered with. */
export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(":");

  if (parts.length === 3) {
    const [ivS, tagS, encS] = parts;
    // Hex format has a 24-char IV; base64 IV is 16 chars. Disambiguate by
    // decoding with whichever alphabet actually fits.
    const isHex = HEX_RE.test(ivS) && ivS.length === IV_BYTES * 2;
    const enc = (s: string) => Buffer.from(s, isHex ? "hex" : "base64");
    return decryptParts(enc(ivS), enc(tagS), enc(encS));
  }

  // Legacy outreach format: base64(iv ‖ ciphertext ‖ tag)
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const data = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  return decryptParts(iv, tag, data);
}
