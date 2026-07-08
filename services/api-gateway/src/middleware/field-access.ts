/**
 * Field-level access control middleware.
 * Strips hidden fields from responses and blocks writes to read-only fields.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db";

interface FieldPerm {
  field_name: string;
  access_level: "hidden" | "read_only" | "read_write";
}

// Short-lived cache of (tenant,entity,role) → perms map. Field masking runs on
// every non-admin read of the hot entities; without this each read pays a
// field_permissions round-trip even when the tenant has configured nothing.
// 30s TTL keeps admin permission changes near-live.
const _permCache = new Map<string, { perms: Map<string, string>; exp: number }>();
const _PERM_TTL_MS = 30_000;

/**
 * Get field permissions for a role on an entity type.
 * Returns a map of field_name → access_level.
 * Fields not in the map default to 'read_write'.
 */
export async function getFieldPermissions(
  tenantId: string,
  entityType: string,
  role: string
): Promise<Map<string, string>> {
  const key = `${tenantId}:${entityType}:${role}`;
  const hit = _permCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.perms;

  const { rows } = await pool.query<FieldPerm>(
    `SELECT field_name, access_level FROM field_permissions
     WHERE tenant_id = $1 AND entity_type = $2 AND role = $3`,
    [tenantId, entityType, role]
  );

  const perms = new Map(rows.map((r) => [r.field_name, r.access_level]));
  _permCache.set(key, { perms, exp: Date.now() + _PERM_TTL_MS });
  return perms;
}

// Top-level keys in a composite payload that carry a known sub-entity, mapped to
// the entity_type whose field_permissions govern them. Lets us mask nested data
// (e.g. /companies/:id/detail → { company, contacts[], deals[], activities[] }).
const NESTED_KEY_ENTITY: Record<string, string> = {
  company: "company", companies: "company",
  contact: "contact", contacts: "contact",
  deal: "deal", deals: "deal",
  activity: "activity", activities: "activity",
};

/**
 * Recursively mask a response `data` payload for a role. The top-level node is
 * masked with `primaryEntity`'s perms; any nested key that carries a known
 * sub-entity is masked with THAT entity's perms. Handles both flat entities,
 * arrays of entities, and composite detail wrappers. Admin bypass is the
 * caller's responsibility.
 */
export async function maskResponseData(
  data: unknown,
  primaryEntity: string,
  tenantId: string,
  role: string
): Promise<unknown> {
  const cache = new Map<string, Map<string, string>>();
  const permsFor = async (entity: string) => {
    if (!cache.has(entity)) cache.set(entity, await getFieldPermissions(tenantId, entity, role));
    return cache.get(entity)!;
  };

  const maskNode = async (node: unknown, entity: string, depth: number): Promise<unknown> => {
    if (node == null || typeof node !== "object" || depth > 4) return node;
    if (Array.isArray(node)) {
      return Promise.all(node.map((el) => maskNode(el, entity, depth)));
    }
    const perms = await permsFor(entity);
    const stripped = stripHiddenFields({ ...(node as Record<string, unknown>) }, perms) as Record<string, unknown>;
    for (const [k, v] of Object.entries(stripped)) {
      const nested = NESTED_KEY_ENTITY[k];
      if (nested && v && typeof v === "object") {
        stripped[k] = await maskNode(v, nested, depth + 1);
      }
    }
    return stripped;
  };

  return maskNode(data, primaryEntity, 0);
}

/**
 * Strip hidden fields from a response object (or array of objects).
 */
export function stripHiddenFields(
  data: Record<string, unknown> | Record<string, unknown>[],
  perms: Map<string, string>
): typeof data {
  const hiddenFields = new Set<string>();
  for (const [field, level] of perms) {
    if (level === "hidden") hiddenFields.add(field);
  }

  if (hiddenFields.size === 0) return data;

  const strip = (obj: Record<string, unknown>) => {
    const result = { ...obj };
    for (const field of hiddenFields) {
      delete result[field];
    }
    // Also strip from nested custom_fields
    if (result.custom_fields && typeof result.custom_fields === "object") {
      const cf = { ...(result.custom_fields as Record<string, unknown>) };
      for (const field of hiddenFields) {
        delete cf[field];
      }
      result.custom_fields = cf;
    }
    return result;
  };

  if (Array.isArray(data)) return data.map(strip);
  return strip(data);
}

/**
 * Get the set of read-only fields for a given role + entity type.
 */
export function getReadOnlyFields(perms: Map<string, string>): Set<string> {
  const readOnly = new Set<string>();
  for (const [field, level] of perms) {
    if (level === "read_only" || level === "hidden") readOnly.add(field);
  }
  return readOnly;
}

/**
 * Fastify preHandler that blocks writes to read-only or hidden fields.
 * Checks the request body for any field that the user's role cannot write.
 */
export function blockReadOnlyFields(entityType: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.body || typeof request.body !== "object") return;

    const { tenantId, role } = request.user;
    if (role === "admin" || role === "super_admin") return;

    const perms = await getFieldPermissions(tenantId, entityType, role);
    const readOnly = getReadOnlyFields(perms);

    if (readOnly.size === 0) return;

    const body = request.body as Record<string, unknown>;
    const violations: string[] = [];

    for (const key of Object.keys(body)) {
      if (readOnly.has(key)) violations.push(key);
    }

    // Also check nested custom_fields
    if (body.custom_fields && typeof body.custom_fields === "object") {
      for (const key of Object.keys(body.custom_fields as Record<string, unknown>)) {
        if (readOnly.has(key)) violations.push(key);
      }
    }

    if (violations.length > 0) {
      return reply.status(403).send({
        success: false,
        error: {
          code: "FIELD_ACCESS_DENIED",
          message: `You do not have write access to: ${violations.join(", ")}`,
        },
      });
    }
  };
}
