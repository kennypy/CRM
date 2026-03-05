"use client";

import { useEffect, useState, useCallback } from "react";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { api } from "@/lib/api";
import {
  X, DollarSign, Calendar, Building2, User, TrendingUp,
  Mail, Phone, MessageSquare, Loader2, AlertCircle,
  Activity, ChevronRight, Pencil, Check,
} from "lucide-react";

type DealStage =
  | "discovery" | "proposal" | "negotiation"
  | "closed_won" | "closed_lost";

const STAGE_LABELS: Record<DealStage, string> = {
  discovery:   "Discovery",
  proposal:    "Proposal",
  negotiation: "Negotiation",
  closed_won:  "Closed Won",
  closed_lost: "Closed Lost",
};

interface DealDetail {
  id: string;
  name: string;
  value: number;
  currency?: string;
  stage: DealStage;
  closeDate?: string;
  company?: { id: string; name: string };
  realityScore?: number;
  declaredProbability?: number;
  updatedAt: string;
  createdAt?: string;
  notes?: string;
  owner?: { id: string; name: string; email?: string };
  contacts?: { id: string; name: string; email?: string; role?: string }[];
}

interface TimelineActivity {
  id: string;
  type: string;
  subject?: string;
  body?: string;
  occurredAt?: string;
  direction?: string;
}

function InlineEdit({
  value, onSave, type = "text", className,
}: {
  value: string; onSave: (v: string) => void; type?: string; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => { onSave(draft); setEditing(false); };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus type={type} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          className={cn("rounded border border-primary/50 bg-background px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30", className)}
        />
        <button onClick={commit} className="text-green-600 hover:text-green-700">
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={cn("group flex items-center gap-1 text-left hover:text-primary transition-colors", className)}
      title="Click to edit"
    >
      <span>{value || "—"}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity shrink-0" />
    </button>
  );
}

const ACTIVITY_ICONS: Record<string, React.FC<{ className?: string }>> = {
  email:   Mail,
  call:    Phone,
  meeting: Activity,
  task:    MessageSquare,
};

export function DealDetailPanel({
  dealId, dealName, dealValue, dealCurrency, declaredProbability, stage,
  onClose, onScoreClick, onDealUpdated,
}: {
  dealId: string;
  dealName: string;
  dealValue: number;
  dealCurrency?: string;
  declaredProbability?: number;
  stage: DealStage;
  onClose: () => void;
  onScoreClick?: () => void;
  onDealUpdated?: (patch: Partial<DealDetail>) => void;
}) {
  const { tenant } = useTenant();
  const currency = tenant.defaultCurrency;
  const locale   = tenant.locale;

  const [detail,     setDetail]     = useState<DealDetail | null>(null);
  const [timeline,   setTimeline]   = useState<TimelineActivity[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, timelineRes] = await Promise.all([
        api.get(`/api/v1/deals/${dealId}`),
        api.get(`/api/v1/deals/${dealId}/timeline`),
      ]);

      if (detailRes.ok) {
        const json = await detailRes.json();
        setDetail(json.data ?? json);
      } else {
        // Fallback: show minimal info from props
        setDetail({
          id: dealId, name: dealName, value: dealValue,
          currency: dealCurrency, stage, declaredProbability,
          updatedAt: new Date().toISOString(),
        });
      }

      if (timelineRes.ok) {
        const json = await timelineRes.json();
        setTimeline((json.data ?? []).slice(0, 8));
      }
    } catch {
      setDetail({
        id: dealId, name: dealName, value: dealValue,
        currency: dealCurrency, stage, declaredProbability,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [dealId, dealName, dealValue, dealCurrency, stage, declaredProbability]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patchDeal = useCallback(async (patch: Partial<DealDetail>) => {
    setSaving(true);
    try {
      setDetail((prev) => prev ? { ...prev, ...patch } : prev);
      await api.patch(`/api/v1/deals/${dealId}`, patch);
      onDealUpdated?.(patch);
    } catch {
      // Non-critical; optimistic update stays
    } finally {
      setSaving(false);
    }
  }, [dealId, onDealUpdated]);

  const d = detail;
  const dealCur = d?.currency ?? currency;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div className="flex-1 min-w-0 pr-4">
            {loading ? (
              <div className="h-6 w-48 animate-pulse rounded bg-muted" />
            ) : (
              <InlineEdit
                value={d?.name ?? dealName}
                onSave={(name) => patchDeal({ name })}
                className="text-lg font-semibold"
              />
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {d?.company?.name && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {d.company.name}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {loading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="animate-pulse space-y-2">
                  <div className="h-3 w-20 rounded bg-muted" />
                  <div className="h-5 w-40 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y">
              {/* Key fields */}
              <div className="grid grid-cols-2 gap-6 px-6 py-5">
                {/* Value */}
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <DollarSign className="h-3 w-3" /> Deal Value
                  </p>
                  <InlineEdit
                    value={String(d?.value ?? dealValue)}
                    onSave={(v) => { const n = parseFloat(v); if (!isNaN(n)) patchDeal({ value: n }); }}
                    type="number"
                    className="text-sm font-semibold"
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatCurrency(d?.value ?? dealValue, dealCur, true, locale)}
                  </p>
                </div>

                {/* Stage */}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Stage</p>
                  <select
                    value={d?.stage ?? stage}
                    onChange={(e) => patchDeal({ stage: e.target.value as DealStage })}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                  >
                    {Object.entries(STAGE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                {/* Close date */}
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <Calendar className="h-3 w-3" /> Close Date
                  </p>
                  <InlineEdit
                    value={d?.closeDate ? d.closeDate.split("T")[0] : ""}
                    onSave={(v) => patchDeal({ closeDate: v })}
                    type="date"
                    className="text-sm"
                  />
                </div>

                {/* Owner */}
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <User className="h-3 w-3" /> Owner
                  </p>
                  <p className="text-sm">{d?.owner?.name ?? "—"}</p>
                  {d?.owner?.email && (
                    <p className="text-xs text-muted-foreground">{d.owner.email}</p>
                  )}
                </div>

                {/* Reality score */}
                {d?.realityScore != null && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <TrendingUp className="h-3 w-3" /> Reality Score
                    </p>
                    <button
                      onClick={onScoreClick}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium transition-colors",
                        d.realityScore >= 70 ? "bg-green-100 text-green-700 hover:bg-green-200" :
                        d.realityScore >= 40 ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200" :
                                               "bg-red-100 text-red-700 hover:bg-red-200"
                      )}
                    >
                      <TrendingUp className="h-3.5 w-3.5" />
                      {d.realityScore}
                      {onScoreClick && <ChevronRight className="h-3 w-3 opacity-60" />}
                    </button>
                  </div>
                )}

                {/* Declared probability */}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Rep Probability</p>
                  <InlineEdit
                    value={String(d?.declaredProbability ?? declaredProbability ?? "")}
                    onSave={(v) => { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n <= 100) patchDeal({ declaredProbability: n }); }}
                    type="number"
                    className="text-sm"
                  />
                  {(d?.declaredProbability ?? declaredProbability) != null && (
                    <p className="text-xs text-muted-foreground">{d?.declaredProbability ?? declaredProbability}% chance</p>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="px-6 py-5">
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</p>
                <NotesField
                  value={d?.notes ?? ""}
                  onSave={(notes) => patchDeal({ notes })}
                />
              </div>

              {/* Contacts */}
              {d?.contacts && d.contacts.length > 0 && (
                <div className="px-6 py-5">
                  <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Contacts</p>
                  <div className="space-y-2">
                    {d.contacts.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {c.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                        </div>
                        {c.role && (
                          <span className="text-xs text-muted-foreground shrink-0">{c.role}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div className="px-6 py-5">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent Activity</p>
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No activities recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {timeline.map((act) => {
                      const Icon = ACTIVITY_ICONS[act.type] ?? Activity;
                      return (
                        <div key={act.id} className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Icon className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium capitalize">{act.type}</p>
                            {act.subject && <p className="text-xs text-muted-foreground truncate">{act.subject}</p>}
                          </div>
                          {act.occurredAt && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatRelativeTime(act.occurredAt, locale)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Metadata */}
              <div className="px-6 py-4 bg-muted/20">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Updated {d?.updatedAt ? formatRelativeTime(d.updatedAt, locale) : "—"}</span>
                  {d?.createdAt && <span>Created {formatRelativeTime(d.createdAt, locale)}</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          autoFocus rows={4} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          placeholder="Add notes about this deal…"
        />
        <div className="flex gap-2">
          <button
            onClick={() => { onSave(draft); setEditing(false); }}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >Save</button>
          <button
            onClick={() => { setDraft(value); setEditing(false); }}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
          >Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group w-full text-left rounded-lg border border-dashed border-border p-3 text-sm hover:border-primary/40 hover:bg-muted/30 transition-colors"
    >
      {value ? (
        <span className="text-foreground">{value}</span>
      ) : (
        <span className="text-muted-foreground italic">Click to add notes…</span>
      )}
    </button>
  );
}
