/**
 * Per-tenant envelope encryption.
 *
 * Every tenant gets its own random 256-bit data-encryption key (DEK), created
 * lazily on first use and stored in tenant_encryption_keys wrapped by the
 * master key-encryption key (TENANT_KEK env var, 64 hex chars; falls back to
 * OAUTH_ENCRYPTION_KEY so existing deployments need no new secret to adopt
 * this — though a dedicated KEK is recommended).
 *
 * Wire format for tenant-encrypted secrets:
 *   t1:<key_version>:<iv hex>:<tag hex>:<ciphertext hex>
 *
 * decryptTenantSecret() transparently falls back to the shared-key
 * decryptSecret() for values without the t1: prefix, so all historical rows
 * (three legacy formats) keep working while new writes use the tenant DEK.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { Pool } from "pg";

import { decryptSecret } from "./secret-crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getKek(): Buffer {
  const hex = process.env.TENANT_KEK ?? process.env.OAUTH_ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("TENANT_KEK (or OAUTH_ENCRYPTION_KEY) must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

function gcmEncrypt(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

function gcmDecrypt(key: Buffer, value: string): Buffer {
  const [ivHex, tagHex, ctHex] = value.split(":");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
}

interface DekEntry { dek: Buffer; version: number; exp: number }
const _dekCache = new Map<string, DekEntry>();
const DEK_TTL_MS = 5 * 60_000;

/** Load (or lazily create) a tenant's DEK. */
export async function getTenantDek(
  db: Pool,
  tenantId: string
): Promise<{ dek: Buffer; version: number }> {
  const hit = _dekCache.get(tenantId);
  if (hit && hit.exp > Date.now()) return { dek: hit.dek, version: hit.version };

  const kek = getKek();
  const { rows } = await db.query<{ wrapped_dek: string; key_version: number }>(
    `SELECT wrapped_dek, key_version FROM tenant_encryption_keys WHERE tenant_id = $1`,
    [tenantId]
  );

  let dek: Buffer;
  let version: number;
  if (rows.length) {
    dek = gcmDecrypt(kek, rows[0].wrapped_dek);
    version = rows[0].key_version;
  } else {
    dek = randomBytes(32);
    version = 1;
    // Concurrent first-use is fine: ON CONFLICT keeps the winner's DEK and we
    // re-read to stay consistent.
    const { rows: ins } = await db.query<{ wrapped_dek: string; key_version: number }>(
      `INSERT INTO tenant_encryption_keys (tenant_id, wrapped_dek, key_version)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
       RETURNING wrapped_dek, key_version`,
      [tenantId, gcmEncrypt(kek, dek)]
    );
    dek = gcmDecrypt(kek, ins[0].wrapped_dek);
    version = ins[0].key_version;
  }

  _dekCache.set(tenantId, { dek, version, exp: Date.now() + DEK_TTL_MS });
  return { dek, version };
}

/** Encrypt a secret under the tenant's own DEK. */
export async function encryptTenantSecret(
  db: Pool,
  tenantId: string,
  plaintext: string
): Promise<string> {
  const { dek, version } = await getTenantDek(db, tenantId);
  return `t1:${version}:${gcmEncrypt(dek, Buffer.from(plaintext, "utf8"))}`;
}

/** Decrypt a tenant secret; falls back to the shared-key legacy formats for
 * values without the t1: prefix. */
export async function decryptTenantSecret(
  db: Pool,
  tenantId: string,
  value: string
): Promise<string> {
  if (!value.startsWith("t1:")) return decryptSecret(value);
  const [, , iv, tag, ct] = value.split(":");
  const { dek } = await getTenantDek(db, tenantId);
  return gcmDecrypt(dek, `${iv}:${tag}:${ct}`).toString("utf8");
}

/** Re-wrap a tenant's DEK under the current KEK (key rotation). Bumps
 * key_version; data does not need re-encryption (the DEK is unchanged). */
export async function rotateTenantKeyWrap(db: Pool, tenantId: string): Promise<number> {
  const { dek, version } = await getTenantDek(db, tenantId);
  const next = version + 1;
  await db.query(
    `UPDATE tenant_encryption_keys
     SET wrapped_dek = $1, key_version = $2, rotated_at = NOW()
     WHERE tenant_id = $3`,
    [gcmEncrypt(getKek(), dek), next, tenantId]
  );
  _dekCache.delete(tenantId);
  return next;
}
