"use client";

/**
 * Lead conversion (Salesforce-style): link to an existing account or create
 * one, optionally open an opportunity, and flip the lead to a contact — all in
 * one server-side transaction via POST /api/v1/leads/:id/convert.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Building2, CheckCircle2, Search, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { OwnerPicker } from "@/components/ui/owner-picker";
import {
  CONVERT_DEAL_STAGES, readApiError,
  type ConvertDealStage, type ConvertLeadRequest, type ConvertLeadResult,
} from "@/lib/l2q";

export interface ConvertibleLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company?: { id: string; name: string };
  ownerId?: string;
}

interface CompanyOption { id: string; name: string; domain?: string }

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

export function ConvertLeadModal({ lead, onClose, onConverted }: {
  lead: ConvertibleLead;
  onClose: () => void;
  onConverted: (result: ConvertLeadResult) => void;
}) {
  const t  = useTranslations("leadConvert");
  const tc = useTranslations("common");

  const [accountMode, setAccountMode] = useState<"existing" | "new">(lead.company ? "existing" : "new");
  const [company, setCompany]         = useState<CompanyOption | null>(lead.company ?? null);
  const [companyName, setCompanyName] = useState(lead.company?.name ?? "");
  const [companyDomain, setCompanyDomain] = useState(emailDomain(lead.email));
  const [search, setSearch]           = useState("");
  const [results, setResults]         = useState<CompanyOption[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [createDeal, setCreateDeal]   = useState(true);
  const [dealName, setDealName]       = useState(`${lead.company?.name ?? `${lead.firstName} ${lead.lastName}`} — ${t("newOpportunitySuffix")}`);
  const [dealValue, setDealValue]     = useState("");
  const [dealCloseDate, setDealCloseDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10);
  });
  const [dealStage, setDealStage]     = useState<ConvertDealStage>("qualified");
  const [ownerId, setOwnerId]         = useState<string | null>(lead.ownerId ?? null);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<{ message: string; field?: string } | null>(null);
  const [done, setDone]       = useState<ConvertLeadResult | null>(null);

  // Account lookup — debounce so typing doesn't spam the graph.
  useEffect(() => {
    if (accountMode !== "existing" || search.trim().length < 2) { setResults([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/v1/companies?search=${encodeURIComponent(search.trim())}&limit=8`);
        if (!res.ok) return;
        const json = await res.json();
        setResults((json.data ?? []).map((c: CompanyOption) => ({ id: c.id, name: c.name, domain: c.domain })));
      } catch { /* non-fatal */ }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [search, accountMode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (accountMode === "existing" && !company) { setError({ message: t("pickAccount") }); return; }
    if (accountMode === "new" && !companyName.trim()) { setError({ message: t("accountNameRequired") }); return; }
    if (createDeal && !dealName.trim()) { setError({ message: t("dealNameRequired") }); return; }

    const body: ConvertLeadRequest = {
      createDeal,
      ownerId: ownerId ?? undefined,
      ...(accountMode === "existing"
        ? { companyId: company!.id }
        : { companyName: companyName.trim(), companyDomain: companyDomain.trim() || undefined }),
      ...(createDeal ? {
        dealName: dealName.trim(),
        dealValue: dealValue === "" ? undefined : Math.max(0, Number(dealValue) || 0),
        dealCloseDate: dealCloseDate || undefined,
        dealStage,
      } : {}),
    };

    setLoading(true);
    try {
      const res = await api.post(`/api/v1/leads/${lead.id}/convert`, body);
      if (!res.ok) {
        const err = await readApiError(res, t("failed"));
        if (err.code === "ALREADY_CONVERTED") setError({ message: t("alreadyConverted") });
        else if (err.code === "VALIDATION_RULE") setError({ message: err.message, field: err.field });
        else setError({ message: err.message });
        return;
      }
      const json = await res.json();
      setDone(json.data as ConvertLeadResult);
      onConverted(json.data as ConvertLeadResult);
    } catch {
      setError({ message: tc("networkError") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-2xl border bg-card shadow-2xl" style={{ maxHeight: "92vh" }}>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">{t("title")}</h2>
              <p className="text-xs text-muted-foreground">{lead.firstName} {lead.lastName} · {lead.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {done ? (
          <div className="space-y-3 p-6">
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> {t("success")}
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>{done.companyCreated ? t("accountCreated") : t("accountLinked")}</li>
              <li>{done.dealId ? t("dealCreated") : t("noDealCreated")}</li>
            </ul>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                {tc("close")}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex-1 space-y-5 overflow-y-auto p-6">
            {/* Account */}
            <section className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Building2 className="h-4 w-4 text-primary" />{t("account")}</p>
              <div className="flex gap-1 rounded-lg border p-1 w-fit">
                {(["existing", "new"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setAccountMode(m)}
                    className={cn("rounded-md px-3 py-1 text-xs font-medium", accountMode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {m === "existing" ? t("existingAccount") : t("newAccount")}
                  </button>
                ))}
              </div>
              {accountMode === "existing" ? (
                company ? (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{company.name}
                      {company.domain && <span className="text-xs text-muted-foreground">({company.domain})</span>}</span>
                    <button type="button" onClick={() => setCompany(null)} className="text-xs text-primary hover:underline">{t("change")}</button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchAccounts")}
                      className={cn(inputCls, "pl-9")} />
                    {results.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg">
                        {results.map((c) => (
                          <button key={c.id} type="button" onClick={() => { setCompany(c); setSearch(""); setResults([]); }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted">
                            <span>{c.name}</span>
                            {c.domain && <span className="text-xs text-muted-foreground">{c.domain}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t("accountName")}</label>
                    <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("accountDomain")}</label>
                    <input value={companyDomain} onChange={(e) => setCompanyDomain(e.target.value)} placeholder="acme.com" className={inputCls} />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">{t("domainDedupHint")}</p>
                </div>
              )}
            </section>

            {/* Opportunity */}
            <section className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} className="rounded border-border" />
                {t("createOpportunity")}
              </label>
              {createDeal && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelCls}>{t("opportunityName")}</label>
                    <input value={dealName} onChange={(e) => setDealName(e.target.value)}
                      className={cn(inputCls, error?.field === "name" && "border-red-400")} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("amount")}</label>
                    <input type="number" min="0" step="0.01" value={dealValue} onChange={(e) => setDealValue(e.target.value)}
                      className={cn(inputCls, error?.field === "value" && "border-red-400")} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("closeDate")}</label>
                    <input type="date" value={dealCloseDate} onChange={(e) => setDealCloseDate(e.target.value)}
                      className={cn(inputCls, error?.field === "closeDate" && "border-red-400")} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("stage")}</label>
                    <select value={dealStage} onChange={(e) => setDealStage(e.target.value as ConvertDealStage)} className={inputCls}>
                      {CONVERT_DEAL_STAGES.map((s) => <option key={s} value={s}>{t(`stages.${s}`)}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </section>

            {/* Owner */}
            <section>
              <label className={labelCls}>{t("recordOwner")}</label>
              <OwnerPicker value={ownerId} onChange={setOwnerId} />
            </section>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error.message}{error.field && <span className="ml-1 text-xs opacity-75">({t("field")}: {error.field})</span>}</span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
                {tc("cancel")}
              </button>
              <button type="submit" disabled={loading}
                className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground", loading ? "cursor-not-allowed opacity-60" : "hover:opacity-90")}>
                {loading ? t("converting") : t("convert")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
