/**
 * Custom field value validator — validates field values against their definitions.
 */

import { pool } from "../db";

export interface FieldDefinition {
  id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: unknown[];
  validations: Record<string, unknown>;
  is_required: boolean;
  default_value: string | null;
}

interface ValidationError {
  field: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/;
const PHONE_RE = /^[+\d][\d\s\-().]{4,20}$/;

/**
 * Fetch active custom field definitions for a given tenant + entity type.
 */
export async function getFieldDefinitions(
  tenantId: string,
  entityType: string,
  customObjectId?: string
): Promise<FieldDefinition[]> {
  const { rows } = await pool.query(
    `SELECT id, field_key, field_label, field_type, options, validations,
            is_required, default_value
     FROM custom_field_definitions
     WHERE tenant_id = $1 AND entity_type = $2
       AND ($3::uuid IS NULL OR custom_object_id = $3)
       AND is_active = true
     ORDER BY sort_order, created_at`,
    [tenantId, entityType, customObjectId ?? null]
  );
  return rows as FieldDefinition[];
}

/**
 * Validate a map of custom field values against definitions.
 * Returns errors array (empty = valid).
 */
export function validateCustomFields(
  definitions: FieldDefinition[],
  values: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const defMap = new Map(definitions.map((d) => [d.field_key, d]));

  // Check required fields
  for (const def of definitions) {
    if (def.is_required && (values[def.field_key] === undefined || values[def.field_key] === null || values[def.field_key] === "")) {
      errors.push({ field: def.field_key, message: `${def.field_label} is required` });
    }
  }

  // Validate provided values
  for (const [key, value] of Object.entries(values)) {
    const def = defMap.get(key);
    if (!def) continue; // Ignore unknown fields
    if (value === null || value === undefined || value === "") continue;

    const v = def.validations;

    switch (def.field_type) {
      case "text": {
        if (typeof value !== "string") {
          errors.push({ field: key, message: `${def.field_label} must be text` });
          break;
        }
        if (v.min && value.length < (v.min as number))
          errors.push({ field: key, message: `${def.field_label} must be at least ${v.min} characters` });
        if (v.max && value.length > (v.max as number))
          errors.push({ field: key, message: `${def.field_label} must be at most ${v.max} characters` });
        if (v.regex && !new RegExp(v.regex as string).test(value))
          errors.push({ field: key, message: `${def.field_label} format is invalid` });
        break;
      }
      case "number":
      case "currency": {
        const num = typeof value === "number" ? value : parseFloat(String(value));
        if (isNaN(num)) {
          errors.push({ field: key, message: `${def.field_label} must be a number` });
          break;
        }
        if (v.min !== undefined && num < (v.min as number))
          errors.push({ field: key, message: `${def.field_label} must be at least ${v.min}` });
        if (v.max !== undefined && num > (v.max as number))
          errors.push({ field: key, message: `${def.field_label} must be at most ${v.max}` });
        break;
      }
      case "date":
      case "datetime": {
        const d = new Date(String(value));
        if (isNaN(d.getTime()))
          errors.push({ field: key, message: `${def.field_label} must be a valid date` });
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean")
          errors.push({ field: key, message: `${def.field_label} must be true or false` });
        break;
      }
      case "enum": {
        const opts = (def.options as Array<{ value: string }>).map((o) => o.value ?? o);
        if (!opts.includes(String(value)))
          errors.push({ field: key, message: `${def.field_label} must be one of: ${opts.join(", ")}` });
        break;
      }
      case "multi_enum": {
        if (!Array.isArray(value)) {
          errors.push({ field: key, message: `${def.field_label} must be an array` });
          break;
        }
        const opts = (def.options as Array<{ value: string }>).map((o) => o.value ?? o);
        for (const item of value) {
          if (!opts.includes(String(item)))
            errors.push({ field: key, message: `${def.field_label}: "${item}" is not a valid option` });
        }
        break;
      }
      case "email": {
        if (!EMAIL_RE.test(String(value)))
          errors.push({ field: key, message: `${def.field_label} must be a valid email` });
        break;
      }
      case "url": {
        if (!URL_RE.test(String(value)))
          errors.push({ field: key, message: `${def.field_label} must be a valid URL` });
        break;
      }
      case "phone": {
        if (!PHONE_RE.test(String(value)))
          errors.push({ field: key, message: `${def.field_label} must be a valid phone number` });
        break;
      }
      case "lookup": {
        if (typeof value !== "string")
          errors.push({ field: key, message: `${def.field_label} must be a valid ID` });
        break;
      }
    }
  }

  return errors;
}

/**
 * Apply default values to missing fields.
 */
export function applyDefaults(
  definitions: FieldDefinition[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...values };
  for (const def of definitions) {
    if (result[def.field_key] === undefined && def.default_value !== null) {
      switch (def.field_type) {
        case "number":
        case "currency":
          result[def.field_key] = parseFloat(def.default_value);
          break;
        case "boolean":
          result[def.field_key] = def.default_value === "true";
          break;
        default:
          result[def.field_key] = def.default_value;
      }
    }
  }
  return result;
}
