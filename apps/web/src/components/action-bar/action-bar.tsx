"use client";

/**
 * ActionBar — "What do you want to do?" inline bar.
 * Placed next to each page's title. Handles:
 *   - Log an activity (with sentiment + product hints → quote prompt)
 *   - Create a quote (NL → pre-fill QuoteBuilderModal)
 *   - Send a quote (looks up company, finds latest approved quote)
 *   - Build a sequence / campaign
 *   - Company disambiguation when >1 match found
 */

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Zap, X, ArrowRight, CheckCircle2, AlertCircle,
  Building2, MapPin, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { parseNL, summariseIntent, type ParseResult } from "@/lib/nl-parser";
import { QuoteBuilderModal } from "@/components/modals/quote-builder-modal";
import { DEMO_PRODUCTS } from "@/lib/quotes";

// ── Company disambiguation types ──────────────────────────────────────────────
interface CompanyOption {
  id:       string;
  name:     string;
  domain?:  string;
  city?:    string;
  country?: string;
  parentName?: string;
}

// ── Activity logger ───────────────────────────────────────────────────────────
interface LoggedActivity {
  type:      string;
  subject:   string;
  summary:   string;
  sentiment: number | null;
  companyId?: string;
}

interface Props {
  context?: string; // e.g. "companies", "contacts", "quotes"
  dealId?:      string;
  dealName?:    string;
  companyId?:   string;
  companyName?: string;
  contactId?:   string;
}

type BarState =
  | "idle"
  | "typing"
  | "parsed"
  | "disambiguate"
  | "confirm_activity"
  | "confirm_quote"
  | "confirm_send"
  | "confirm_sequence"
  | "success"
  | "error";

export function ActionBar({ context, dealId, dealName, companyId, companyName, contactId }: Props) {
  const router = useRouter();

  const [open,     setOpen]     = useState(false);
  const [input,    setInput]    = useState("");
  const [state,    setState]    = useState<BarState>("idle");
  const [parsed,   setParsed]   = useState<ParseResult | null>(null);
  const [message,  setMessage]  = useState("");
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);
  const [showQuoteBuilder, setShowQuoteBuilder] = useState(false);
  const [quotePreFill, setQuotePreFill] = useState<Record<string, unknown>>({});

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setInput(""); setState("idle"); setParsed(null); setMessage(""); setCompanies([]); setSelectedCompany(null); }
  }, [open]);

  // ── Company lookup ───────────────────────────────────────────────────────
  const lookupCompany = async (name: string): Promise<CompanyOption[]> => {
    try {
      const res  = await api.get(`/api/v1/companies?search=${encodeURIComponent(name)}&limit=10`);
      const json = await res.json();
      return (json.data ?? []).map((c: Record<string, unknown>) => ({
        id:   String(c.id),
        name: String(c.name),
        domain:  c.domain  ? String(c.domain)  : undefined,
        city:    c.city    ? String(c.city)     : undefined,
        country: c.country ? String(c.country)  : undefined,
      }));
    } catch { return []; }
  };

  // ── Parse + execute ───────────────────────────────────────────────────────
  const execute = async (text = input) => {
    const p = parseNL(text);
    setParsed(p);

    if (p.intent === "unknown" || p.confidence < 0.5) {
      setState("error");
      setMessage("I didn't understand that. Try: 'I had a call with Acme, they want 3 licenses' or 'create a quote for TechStart'");
      return;
    }

    // Resolve company: check if already in context or need to look up
    let resolvedCompany: CompanyOption | null = null;
    if (companyId && companyName) {
      resolvedCompany = { id: companyId, name: companyName };
    } else if (p.company) {
      const found = await lookupCompany(p.company);
      if (found.length === 0) {
        // No match — proceed with name from NL but no ID
        resolvedCompany = { id: "", name: p.company };
      } else if (found.length === 1) {
        resolvedCompany = found[0];
      } else {
        // Multiple matches — disambiguate
        setCompanies(found);
        setState("disambiguate");
        return;
      }
    }

    setSelectedCompany(resolvedCompany);
    await dispatchIntent(p, resolvedCompany);
  };

  const dispatchIntent = async (p: ParseResult, company: CompanyOption | null) => {
    switch (p.intent) {
      case "log_activity":
        setState("confirm_activity");
        break;

      case "create_quote":
        // Pre-fill quote builder from NL-detected products
        setQuotePreFill({
          companyId:   company?.id     || companyId,
          companyName: company?.name   || companyName,
          dealId,  dealName,
          contactId,
          items: p.products.length > 0
            ? p.products.map((prod) => {
                // Try to match to catalog
                const catalogMatch = DEMO_PRODUCTS.find((cp) =>
                  cp.name.toLowerCase().includes(prod.name.toLowerCase()) ||
                  prod.name.toLowerCase().includes(cp.name.toLowerCase().split(" ")[0])
                );
                return {
                  productId:   catalogMatch?.id ?? null,
                  productName: catalogMatch?.name ?? prod.name,
                  quantity:    prod.quantity,
                  unitPrice:   catalogMatch?.unitPrice ?? 0,
                  discountPct: prod.discountPct,
                };
              })
            : undefined,
        });
        setShowQuoteBuilder(true);
        setOpen(false);
        break;

      case "send_quote":
        setState("confirm_send");
        setMessage(company
          ? `Send the latest approved quote to ${company.name}?`
          : "Which company should I send the quote to?");
        break;

      case "build_sequence":
        // Navigate to sequences with pre-fill
        router.push("/sequences?intent=new" + (p.company ? `&audience=${encodeURIComponent(p.company)}` : ""));
        setOpen(false);
        break;

      case "open_report":
        router.push("/reports?period=" + encodeURIComponent(p.period ?? "Last 30 days"));
        setOpen(false);
        break;
    }
  };

  // ── Activity logging ─────────────────────────────────────────────────────
  const confirmLogActivity = async () => {
    if (!parsed) return;
    setState("success");

    const body: LoggedActivity = {
      type:      parsed.activityType ?? "note",
      subject:   parsed.raw.slice(0, 200),
      summary:   parsed.raw,
      sentiment: parsed.sentiment === "positive" ? 0.7 : parsed.sentiment === "negative" ? -0.7 : 0,
      companyId: selectedCompany?.id || companyId || undefined,
    };

    try {
      await api.post("/api/v1/activities", {
        ...body,
        occurredAt: new Date().toISOString(),
        source:     "action_bar",
      });
    } catch { /* log locally even if API fails */ }

    const hasProductHints = parsed.products.length > 0;
    setMessage(
      `${parsed.activityType?.charAt(0).toUpperCase()}${parsed.activityType?.slice(1) ?? "Activity"} logged${selectedCompany ? ` for ${selectedCompany.name}` : ""}.` +
      (hasProductHints ? " Product intent detected — would you like to create a quote?" : "")
    );

    if (hasProductHints) {
      // After a pause, offer to build quote
      setTimeout(() => {
        setQuotePreFill({
          companyId:   selectedCompany?.id || companyId,
          companyName: selectedCompany?.name || companyName,
          dealId, dealName, contactId,
          items: parsed.products.map((prod) => {
            const catalogMatch = DEMO_PRODUCTS.find((cp) =>
              cp.name.toLowerCase().includes(prod.name.toLowerCase()) ||
              prod.name.toLowerCase().includes(cp.name.toLowerCase().split(" ")[0])
            );
            return {
              productId:   catalogMatch?.id ?? null,
              productName: catalogMatch?.name ?? prod.name,
              quantity:    prod.quantity,
              unitPrice:   catalogMatch?.unitPrice ?? 0,
              discountPct: prod.discountPct,
            };
          }),
        });
      }, 400);
    }
  };

  const confirmSendQuote = async () => {
    if (!selectedCompany?.id) { setState("error"); setMessage("No company selected"); return; }
    try {
      // Find latest approved/draft quote for this company
      const res  = await api.get(`/api/v1/quotes?companyId=${selectedCompany.id}&status=draft`);
      const json = await res.json();
      const latest = json.data?.[0];
      if (!latest) { setState("error"); setMessage("No sendable quote found for this company"); return; }
      await api.post(`/api/v1/quotes/${latest.id}/send`, {});
      setState("success");
      setMessage(`Quote ${latest.quoteNumber} sent to ${selectedCompany.name}`);
    } catch { setState("error"); setMessage("Failed to send quote"); }
  };

  const inputCls = "flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground";

  return (
    <>
      {/* Trigger button — inline with page title */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm hover:border-primary/50 hover:text-primary transition-colors"
      >
        <Zap className="h-3.5 w-3.5 text-primary" />
        What do you want to do?
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="relative z-10 w-full max-w-2xl rounded-2xl border bg-card shadow-2xl overflow-hidden">
            {/* Input row */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b">
              <Zap className="h-4 w-4 shrink-0 text-primary" />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); setState("typing"); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input.trim()) execute();
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder='e.g. "I had a call with Acme, they want 3 licenses" or "create a quote for TechStart for 5 x Enterprise"'
                className={inputCls}
              />
              {input && (
                <button onClick={() => { setInput(""); setState("idle"); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => input.trim() && execute()}
                disabled={!input.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                Go <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Suggestions when idle */}
            {state === "idle" && (
              <div className="p-4 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick actions</p>
                {[
                  { label: "Log a call or meeting",         example: "I had a call with Acme, they want 3 Pro licenses" },
                  { label: "Create a quote",                 example: "Create a quote for TechStart for 5 x Enterprise with 5% discount" },
                  { label: "Send a quote",                   example: "Send the latest approved quote to Globex" },
                  { label: "Build a sequence / campaign",    example: "Build a campaign for IT directors in pharma" },
                ].map(({ label, example }) => (
                  <button key={label}
                    onClick={() => { setInput(example); setState("typing"); setTimeout(() => inputRef.current?.focus(), 50); }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted transition-colors">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground italic">"{example}"</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Live preview while typing */}
            {state === "typing" && input.length > 8 && (() => {
              const preview = parseNL(input);
              return preview.intent !== "unknown" ? (
                <div className="border-t px-4 py-2.5 bg-primary/5 flex items-center gap-2 text-sm">
                  <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-primary font-medium">{summariseIntent(preview)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Press Enter to confirm</span>
                </div>
              ) : null;
            })()}

            {/* Company disambiguation */}
            {state === "disambiguate" && (
              <div className="p-4 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Multiple companies match "{parsed?.company}" — which one?
                </p>
                {companies.map((c) => (
                  <button key={c.id}
                    onClick={async () => { setSelectedCompany(c); await dispatchIntent(parsed!, c); }}
                    className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left hover:bg-muted transition-colors">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                      {c.name[0]}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{c.name}</p>
                      {(c.city || c.country) && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />{[c.city, c.country].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {c.domain && <p className="text-xs text-muted-foreground">{c.domain}</p>}
                      {c.parentName && <p className="text-xs text-muted-foreground">Part of {c.parentName}</p>}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            {/* Confirm: log activity */}
            {state === "confirm_activity" && parsed && (
              <div className="p-4 space-y-3">
                <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold capitalize">{parsed.activityType ?? "Activity"}</span>
                    {selectedCompany && <span className="text-muted-foreground">with {selectedCompany.name}</span>}
                    {parsed.sentiment === "positive" && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Positive sentiment</span>}
                  </div>
                  <p className="text-xs text-muted-foreground italic">"{parsed.raw.slice(0, 120)}{parsed.raw.length > 120 ? "…" : ""}"</p>
                  {parsed.products.length > 0 && (
                    <p className="text-xs text-primary">+ {parsed.products.length} product mention(s) detected — will offer to create quote after logging</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={confirmLogActivity}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                    <CheckCircle2 className="h-4 w-4" /> Log activity
                  </button>
                  <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
                </div>
              </div>
            )}

            {/* Confirm: send quote */}
            {state === "confirm_send" && (
              <div className="p-4 space-y-3">
                <p className="text-sm">{message}</p>
                <div className="flex gap-2">
                  <button onClick={confirmSendQuote}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                    Send quote
                  </button>
                  <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
                </div>
              </div>
            )}

            {/* Success */}
            {state === "success" && (
              <div className="p-4">
                <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-800">{message}</p>
                    {parsed?.products.length && parsed.products.length > 0 && quotePreFill && (
                      <button
                        onClick={() => { setOpen(false); setShowQuoteBuilder(true); }}
                        className="mt-2 text-xs font-medium text-primary hover:underline">
                        Create quote for detected products →
                      </button>
                    )}
                  </div>
                  <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {state === "error" && (
              <div className="p-4">
                <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <AlertCircle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
                  <p className="text-sm text-red-700">{message}</p>
                </div>
              </div>
            )}

            {/* Footer hint */}
            <div className="border-t px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span>Enter ↵ to confirm</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}

      {/* Quote builder launched from action bar */}
      {showQuoteBuilder && (
        <QuoteBuilderModal
          dealId={String(quotePreFill.dealId ?? dealId ?? "")}
          dealName={String(quotePreFill.dealName ?? dealName ?? "")}
          companyId={String(quotePreFill.companyId ?? companyId ?? "")}
          companyName={String(quotePreFill.companyName ?? companyName ?? "")}
          contactId={String(quotePreFill.contactId ?? contactId ?? "")}
          onClose={() => setShowQuoteBuilder(false)}
          onSaved={() => setShowQuoteBuilder(false)}
        />
      )}
    </>
  );
}
