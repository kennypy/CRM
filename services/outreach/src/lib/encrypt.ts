/**
 * Tenant-keyed secret encryption for the outreach service.
 *
 * Secrets are encrypted under each tenant's own DEK (envelope encryption —
 * see @nexcrm/service-common/tenant-crypto). decrypt() transparently falls
 * back to the shared-key legacy formats for rows written before per-tenant
 * keys existed.
 */

import {
  decryptTenantSecret,
  encryptTenantSecret,
} from "@nexcrm/service-common/tenant-crypto";

import { servicePool } from "../db";

export const encrypt = (tenantId: string, plaintext: string): Promise<string> =>
  encryptTenantSecret(servicePool, tenantId, plaintext);

export const decrypt = (tenantId: string, value: string): Promise<string> =>
  decryptTenantSecret(servicePool, tenantId, value);
