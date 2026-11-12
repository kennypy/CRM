"use client";

/**
 * Deal detail related lists: field history (audit trail), opportunity team,
 * and revenue/overlay splits.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  DEAL_TEAM_ROLES, errorMessage, getData, revenueSplitTotal, sendData, useOrgUsers, userName,
  type DealHistoryEntry, type DealSplit, type DealTeamMember, type DealTeamRole,
} from "@/lib/l2q";

const cellInput = "rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30";

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="h-4 w-4 shrink-0" />{message}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function DealHistoryTab({ dealId, locale }: { dealId: string; locale?: string }) {
  const t = useTranslations("dealTabs");
  const [rows, setRows] = useState<DealHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getData<DealHistoryEntry[]>(`/api/v1/deals/${dealId}/history`)
      .then((d) => { if (alive) setRows(d ?? []); })
      .catch((e) => { if (alive) setError(errorMessage(e, t("historyFailed"))); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dealId, t]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="space-y-3 p-6">
      {error && <ErrorBox message={error} />}
      {!error && rows.length === 0 && <p className="text-sm italic text-muted-foreground">{t("noHistory")}</p>}
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="rounded-lg border bg-muted/20 px-3 py-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">{r.field}</span>
              <span title={new Date(r.changedAt).toLocaleString(locale)}>{formatRelativeTime(r.changedAt, locale)}</span>
            </div>
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground line-through">{fmtValue(r.oldValue)}</span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span className="font-medium">{fmtValue(r.newValue)}</span>
            </p>
            <p className="text-xs text-muted-foreground">{t("changedBy", { name: r.changedByName ?? t("system") })}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DealTeamTab({ dealId }: { dealId: string }) {
  const t = useTranslations("dealTabs");
  const tc = useTranslations("common");
  const users = useOrgUsers();
  const [rows, setRows] = useState<DealTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows((await getData<DealTeamMember[]>(`/api/v1/deals/${dealId}/team`)) ?? []); setDirty(false); }
    catch (e) { setError(errorMessage(e, t("teamFailed"))); }
    finally { setLoading(false); }
  }, [dealId, t]);
  useEffect(() => { load(); }, [load]);

  const update = (i: number, patch: Partial<DealTeamMember>) => { setDirty(true); setRows((prev) => prev.map((r, j) => j === i ? { ...r, ...patch } : r)); };

  const save = async () => {
    if (rows.some((r) => !r.userId)) { setError(t("pickUser")); return; }
    if (new Set(rows.map((r) => r.userId)).size !== rows.length) { setError(t("duplicateUser")); return; }
    setBusy(true); setError(null);
    try {
      const data = await sendData<DealTeamMember[]>("put", `/api/v1/deals/${dealId}/team`, {
        members: rows.map(({ userId, role, access }) => ({ userId, role, access })),
      });
      if (Array.isArray(data)) setRows(data);
      setDirty(false);
    } catch (e) { setError(errorMessage(e, t("saveFailed"))); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="space-y-3 p-6">
      {error && <ErrorBox message={error} />}
      {rows.length === 0 && <p className="text-sm italic text-muted-foreground">{t("noTeam")}</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select value={r.userId} onChange={(e) => update(i, { userId: e.target.value })} className={cn(cellInput, "min-w-0 flex-1")}>
            <option value="">{t("selectUser")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{userName(u)}</option>)}
            {r.userId && !users.some((u) => u.id === r.userId) && <option value={r.userId}>{r.userName ?? r.userId}</option>}
          </select>
          <select value={r.role} onChange={(e) => update(i, { role: e.target.value as DealTeamRole })} className={cellInput}>
            {DEAL_TEAM_ROLES.map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}
          </select>
          <select value={r.access} onChange={(e) => update(i, { access: e.target.value as "read" | "write" })} className={cellInput}>
            <option value="read">{t("accessRead")}</option>
            <option value="write">{t("accessWrite")}</option>
          </select>
          <button onClick={() => { setDirty(true); setRows(rows.filter((_, j) => j !== i)); }} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => { setDirty(true); setRows([...rows, { userId: "", role: "sales_engineer", access: "read" }]); }}
          className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3 w-3" />{t("addMember")}</button>
        <button onClick={save} disabled={busy || !dirty}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? t("saving") : tc("save")}
        </button>
      </div>
    </div>
  );
}

export function DealSplitsTab({ dealId }: { dealId: string }) {
  const t = useTranslations("dealTabs");
  const tc = useTranslations("common");
  const users = useOrgUsers();
  const [rows, setRows] = useState<DealSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows((await getData<DealSplit[]>(`/api/v1/deals/${dealId}/splits`)) ?? []); setDirty(false); }
    catch (e) { setError(errorMessage(e, t("splitsFailed"))); }
    finally { setLoading(false); }
  }, [dealId, t]);
  useEffect(() => { load(); }, [load]);

  const total = revenueSplitTotal(rows);
  const hasRevenue = rows.some((r) => r.splitType === "revenue");
  const totalOk = !hasRevenue || Math.abs(total - 100) < 0.001;

  const update = (i: number, patch: Partial<DealSplit>) => { setDirty(true); setRows((prev) => prev.map((r, j) => j === i ? { ...r, ...patch } : r)); };

  const save = async () => {
    if (rows.some((r) => !r.userId)) { setError(t("pickUser")); return; }
    if (!totalOk) { setError(t("splitTotalInvalid", { total })); return; }
    setBusy(true); setError(null);
    try {
      const data = await sendData<DealSplit[]>("put", `/api/v1/deals/${dealId}/splits`, {
        splits: rows.map(({ userId, splitType, percent }) => ({ userId, splitType, percent: Number(percent) })),
      });
      if (Array.isArray(data)) setRows(data);
      setDirty(false);
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      setError(code === "SPLIT_TOTAL_INVALID" ? t("splitTotalInvalid", { total }) : errorMessage(e, t("saveFailed")));
    } finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="space-y-3 p-6">
      {error && <ErrorBox message={error} />}
      {rows.length === 0 && <p className="text-sm italic text-muted-foreground">{t("noSplits")}</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select value={r.userId} onChange={(e) => update(i, { userId: e.target.value })} className={cn(cellInput, "min-w-0 flex-1")}>
            <option value="">{t("selectUser")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{userName(u)}</option>)}
            {r.userId && !users.some((u) => u.id === r.userId) && <option value={r.userId}>{r.userName ?? r.userId}</option>}
          </select>
          <select value={r.splitType} onChange={(e) => update(i, { splitType: e.target.value as DealSplit["splitType"] })} className={cellInput}>
            <option value="revenue">{t("splitRevenue")}</option>
            <option value="overlay">{t("splitOverlay")}</option>
          </select>
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={100} step="0.01" value={r.percent}
              onChange={(e) => update(i, { percent: Number(e.target.value) })}
              className={cn(cellInput, "w-20 text-right tabular-nums")} />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <button onClick={() => { setDirty(true); setRows(rows.filter((_, j) => j !== i)); }} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {hasRevenue && (
        <p className={cn("text-xs font-medium", totalOk ? "text-green-700" : "text-red-600")}>
          {t("revenueTotal", { total })}
        </p>
      )}
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => { setDirty(true); setRows([...rows, { userId: "", splitType: "revenue", percent: hasRevenue ? Math.max(0, 100 - total) : 100 }]); }}
          className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3 w-3" />{t("addSplit")}</button>
        <button onClick={save} disabled={busy || !dirty}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? t("saving") : tc("save")}
        </button>
      </div>
    </div>
  );
}
