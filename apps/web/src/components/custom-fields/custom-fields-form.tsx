"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface FieldDef {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
}

interface CustomFieldsFormProps {
  entityType: string;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  columns?: number;
}

export function CustomFieldsForm({ entityType, values, onChange, columns = 2 }: CustomFieldsFormProps) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/custom-fields?entityType=${entityType}`)
      .then((res) => res.ok ? res.json() : { data: [] })
      .then((json) => {
        setFields(json.data ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [entityType]);

  if (!loaded || fields.length === 0) return null;

  const update = (key: string, val: unknown) => {
    onChange({ ...values, [key]: val });
  };

  // Tailwind can't see interpolated class names, so map to static classes.
  const gridCols = columns === 1 ? "grid-cols-1" : columns === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom fields</div>
      <div className={`grid ${gridCols} gap-3`}>
      {fields.map((field) => {
        const val = values[field.fieldKey] ?? "";
        return (
          <div key={field.id}>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {field.fieldLabel}{field.isRequired ? " *" : ""}
            </label>
            {renderField(field, val, (v) => update(field.fieldKey, v))}
          </div>
        );
      })}
      </div>
    </div>
  );
}

/**
 * Read-only display of the custom-field values stored on a record.
 * Fetches the field definitions so keys render as their human labels.
 */
export function CustomFieldsDisplay({
  entityType,
  values,
}: {
  entityType: string;
  values: Record<string, unknown> | undefined;
}) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/custom-fields?entityType=${entityType}`)
      .then((res) => res.ok ? res.json() : { data: [] })
      .then((json) => { setFields(json.data ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [entityType]);

  if (!loaded || !values) return null;
  const shown = fields.filter((f) => {
    const v = values[f.fieldKey];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });
  if (shown.length === 0) return null;

  const display = (f: FieldDef, v: unknown): string => {
    if (f.fieldType === "boolean") return v ? "Yes" : "No";
    if (Array.isArray(v)) {
      return v
        .map((x) => f.options?.find((o) => o.value === x)?.label ?? String(x))
        .join(", ");
    }
    if (f.fieldType === "enum") return f.options?.find((o) => o.value === v)?.label ?? String(v);
    return String(v);
  };

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      {shown.map((f) => (
        <div key={f.id}>
          <span className="text-muted-foreground">{f.fieldLabel}</span>
          <p className="mt-1">{display(f, values[f.fieldKey])}</p>
        </div>
      ))}
    </div>
  );
}

function renderField(
  field: FieldDef,
  value: unknown,
  onChange: (v: unknown) => void,
) {
  const cls = "w-full rounded-lg border px-3 py-1.5 text-sm bg-background";

  switch (field.fieldType) {
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border"
        />
      );
    case "number":
    case "currency":
      return (
        <input
          type="number"
          value={String(value)}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={cls}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      );
    case "datetime":
      return (
        <input
          type="datetime-local"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      );
    case "enum":
      return (
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        >
          <option value="">Select...</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label || o.value}</option>
          ))}
        </select>
      );
    case "multi_enum":
      return (
        <select
          multiple
          value={Array.isArray(value) ? value : []}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions, (o) => o.value);
            onChange(selected);
          }}
          className={cls + " min-h-[60px]"}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label || o.value}</option>
          ))}
        </select>
      );
    case "url":
    case "email":
    case "phone":
      return (
        <input
          type={field.fieldType === "url" ? "url" : field.fieldType === "email" ? "email" : "tel"}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      );
    default:
      return (
        <input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      );
  }
}
