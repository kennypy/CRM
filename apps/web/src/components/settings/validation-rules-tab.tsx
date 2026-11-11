"use client";

/**
 * Settings → Validation Rules. A rule BLOCKS the save when its condition
 * evaluates TRUE (Salesforce semantics). Flat all/any editor for the common
 * case, raw JSON for nested trees.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Braces, ListFilter, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VR_ENTITIES, VR_OPS, VR_UNARY_OPS,
  coerceVrValue, deleteData, errorMessage, fromFlatCondition, getData, sendData,
  toFlatCondition, vrValueToText,
  type ValidationRule, type VrCondition, type VrEntity, type VrLeaf, type VrOp,
} from "@/lib/l2q";

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

interface Draft {
  id?: string;
  entityType: VrEntity;
  name: string;
  active: boolean;
  errorMessage: string;
  errorField: string;
  condition: VrCondition;
}

interface LeafRow { field: string; op: VrOp; text: string; }

function RuleEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("validationRules");
  const tc = useTranslations("common");
  const flat = toFlatCondition(draft.condition);
  const [d, setD] = useState(draft);
  const [mode, setMode] = useState<"flat" | "json">(flat ? "flat" : "json");
  const [joiner, setJoiner] = useState<"all" | "any">(flat?.mode ?? "all");
  const [rows, setRows] = useState<LeafRow[]>(
    (flat?.leaves ?? []).map((l) => ({ field: l.field, op: l.op, text: vrValueToText(l.value) })),
  );
  const [json, setJson] = useState(JSON.stringify(draft.condition, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rowsToCondition = (): VrCondition =>
    fromFlatCondition(joiner, rows.map<VrLeaf>((r) => {
      const value = coerceVrValue(r.op, r.text);
      return value === undefined ? { field: r.field.trim(), op: r.op } : { field: r.field.trim(), op: r.op, value };
    }));

  const switchMode = (next: "flat" | "json") => {
    setError(null);
    if (next === mode) return;
    if (next === "json") {
      setJson(JSON.stringify(rowsToCondition(), null, 2));
      setMode("json");
      return;
    }
    try {
      const parsed = JSON.parse(json) as VrCondition;
      const f = toFlatCondition(parsed);
      if (!f) { setError(t("tooComplexForFlat")); return; }
      setJoiner(f.mode);
      setRows(f.leaves.map((l) => ({ field: l.field, op: l.op, text: vrValueToText(l.value) })));
      setMode("flat");
    } catch { setError(t("invalidJson")); }
  };

  const save = async () => {
    if (!d.name.trim()) { setError(t("nameRequired")); return; }
    if (!d.errorMessage.trim()) { setError(t("messageRequired")); return; }
    let condition: VrCondition;
    if (mode === "json") {
      try { condition = JSON.parse(json) as VrCondition; } catch { setError(t("invalidJson")); return; }
    } else {
      if (rows.length === 0 || rows.some((r) => !r.field.trim())) { setError(t("conditionRequired")); return; }
      condition = rowsToCondition();
    }
    setBusy(true); setError(null);
    try {
      const body = {
        entityType: d.entityType, name: d.name.trim(), active: d.active, condition,
        errorMessage: d.errorMessage.trim(), errorField: d.errorField.trim() || undefined,
      };
      if (d.id) await sendData("patch", `/api/v1/validation-rules/${d.id}`, body);
      else await sendData("post", "/api/v1/validation-rules", body);
      onSaved();
    } catch (e) { setError(errorMessage(e, t("saveFailed"))); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border bg-card shadow-xl" style={{ maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">{d.id ? t("editRule") : t("newRule")}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>{t("object")}</label>
              <select value={d.entityType} onChange={(e) => setD({ ...d, entityType: e.target.value as VrEntity })} disabled={!!d.id} className={inputCls}>
                {VR_ENTITIES.map((en) => <option key={en} value={en}>{t(`entities.${en}`)}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t("name")}</label>
              <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputCls} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="rounded border-border" />
            {t("active")}
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className={labelCls}>{t("blockWhen")}</p>
              <div className="flex gap-1 rounded-lg border p-0.5">
                <button type="button" onClick={() => switchMode("flat")}
                  className={cn("flex items-center gap-1 rounded-md px-2 py-0.5 text-xs", mode === "flat" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  <ListFilter className="h-3 w-3" />{t("simple")}
                </button>
                <button type="button" onClick={() => switchMode("json")}
                  className={cn("flex items-center gap-1 rounded-md px-2 py-0.5 text-xs", mode === "json" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  <Braces className="h-3 w-3" />JSON
                </button>
              </div>
            </div>
            {mode === "flat" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{t("match")}</span>
                  <select value={joiner} onChange={(e) => setJoiner(e.target.value as "all" | "any")} className="rounded border border-border bg-background px-2 py-1 text-xs">
                    <option value="all">{t("allConditions")}</option>
                    <option value="any">{t("anyCondition")}</option>
                  </select>
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input value={r.field} placeholder={t("fieldPlaceholder")}
                      onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}
                      className={cn(inputCls, "w-44 font-mono text-xs")} />
                    <select value={r.op} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, op: e.target.value as VrOp } : x))}
                      className={cn(inputCls, "w-40")}>
                      {VR_OPS.map((o) => <option key={o} value={o}>{t(`ops.${o}`)}</option>)}
                    </select>
                    {!VR_UNARY_OPS.has(r.op) && (
                      <input value={r.text} placeholder={r.op === "in" ? t("listPlaceholder") : t("valuePlaceholder")}
                        onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                        className={cn(inputCls, "min-w-0 flex-1")} />
                    )}
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setRows([...rows, { field: "", op: "is_blank", text: "" }])}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3 w-3" />{t("addCondition")}</button>
              </div>
            ) : (
              <>
                <textarea rows={10} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false}
                  className={cn(inputCls, "resize-y font-mono text-xs")} />
                <p className="mt-1 text-xs text-muted-foreground">{t("jsonHint")}</p>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>{t("errorMessage")}</label>
              <input value={d.errorMessage} onChange={(e) => setD({ ...d, errorMessage: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("errorField")}</label>
              <input value={d.errorField} onChange={(e) => setD({ ...d, errorField: e.target.value })} placeholder={t("optional")} className={cn(inputCls, "font-mono text-xs")} />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">{tc("cancel")}</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? t("saving") : tc("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ValidationRulesTab() {
  const t = useTranslations("validationRules");
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [filter, setFilter] = useState<VrEntity | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRules((await getData<ValidationRule[]>("/api/v1/validation-rules")) ?? []); }
    catch (e) { setError(errorMessage(e, t("loadFailed"))); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const remove = async (r: ValidationRule) => {
    if (!confirm(t("deleteConfirm", { name: r.name }))) return;
    try { await deleteData(`/api/v1/validation-rules/${r.id}`); load(); }
    catch (e) { setError(errorMessage(e, t("deleteFailed"))); }
  };
  const toggle = async (r: ValidationRule) => {
    try { await sendData("patch", `/api/v1/validation-rules/${r.id}`, { active: !r.active }); load(); }
    catch (e) { setError(errorMessage(e, t("saveFailed"))); }
  };

  const visible = rules.filter((r) => filter === "all" || r.entityType === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <button onClick={() => setEditing({ entityType: filter === "all" ? "deal" : filter, name: "", active: true, errorMessage: "", errorField: "", condition: { all: [] } })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" />{t("newRule")}
        </button>
      </div>
      <div className="flex w-fit gap-1 rounded-lg border p-1">
        {(["all", ...VR_ENTITIES] as const).map((en) => (
          <button key={en} onClick={() => setFilter(en)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium", filter === en ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {en === "all" ? t("allObjects") : t(`entities.${en}`)}
          </button>
        ))}
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {[t("object"), t("name"), t("errorMessage"), t("active"), ""].map((h, i) => (
                <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t("loading")}</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t("empty")}</td></tr>
            ) : visible.map((r) => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-4 py-2.5">{t(`entities.${r.entityType}`)}</td>
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.errorMessage}{r.errorField && <span className="ml-1 font-mono text-xs">({r.errorField})</span>}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => toggle(r)}
                    className={cn("rounded-full px-2 py-0.5 text-xs font-medium", r.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                    {r.active ? t("on") : t("off")}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setEditing({ id: r.id, entityType: r.entityType, name: r.name, active: r.active, errorMessage: r.errorMessage, errorField: r.errorField ?? "", condition: r.condition })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(r)} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RuleEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
