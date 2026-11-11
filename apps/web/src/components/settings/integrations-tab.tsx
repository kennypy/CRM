"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { useInstanceCapabilities } from "@/lib/capabilities-context";
import {
  canManage, connectPath, parseCallbackParams, stripCallbackParams,
  type IntegrationId, type IntegrationStatus,
} from "@/lib/integrations";

const META: Record<IntegrationId, { icon: string; name: string; descKey: string }> = {
  gmail:   { icon: "📧", name: "Gmail + Google Calendar", descKey: "descGmail" },
  outlook: { icon: "📬", name: "Outlook / Microsoft 365", descKey: "descOutlook" },
  slack:   { icon: "💬", name: "Slack", descKey: "descSlack" },
  zoom:    { icon: "🎥", name: "Zoom", descKey: "descZoom" },
};

/** Listed for visibility but no backend exists — never shown as connectable. */
const UNAVAILABLE = [{ id: "stripe", icon: "💳", name: "Stripe (revenue sync)" }];

type Banner = { kind: "success" | "error"; text: string } | null;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  const e = body?.error;
  return (typeof e === "string" ? e : e?.message) || fallback;
}

export function IntegrationsTab() {
  const t = useTranslations("integrationsSettings");
  const { capabilities } = useInstanceCapabilities();
  const ingestionAvailable = capabilities.activity_ingestion !== false;
  const isAdmin = ["admin", "super_admin"].includes(getStoredUser()?.role ?? "");

  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.get("/api/v1/integrations/status");
      if (!res.ok) throw new Error(await errorMessage(res, t("loadFailed")));
      const body = (await res.json()) as { data: IntegrationStatus[] };
      setItems(body.data);
    } catch (err) {
      setLoadError((err as Error).message || t("loadFailed"));
    }
  }, [t]);

  // OAuth callback params → banner, then clean the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const cb = parseCallbackParams(params);
    if (cb) {
      const name = META[cb.provider].name;
      setBanner(cb.outcome === "connected"
        ? { kind: "success", text: t("connectedBanner", { name }) }
        : { kind: "error", text: t("errorBanner", { name, reason: cb.reason ?? t("unknownReason") }) });
      window.history.replaceState(null, "", `${window.location.pathname}${stripCallbackParams(params)}`);
    }
    void load();
  }, [load, t]);

  const setErr = (id: string, msg: string | null) =>
    setRowError((prev) => { const n = { ...prev }; if (msg) n[id] = msg; else delete n[id]; return n; });

  const connect = async (id: IntegrationId) => {
    setBusy(id); setErr(id, null);
    try {
      const res = await api.get(connectPath(id));
      if (res.status === 403) throw new Error(t("adminOnly"));
      if (!res.ok) throw new Error(await errorMessage(res, t("connectFailed")));
      const body = (await res.json()) as { data?: { url?: string } };
      if (!body.data?.url) throw new Error(t("connectFailed"));
      window.location.assign(body.data.url);
    } catch (err) {
      setErr(id, (err as Error).message);
      setBusy(null);
    }
  };

  const disconnect = async (id: IntegrationId) => {
    setBusy(id); setErr(id, null);
    try {
      const res = await api.delete(`/api/v1/integrations/${id}`);
      if (!res.ok) throw new Error(await errorMessage(res, t("disconnectFailed")));
      setBanner({ kind: "success", text: t("disconnectedBanner", { name: META[id].name }) });
    } catch (err) {
      setErr(id, (err as Error).message);
    } finally {
      setBusy(null);
      await load();
    }
  };

  const syncZoom = async () => {
    setBusy("zoom-sync"); setErr("zoom", null);
    try {
      const res = await api.post("/api/v1/integrations/zoom/sync", {});
      if (!res.ok) throw new Error(await errorMessage(res, t("syncFailed")));
      const body = (await res.json()) as { data: { found: number; queued: number } };
      setBanner({ kind: "success", text: t("syncResult", { found: body.data.found, queued: body.data.queued }) });
    } catch (err) {
      setErr("zoom", (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {banner && (
        <div className={banner.kind === "success"
          ? "flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
          : "flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"}>
          {banner.kind === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span className="flex-1">{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-xs opacity-70 hover:opacity-100">{t("dismiss")}</button>
        </div>
      )}
      {!ingestionAvailable && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {t("ingestionUnavailable")}
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <span className="flex-1">{loadError}</span>
          <button onClick={() => void load()} className="flex items-center gap-1 text-xs font-medium"><RefreshCw className="h-3 w-3" />{t("retry")}</button>
        </div>
      )}
      {!items && !loadError && <p className="text-sm text-muted-foreground">{t("loading")}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {(items ?? []).map((s) => {
          const meta = META[s.id];
          if (!meta) return null;
          const manage = canManage(s, isAdmin);
          const needsIngestion = s.id === "gmail" || s.id === "outlook";
          const blocked = !s.configured || (needsIngestion && !ingestionAvailable);
          return (
            <div key={s.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{meta.icon}</span>
                  <div>
                    <p className="font-medium text-sm">{meta.name}</p>
                    <p className="text-xs text-muted-foreground">{t(meta.descKey)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      {s.scope === "user" ? t("scopeUser") : t("scopeWorkspace")}
                      {s.connected && s.account ? ` · ${s.account}` : ""}
                      {s.connected && s.since ? ` · ${t("since", { date: new Date(s.since).toLocaleDateString() })}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {s.connected ? (
                    <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                      <CheckCircle2 className="h-3 w-3" /> {t("connected")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {s.configured ? t("notConnected") : t("notConfigured")}
                    </span>
                  )}
                  {manage && s.connected && (
                    <button onClick={() => void disconnect(s.id)} disabled={busy === s.id}
                      className="text-xs text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50">
                      {busy === s.id ? t("disconnecting") : t("disconnect")}
                    </button>
                  )}
                  {manage && s.connected && s.id === "zoom" && (
                    <button onClick={() => void syncZoom()} disabled={busy === "zoom-sync"}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
                      {busy === "zoom-sync" ? t("syncing") : t("syncRecordings")}
                    </button>
                  )}
                  {manage && !s.connected && (
                    <button onClick={() => void connect(s.id)} disabled={busy === s.id || blocked}
                      title={!s.configured ? t("notConfigured") : blocked ? t("ingestionUnavailableShort") : undefined}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed">
                      {busy === s.id ? t("redirecting") : t("connect")}
                    </button>
                  )}
                  {!manage && <span className="text-xs text-muted-foreground">{t("adminManaged")}</span>}
                </div>
              </div>
              {rowError[s.id] && <p className="mt-2 text-xs text-red-600">{rowError[s.id]}</p>}
            </div>
          );
        })}
        {items && UNAVAILABLE.map((u) => (
          <div key={u.id} className="rounded-xl border bg-card p-4 opacity-60">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{u.icon}</span>
                <div>
                  <p className="font-medium text-sm">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{t("noBackend")}</p>
                </div>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{t("notAvailable")}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
