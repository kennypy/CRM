"use client";

/**
 * Settings → Webhooks. Outbound webhook subscriptions (admin). The event list
 * comes from the automation catalog, so every event any NexCRM module
 * publishes is subscribable. The signing secret is shown once on creation.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Copy, History, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteData, errorMessage, getData, sendData } from "@/lib/l2q";
import { groupEventsByEntity, useAutomationCatalog } from "@/lib/automation";

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

interface Webhook {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  created_at: string;
}
interface Delivery {
  id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  last_response_status: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

function Editor({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const t = useTranslations("webhooksSettings");
  const { catalog } = useAutomationCatalog();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (type: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(type)) n.delete(type); else n.add(type);
    return n;
  });

  const save = async () => {
    if (!name.trim() || !/^https?:\/\//i.test(url.trim()) || selected.size === 0) {
      setError(t("incomplete"));
      return;
    }
    setBusy(true); setError(null);
    try {
      const data = await sendData<{ secret: string }>("post", "/api/v1/webhooks",
        { name: name.trim(), url: url.trim(), event_types: [...selected] });
      onCreated(data.secret);
    } catch (e) {
      setError(errorMessage(e, t("saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("url")}</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputCls} />
        </label>
      </div>
      <div>
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("events")}</span>
        {!catalog && <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{t("loadingEvents")}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {catalog && groupEventsByEntity(catalog.events).map(([entity, evs]) => (
            <fieldset key={entity} className="rounded-lg border p-2">
              <legend className="px-1 text-xs font-medium capitalize">{entity.replace(/_/g, " ")}</legend>
              {evs.map((ev) => (
                <label key={ev.type} className="flex items-center gap-2 py-0.5 text-xs">
                  <input type="checkbox" checked={selected.has(ev.type)} onChange={() => toggle(ev.type)} />
                  <span>{ev.label}</span>
                  <code className="ml-auto text-[10px] text-muted-foreground">{ev.type}</code>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </div>
      {error && <p className="flex items-center gap-1 text-xs text-red-700"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">{t("cancel")}</button>
        <button onClick={save} disabled={busy}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("create")}
        </button>
      </div>
    </div>
  );
}

function Deliveries({ id }: { id: string }) {
  const t = useTranslations("webhooksSettings");
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getData<Delivery[]>(`/api/v1/webhooks/${id}/deliveries`).then(setRows).catch((e) => setError(errorMessage(e, t("loadFailed"))));
  }, [id, t]);
  if (error) return <p className="text-xs text-red-700">{error}</p>;
  if (!rows) return <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{t("loading")}</p>;
  if (!rows.length) return <p className="text-xs text-muted-foreground">{t("noDeliveries")}</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-muted-foreground">
        <tr><th className="py-1">{t("event")}</th><th>{t("status")}</th><th>{t("attempts")}</th><th>{t("response")}</th><th>{t("when")}</th></tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id} className="border-t">
            <td className="py-1 font-mono">{d.event_type}</td>
            <td className={cn(d.status === "delivered" ? "text-green-700" : d.status === "failed" ? "text-red-700" : "")}>{d.status}</td>
            <td>{d.attempt_count}</td>
            <td title={d.last_error ?? ""}>{d.last_response_status ?? (d.last_error ? "error" : "—")}</td>
            <td>{new Date(d.created_at).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WebhooksTab() {
  const t = useTranslations("webhooksSettings");
  const { catalog } = useAutomationCatalog();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setHooks(await getData<Webhook[]>("/api/v1/webhooks")); }
    catch (e) { setError(errorMessage(e, t("loadFailed"))); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const label = (type: string) => catalog?.events.find((e) => e.type === type)?.label ?? type;

  const toggleActive = async (h: Webhook) => {
    try {
      await sendData("patch", `/api/v1/webhooks/${h.id}`, { is_active: !h.is_active });
      setHooks((hs) => hs.map((x) => (x.id === h.id ? { ...x, is_active: !h.is_active } : x)));
    } catch (e) { setError(errorMessage(e, t("saveFailed"))); }
  };
  const remove = async (h: Webhook) => {
    if (!window.confirm(t("confirmDelete", { name: h.name }))) return;
    try { await deleteData(`/api/v1/webhooks/${h.id}`); setHooks((hs) => hs.filter((x) => x.id !== h.id)); }
    catch (e) { setError(errorMessage(e, t("deleteFailed"))); }
  };
  const test = async (h: Webhook) => {
    setTestMsg((m) => ({ ...m, [h.id]: t("testing") }));
    try { await sendData("post", `/api/v1/webhooks/${h.id}/test`, {}); setTestMsg((m) => ({ ...m, [h.id]: t("testOk") })); }
    catch (e) { setTestMsg((m) => ({ ...m, [h.id]: errorMessage(e, t("testFailed")) })); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
        {!creating && (
          <button onClick={() => { setCreating(true); setSecret(null); }}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" /> {t("add")}
          </button>
        )}
      </div>

      {secret && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
          <p className="mb-1 font-medium">{t("secretOnce")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-background px-2 py-1">{secret}</code>
            <button onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { /* blocked */ } }}
              className="flex items-center gap-1 rounded border px-2 py-1 hover:bg-background">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? t("copied") : t("copy")}
            </button>
            <button onClick={() => setSecret(null)} aria-label={t("dismiss")}><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {creating && (
        <Editor onClose={() => setCreating(false)}
          onCreated={(s) => { setCreating(false); setSecret(s); setCopied(false); load(); }} />
      )}

      {error && <p className="flex items-center gap-1 text-xs text-red-700"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>}
      {loading && <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />{t("loading")}</p>}
      {!loading && hooks.length === 0 && !creating && <p className="text-sm text-muted-foreground">{t("empty")}</p>}

      <ul className="space-y-2">
        {hooks.map((h) => (
          <li key={h.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{h.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{h.url}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {h.event_types.map((e) => (
                    <span key={e} className="rounded-full bg-muted px-2 py-0.5 text-[11px]" title={e}>{label(e)}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={h.is_active} onChange={() => toggleActive(h)} /> {t("active")}
                </label>
                <button onClick={() => test(h)} className="rounded p-1 hover:bg-muted" title={t("sendTest")}><Send className="h-3.5 w-3.5" /></button>
                <button onClick={() => setOpen(open === h.id ? null : h.id)} className="rounded p-1 hover:bg-muted" title={t("deliveries")}>
                  <History className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => remove(h)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600" title={t("delete")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {testMsg[h.id] && <p className="mt-1 text-xs text-muted-foreground">{testMsg[h.id]}</p>}
            {open === h.id && <div className="mt-3 border-t pt-2"><Deliveries id={h.id} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
