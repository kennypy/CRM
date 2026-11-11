"use client";

/**
 * Settings → Lead Assignment. Ordered rules (lower priority runs first); the
 * first active rule whose conditions all match assigns the lead to a user or
 * round-robins across a team.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ASSIGNMENT_FIELDS, ASSIGNMENT_OPS, deleteData, errorMessage, getData, sendData,
  useOrgTeams, useOrgUsers, userName,
  type AssignmentCondition, type AssignmentOp, type AssignmentRule,
} from "@/lib/l2q";

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

type Draft = Omit<AssignmentRule, "id"> & { id?: string };

function emptyDraft(priority: number): Draft {
  return { name: "", priority, active: true, conditions: [], assignToType: "user", assignToId: "" };
}

function valueText(v: AssignmentCondition["value"]): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? v.join(", ") : v;
}

function RuleEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("assignmentRules");
  const tc = useTranslations("common");
  const users = useOrgUsers();
  const teams = useOrgTeams();
  const [d, setD] = useState<Draft>(draft);
  const [customKeys, setCustomKeys] = useState<Record<number, string>>(() =>
    Object.fromEntries(draft.conditions.map((c, i) => [i, c.field.startsWith("customFields.") ? c.field.slice(13) : ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCond = (i: number, patch: Partial<AssignmentCondition>) =>
    setD((prev) => ({ ...prev, conditions: prev.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const save = async () => {
    if (!d.name.trim()) { setError(t("nameRequired")); return; }
    if (!d.assignToId) { setError(t("assigneeRequired")); return; }
    const conditions: AssignmentCondition[] = d.conditions.map((c, i) => {
      const field = c.field === "__custom" ? `customFields.${(customKeys[i] ?? "").trim()}` : c.field;
      const raw = valueText(c.value);
      const value = c.op === "exists" ? undefined : c.op === "in" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw;
      return { field, op: c.op, ...(value !== undefined ? { value } : {}) };
    });
    if (conditions.some((c) => c.field === "customFields.")) { setError(t("customKeyRequired")); return; }
    setBusy(true); setError(null);
    try {
      const body = { name: d.name.trim(), priority: d.priority, active: d.active, conditions, assignToType: d.assignToType, assignToId: d.assignToId };
      if (d.id) await sendData("patch", `/api/v1/leads/assignment-rules/${d.id}`, body);
      else await sendData("post", "/api/v1/leads/assignment-rules", body);
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
            <div className="col-span-2">
              <label className={labelCls}>{t("name")}</label>
              <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("priority")}</label>
              <input type="number" min={0} value={d.priority} onChange={(e) => setD({ ...d, priority: parseInt(e.target.value, 10) || 0 })} className={inputCls} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="rounded border-border" />
            {t("active")}
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className={labelCls}>{t("conditions")}</p>
              <button type="button" onClick={() => setD({ ...d, conditions: [...d.conditions, { field: "source", op: "eq", value: "" }] })}
                className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3 w-3" />{t("addCondition")}</button>
            </div>
            {d.conditions.length === 0 && <p className="text-xs text-muted-foreground">{t("noConditionsHint")}</p>}
            <div className="space-y-2">
              {d.conditions.map((c, i) => {
                const isCustom = c.field === "__custom" || c.field.startsWith("customFields.");
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select value={isCustom ? "__custom" : c.field}
                      onChange={(e) => setCond(i, { field: e.target.value })}
                      className={cn(inputCls, "w-40")}>
                      {ASSIGNMENT_FIELDS.map((f) => <option key={f} value={f}>{t(`fields.${f}`)}</option>)}
                      <option value="__custom">{t("fields.custom")}</option>
                    </select>
                    {isCustom && (
                      <input value={customKeys[i] ?? ""} placeholder={t("customKeyPlaceholder")}
                        onChange={(e) => { setCustomKeys({ ...customKeys, [i]: e.target.value }); setCond(i, { field: "__custom" }); }}
                        className={cn(inputCls, "w-36")} />
                    )}
                    <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as AssignmentOp })} className={cn(inputCls, "w-36")}>
                      {ASSIGNMENT_OPS.map((o) => <option key={o} value={o}>{t(`ops.${o}`)}</option>)}
                    </select>
                    {c.op !== "exists" && (
                      <input value={valueText(c.value)} onChange={(e) => setCond(i, { value: e.target.value })}
                        placeholder={c.op === "in" ? t("listPlaceholder") : t("valuePlaceholder")}
                        className={cn(inputCls, "min-w-0 flex-1")} />
                    )}
                    <button type="button" onClick={() => setD({ ...d, conditions: d.conditions.filter((_, j) => j !== i) })}
                      className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("assignTo")}</label>
              <select value={d.assignToType} onChange={(e) => setD({ ...d, assignToType: e.target.value as Draft["assignToType"], assignToId: "" })} className={inputCls}>
                <option value="user">{t("assignUser")}</option>
                <option value="team_round_robin">{t("assignTeamRoundRobin")}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{d.assignToType === "user" ? t("user") : t("team")}</label>
              <select value={d.assignToId} onChange={(e) => setD({ ...d, assignToId: e.target.value })} className={inputCls}>
                <option value="">—</option>
                {d.assignToType === "user"
                  ? users.map((u) => <option key={u.id} value={u.id}>{userName(u)}</option>)
                  : teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </select>
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

export function AssignmentRulesTab() {
  const t = useTranslations("assignmentRules");
  const users = useOrgUsers();
  const teams = useOrgTeams();
  const [rules, setRules] = useState<AssignmentRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await getData<AssignmentRule[]>("/api/v1/leads/assignment-rules");
      setRules([...(data ?? [])].sort((a, b) => a.priority - b.priority));
    } catch (e) { setError(errorMessage(e, t("loadFailed"))); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const remove = async (r: AssignmentRule) => {
    if (!confirm(t("deleteConfirm", { name: r.name }))) return;
    try { await deleteData(`/api/v1/leads/assignment-rules/${r.id}`); load(); }
    catch (e) { setError(errorMessage(e, t("deleteFailed"))); }
  };

  const toggle = async (r: AssignmentRule) => {
    try { await sendData("patch", `/api/v1/leads/assignment-rules/${r.id}`, { active: !r.active }); load(); }
    catch (e) { setError(errorMessage(e, t("saveFailed"))); }
  };

  const assigneeLabel = (r: AssignmentRule) => r.assignToType === "user"
    ? userName(users.find((u) => u.id === r.assignToId))
    : `${teams.find((tm) => tm.id === r.assignToId)?.name ?? "—"} (${t("roundRobin")})`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <button onClick={() => setEditing(emptyDraft((rules.at(-1)?.priority ?? 0) + 10))}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" />{t("newRule")}
        </button>
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
              {[t("priority"), t("name"), t("conditions"), t("assignTo"), t("active"), ""].map((h, i) => (
                <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t("loading")}</td></tr>
            ) : rules.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t("empty")}</td></tr>
            ) : rules.map((r) => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-4 py-2.5 tabular-nums">{r.priority}</td>
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {r.conditions.length === 0 ? t("matchesAll") : r.conditions.map((c) =>
                    `${c.field} ${t(`ops.${c.op}`)}${c.value !== undefined ? ` ${valueText(c.value)}` : ""}`).join(" · ")}
                </td>
                <td className="px-4 py-2.5">{assigneeLabel(r)}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => toggle(r)}
                    className={cn("rounded-full px-2 py-0.5 text-xs font-medium", r.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                    {r.active ? t("on") : t("off")}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setEditing({ ...r })} className="rounded p-1 text-muted-foreground hover:bg-muted"><Pencil className="h-3.5 w-3.5" /></button>
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
