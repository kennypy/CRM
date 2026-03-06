"use client";

import { useState, useEffect, useRef } from "react";
import { X, Briefcase, Search, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

const STAGES = [
  { value: "discovery",    label: "Discovery"    },
  { value: "qualification",label: "Qualification"},
  { value: "proposal",     label: "Proposal"     },
  { value: "negotiation",  label: "Negotiation"  },
  { value: "closed_won",   label: "Closed Won"   },
  { value: "closed_lost",  label: "Closed Lost"  },
];

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "CHF"];

interface ContactOption { id: string; first_name: string; last_name: string; email: string; title?: string; }

interface AddDealModalProps {
  companyId?: string;
  companyName?: string;
  defaultCurrency?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function AddDealModal({ companyId, companyName, defaultCurrency = "USD", onClose, onCreated }: AddDealModalProps) {
  const [name,      setName]      = useState("");
  const [product,   setProduct]   = useState("");
  const [value,     setValue]     = useState("");
  const [currency,  setCurrency]  = useState(defaultCurrency);
  const [stage,     setStage]     = useState("discovery");
  const [closeDate, setCloseDate] = useState("");
  const [notes,     setNotes]     = useState("");

  // POC search
  const [pocQuery,    setPocQuery]    = useState("");
  const [pocResults,  setPocResults]  = useState<ContactOption[]>([]);
  const [selectedPoc, setSelectedPoc] = useState<ContactOption | null>(null);
  const [pocOpen,     setPocOpen]     = useState(false);
  const pocTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [done,    setDone]    = useState(false);

  useEffect(() => {
    if (!pocQuery.trim()) { setPocResults([]); return; }
    if (pocTimer.current) clearTimeout(pocTimer.current);
    pocTimer.current = setTimeout(async () => {
      try {
        const res = await api.get("/api/v1/contacts?limit=10&search=" + encodeURIComponent(pocQuery));
        const json = await res.json();
        setPocResults(json.data ?? []);
        setPocOpen(true);
      } catch { setPocResults([]); }
    }, 300);
  }, [pocQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        stage,
        currency,
        source: "user",
      };
      if (product)         body.product      = product;
      if (value)           body.value        = parseFloat(value);
      if (closeDate)       body.closeDate    = closeDate;
      if (notes)           body.notes        = notes;
      if (companyId)       body.companyId    = companyId;
      if (selectedPoc?.id) body.primaryContactId = selectedPoc.id;
      const currentUser = getStoredUser();
      if (currentUser?.id) body.ownerId = currentUser.id;

      const res = await api.post("/api/v1/deals", body);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error?.message ?? "Failed to create opportunity");
        return;
      }
      setDone(true);
      onCreated();
      setTimeout(onClose, 1200);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "mb-1.5 block text-sm font-medium";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">New Opportunity</h2>
            {companyName && <span className="text-sm text-muted-foreground">— {companyName}</span>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Deal name */}
          <div>
            <label className={labelCls}>Opportunity name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp — Enterprise licence"
              className={inputCls} required />
          </div>

          {/* Product */}
          <div>
            <label className={labelCls}>Product / Service</label>
            <input value={product} onChange={(e) => setProduct(e.target.value)}
              placeholder="e.g. Growth Plan, Professional Services…"
              className={inputCls} />
          </div>

          {/* Value + currency */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Deal value</label>
              <input type="number" min="0" step="0.01" value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Stage */}
          <div>
            <label className={labelCls}>Stage</label>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <button key={s.value} type="button" onClick={() => setStage(s.value)}
                  className={cn("rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                    stage === s.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-muted")}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Close date */}
          <div>
            <label className={labelCls}>Expected close date</label>
            <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className={inputCls} />
          </div>

          {/* Main POC / contact */}
          <div>
            <label className={labelCls}>Main point of contact</label>
            {selectedPoc ? (
              <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{selectedPoc.first_name} {selectedPoc.last_name}</p>
                  <p className="text-xs text-muted-foreground">{selectedPoc.email}</p>
                </div>
                <button type="button" onClick={() => { setSelectedPoc(null); setPocQuery(""); }}
                  className="text-muted-foreground hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={pocQuery} onChange={(e) => setPocQuery(e.target.value)}
                  onFocus={() => pocResults.length > 0 && setPocOpen(true)}
                  placeholder="Search contacts…"
                  className={cn(inputCls, "pl-9")} />
                {pocOpen && pocResults.length > 0 && (
                  <div className="absolute top-full mt-1 z-10 w-full rounded-xl border bg-card shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {pocResults.map((c) => (
                      <button key={c.id} type="button"
                        onClick={() => { setSelectedPoc(c); setPocQuery(""); setPocOpen(false); }}
                        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted transition-colors">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {(c.first_name?.[0] ?? "") + (c.last_name?.[0] ?? "")}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{c.first_name} {c.last_name}</p>
                          <p className="text-xs text-muted-foreground">{c.email}{c.title && " · " + c.title}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="Deal context, requirements, anything relevant…"
              className={cn(inputCls, "resize-none")} />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Opportunity created!
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button type="submit" disabled={loading || !name.trim()}
              className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                (loading || !name.trim()) ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              {loading ? "Creating…" : "Create Opportunity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
