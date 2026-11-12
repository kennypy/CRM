"use client";

/**
 * Settings → Web-to-Lead. Each form has an unguessable key, an origin
 * allowlist and a default lead source; submissions land as leads and run
 * through assignment rules. Shows a copy-paste HTML snippet per form.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Code2, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteData, errorMessage, getData, sendData, webToLeadSnippet, webToLeadUrl,
  type WebToLeadForm,
} from "@/lib/l2q";

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

interface Draft { id?: string; name: string; allowedOrigins: string; defaultSource: string; active: boolean; }

function CopyButton({ text }: { text: string }) {
  const t = useTranslations("webForms");
  const [copied, setCopied] = useState(false);
  return (
    <button type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
      }}
      className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      {copied ? t("copied") : t("copy")}
    </button>
  );
}

function FormEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("webForms");
  const tc = useTranslations("common");
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!d.name.trim()) { setError(t("nameRequired")); return; }
    const origins = d.allowedOrigins.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const bad = origins.find((o) => !/^https?:\/\/[^/\s]+$/i.test(o));
    if (bad) { setError(t("badOrigin", { origin: bad })); return; }
    setBusy(true); setError(null);
    try {
      const body = { name: d.name.trim(), allowedOrigins: origins, defaultSource: d.defaultSource.trim() || "web", active: d.active };
      if (d.id) await sendData("patch", `/api/v1/leads/web-forms/${d.id}`, body);
      else await sendData("post", "/api/v1/leads/web-forms", body);
      onSaved();
    } catch (e) { setError(errorMessage(e, t("saveFailed"))); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{d.id ? t("editForm") : t("newForm")}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>{t("name")}</label>
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t("namePlaceholder")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("allowedOrigins")}</label>
            <textarea rows={3} value={d.allowedOrigins} onChange={(e) => setD({ ...d, allowedOrigins: e.target.value })}
              placeholder="https://www.example.com" className={cn(inputCls, "resize-none font-mono text-xs")} />
            <p className="mt-1 text-xs text-muted-foreground">{t("allowedOriginsHint")}</p>
          </div>
          <div>
            <label className={labelCls}>{t("defaultSource")}</label>
            <input value={d.defaultSource} onChange={(e) => setD({ ...d, defaultSource: e.target.value })} placeholder="web" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="rounded border-border" />
            {t("active")}
          </label>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">{tc("cancel")}</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? t("saving") : tc("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WebFormsTab() {
  const t = useTranslations("webForms");
  const [forms, setForms] = useState<WebToLeadForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [snippetFor, setSnippetFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setForms((await getData<WebToLeadForm[]>("/api/v1/leads/web-forms")) ?? []); }
    catch (e) { setError(errorMessage(e, t("loadFailed"))); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const remove = async (f: WebToLeadForm) => {
    if (!confirm(t("deleteConfirm", { name: f.name }))) return;
    try { await deleteData(`/api/v1/leads/web-forms/${f.id}`); load(); }
    catch (e) { setError(errorMessage(e, t("deleteFailed"))); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <button onClick={() => setEditing({ name: "", allowedOrigins: "", defaultSource: "web", active: true })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" />{t("newForm")}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>
      ) : forms.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {forms.map((f) => (
            <div key={f.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{f.name}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", f.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                      {f.active ? t("activeBadge") : t("inactiveBadge")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t("source")}: {f.defaultSource} · {t("origins")}: {f.allowedOrigins.length ? f.allowedOrigins.join(", ") : t("anyOrigin")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="truncate rounded bg-muted px-2 py-1 text-xs">{webToLeadUrl(f.formKey)}</code>
                    <CopyButton text={webToLeadUrl(f.formKey)} />
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setSnippetFor(snippetFor === f.id ? null : f.id)}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"><Code2 className="h-3.5 w-3.5" />{t("embedCode")}</button>
                  <button onClick={() => setEditing({ id: f.id, name: f.name, allowedOrigins: f.allowedOrigins.join("\n"), defaultSource: f.defaultSource, active: f.active })}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(f)} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {snippetFor === f.id && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{t("snippetHint")}</p>
                    <CopyButton text={webToLeadSnippet(f.formKey)} />
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{webToLeadSnippet(f.formKey)}</code></pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <FormEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
