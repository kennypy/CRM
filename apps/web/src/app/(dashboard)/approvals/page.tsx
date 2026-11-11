"use client";

/**
 * Approvals inbox — multi-step approval requests (quote discounts today).
 * "Awaiting me" = requests whose current step is assigned to the caller;
 * "Submitted" = requests the caller submitted (and may recall).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertCircle, CheckCircle2, ClipboardCheck, Clock, RefreshCw, Undo2, X, XCircle,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import {
  APPROVAL_STATUS_COLORS, errorMessage, getData, sendData,
  type ApprovalRequest, type ApprovalStatus,
} from "@/lib/l2q";

type Scope = "mine" | "submitted" | "all";

function ActionModal({ request, action, onClose, onDone }: {
  request: ApprovalRequest;
  action: "approve" | "reject";
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("approvals");
  const tc = useTranslations("common");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (action === "reject" && !comment.trim()) { setError(t("rejectCommentRequired")); return; }
    setBusy(true); setError(null);
    try {
      await sendData("post", `/api/v1/approvals/${request.id}/${action}`, comment.trim() ? { comment: comment.trim() } : {});
      onDone();
    } catch (e) {
      setError(errorMessage(e, t("actionFailed")));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{action === "approve" ? t("approveTitle") : t("rejectTitle")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{request.entityLabel}</p>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {action === "reject" ? t("commentRequired") : t("commentOptional")}
        </label>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">{tc("cancel")}</button>
          <button onClick={submit} disabled={busy}
            className={cn("flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60",
              action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700")}>
            {busy ? t("working") : action === "approve" ? t("approve") : t("reject")}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepTrail({ request }: { request: ApprovalRequest }) {
  const t = useTranslations("approvals");
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-2">
      {request.steps.map((s) => (
        <li key={s.stepNumber}
          title={s.comment ?? undefined}
          className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            s.status === "approved" && "border-green-200 bg-green-50 text-green-700",
            s.status === "rejected" && "border-red-200 bg-red-50 text-red-700",
            s.status === "skipped"  && "border-gray-200 bg-gray-50 text-gray-500",
            s.status === "pending"  && (s.stepNumber === request.currentStep && request.status === "pending"
              ? "border-yellow-300 bg-yellow-50 text-yellow-800" : "border-border text-muted-foreground"))}>
          {s.status === "approved" ? <CheckCircle2 className="h-3 w-3" /> : s.status === "rejected" ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {t("stepLabel", { n: s.stepNumber })}: {s.approverName}
        </li>
      ))}
    </ol>
  );
}

export default function ApprovalsPage() {
  const t = useTranslations("approvals");
  const tc = useTranslations("common");
  const [scope, setScope]   = useState<Scope>("mine");
  const [status, setStatus] = useState<ApprovalStatus>("pending");
  const [items, setItems]   = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [acting, setActing] = useState<{ req: ApprovalRequest; action: "approve" | "reject" } | null>(null);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  useEffect(() => { const u = getStoredUser(); if (u) setMe({ id: u.id, role: u.role }); }, []);
  const isAdmin = ["admin", "super_admin"].includes(me?.role ?? "");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await getData<ApprovalRequest[]>(`/api/v1/approvals?scope=${scope}&status=${status}`);
      setItems(data ?? []);
    } catch (e) {
      setError(errorMessage(e, t("loadFailed")));
      setItems([]);
    } finally { setLoading(false); }
  }, [scope, status, t]);

  useEffect(() => { load(); }, [load]);

  const recall = async (req: ApprovalRequest) => {
    if (!confirm(t("recallConfirm"))) return;
    try {
      await sendData("post", `/api/v1/approvals/${req.id}/recall`, {});
      load();
    } catch (e) { setError(errorMessage(e, t("actionFailed"))); }
  };

  const scopes: Scope[] = isAdmin ? ["mine", "submitted", "all"] : ["mine", "submitted"];
  const statuses: ApprovalStatus[] = ["pending", "approved", "rejected", "recalled"];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> {tc("refresh")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-1">
          {scopes.map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={cn("rounded-md px-3 py-1 text-xs font-medium", scope === s ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {statuses.map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn("rounded-md px-3 py-1 text-xs font-medium", status === s ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const current = r.steps.find((s) => s.stepNumber === r.currentStep);
            const canAct = r.status === "pending" && current?.approverId === me?.id;
            const canRecall = r.status === "pending" && r.submittedBy === me?.id;
            return (
              <div key={r.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", APPROVAL_STATUS_COLORS[r.status])}>{t(`status.${r.status}`)}</span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">{t(`entity.${r.entityType}`)}</span>
                    </div>
                    <Link href={r.entityType === "quote" ? `/quotes?id=${r.entityId}` : "#"} className="mt-1 block font-medium hover:underline">
                      {r.entityLabel}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t("submittedBy", { name: r.submittedByName })} · {formatRelativeTime(r.submittedAt)}
                    </p>
                    {r.reason && <p className="mt-1 text-xs text-muted-foreground">{t("reason")}: {r.reason}</p>}
                    <StepTrail request={r} />
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {canAct && (
                      <>
                        <button onClick={() => setActing({ req: r, action: "approve" })}
                          className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("approve")}
                        </button>
                        <button onClick={() => setActing({ req: r, action: "reject" })}
                          className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                          <XCircle className="h-3.5 w-3.5" /> {t("reject")}
                        </button>
                      </>
                    )}
                    {canRecall && (
                      <button onClick={() => recall(r)}
                        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        <Undo2 className="h-3.5 w-3.5" /> {t("recall")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {acting && (
        <ActionModal request={acting.req} action={acting.action}
          onClose={() => setActing(null)}
          onDone={() => { setActing(null); load(); }} />
      )}
    </div>
  );
}
