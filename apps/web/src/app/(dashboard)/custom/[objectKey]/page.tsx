"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";

interface FieldDef {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  options: Array<{ value: string; label: string }>;
}

interface Record {
  id: string;
  data: globalThis.Record<string, unknown>;
  ownerId: string | null;
  createdAt: string;
}

export default function CustomObjectRecordsPage() {
  const t = useTranslations("custom");
  const { objectKey } = useParams<{ objectKey: string }>();
  const [records, setRecords] = useState<Record[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState<globalThis.Record<string, unknown>>({});
  const [editId, setEditId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [recRes, fieldRes] = await Promise.all([
        api.get(`/api/v1/custom-objects/${objectKey}/records?page=${meta.page}&limit=${meta.limit}`),
        api.get(`/api/v1/custom-fields?entityType=custom_object`),
      ]);
      const recJson = recRes.ok ? await recRes.json() : { data: [], meta };
      const fieldJson = fieldRes.ok ? await fieldRes.json() : { data: [] };
      setRecords(recJson.data ?? []);
      setMeta(recJson.meta ?? meta);
      setFields(fieldJson.data ?? []);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, [objectKey, meta.page]);

  const create = async () => {
    try {
      await api.post(`/api/v1/custom-objects/${objectKey}/records`, { data: formData });
      setShowCreate(false);
      setFormData({});
      load();
    } catch (e: any) { alert(e.message); }
  };

  const update = async () => {
    if (!editId) return;
    try {
      await api.patch(`/api/v1/custom-objects/${objectKey}/records/${editId}`, { data: formData });
      setEditId(null);
      setFormData({});
      load();
    } catch (e: any) { alert(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;
    await api.delete(`/api/v1/custom-objects/${objectKey}/records/${id}`);
    load();
  };

  const renderFieldInput = (field: FieldDef) => {
    const val = formData[field.fieldKey] ?? "";
    const onChange = (v: unknown) => setFormData({ ...formData, [field.fieldKey]: v });

    switch (field.fieldType) {
      case "boolean":
        return <input type="checkbox" checked={!!val} onChange={(e) => onChange(e.target.checked)} />;
      case "number":
      case "currency":
        return <input type="number" value={String(val)} onChange={(e) => onChange(parseFloat(e.target.value))}
          className="rounded-lg border px-3 py-1.5 text-sm w-full" />;
      case "date":
        return <input type="date" value={String(val)} onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm w-full" />;
      case "enum":
        return (
          <select value={String(val)} onChange={(e) => onChange(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-sm w-full">
            <option value="">Select...</option>
            {field.options?.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o.value ?? o}</option>)}
          </select>
        );
      default:
        return <input type="text" value={String(val)} onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm w-full" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold capitalize">{objectKey.replace(/_/g, " ")}</h1>
          <p className="text-sm text-muted-foreground">{meta.total} record{meta.total !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => { setShowCreate(true); setEditId(null); setFormData({}); }}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> {t("newRecord")}
        </button>
      </div>

      {/* Create/Edit form */}
      {(showCreate || editId) && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{editId ? "Edit" : "New"} Record</p>
            <button onClick={() => { setShowCreate(false); setEditId(null); setFormData({}); }}>
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.id}>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {f.fieldLabel}{f.isRequired ? " *" : ""}
                </label>
                {renderFieldInput(f)}
              </div>
            ))}
          </div>
          <button onClick={editId ? update : create}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            {editId ? "Save" : "Create"}
          </button>
        </div>
      )}

      {/* Records list */}
      {loading ? (
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("noRecords")}</p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50">
              {fields.slice(0, 5).map((f) => (
                <th key={f.id} className="px-4 py-2 text-left font-medium">{f.fieldLabel}</th>
              ))}
              <th className="px-4 py-2 text-left font-medium">Created</th>
              <th className="px-4 py-2 w-20" />
            </tr></thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id} className="border-b hover:bg-muted/30">
                  {fields.slice(0, 5).map((f) => (
                    <td key={f.id} className="px-4 py-2">{String(rec.data?.[f.fieldKey] ?? "—")}</td>
                  ))}
                  <td className="px-4 py-2 text-muted-foreground">{new Date(rec.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditId(rec.id); setFormData(rec.data ?? {}); setShowCreate(false); }}
                        className="text-muted-foreground hover:text-primary">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(rec.id)}
                        className="text-muted-foreground hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
