"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { useTenant } from "@/lib/tenant-context";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { AddContactModal } from "@/components/modals/add-contact-modal";
import { AddDealModal } from "@/components/modals/add-deal-modal";
import { EditCompanyModal } from "@/components/modals/edit-company-modal";
import {
  Building2, Globe, Users, Briefcase, Calendar, ArrowLeft,
  Plus, Pencil, ExternalLink, AlertCircle, Mail, Activity,
  ChevronRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company {
  id: string; name: string; domain?: string; industry?: string;
  headcount?: number; tier?: string; website?: string; country?: string;
  openDeals: number; openDealValue: number; createdAt: string;
}

interface ContactRow {
  id: string; first_name: string; last_name: string; email: string;
  title?: string; seniority?: string; influence_score?: number; last_activity_at?: string;
}

interface DealRow {
  id: string; name: string; value?: number; currency?: string;
  stage?: string; probability?: number; close_date?: string; updated_at: string;
}

interface ActivityRow {
  id: string; type: string; subject?: string; occurred_at?: string;
}

interface DetailData {
  company: Company;
  contacts: ContactRow[];
  deals: DealRow[];
  activities: ActivityRow[];
}

// ── Stage badge ───────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage?: string }) {
  if (!stage) return <span className="text-xs text-muted-foreground">—</span>;
  const colors: Record<string, string> = {
    discovery:    "bg-blue-100 text-blue-700",
    qualification:"bg-indigo-100 text-indigo-700",
    proposal:     "bg-purple-100 text-purple-700",
    negotiation:  "bg-orange-100 text-orange-700",
    closed_won:   "bg-green-100 text-green-700",
    closed_lost:  "bg-red-100 text-red-700",
  };
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
      colors[stage] ?? "bg-muted text-muted-foreground")}>
      {stage.replace("_", " ")}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const perms  = usePermissions();
  const { tenant } = useTenant();
  const id = params.id as string;

  const [data, setData]         = useState<DetailData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddDeal,     setShowAddDeal]     = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/v1/companies/${id}/detail`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load company");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [id]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <span>{error ?? "Company not found"}</span>
        </div>
        <button onClick={() => router.back()} className="text-sm text-primary hover:underline">
          ← Back to Companies
        </button>
      </div>
    );
  }

  const { company, contacts, deals, activities } = data;

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Back nav */}
      <button
        onClick={() => router.push("/companies")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Companies
      </button>

      {/* Company header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">
            {company.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{company.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              {company.domain && (
                <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
                  <Globe className="h-3.5 w-3.5" />{company.domain}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {company.industry && (
                <span className="text-sm text-muted-foreground capitalize">{company.industry}</span>
              )}
              {company.country && (
                <span className="text-sm text-muted-foreground">{company.country}</span>
              )}
            </div>
          </div>
        </div>
        {perms.canWrite && (
          <button onClick={() => setShowEdit(true)}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
            <Pencil className="h-4 w-4" /> Edit
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Open Deals",    value: String(company.openDeals ?? 0),          icon: Briefcase },
          { label: "Pipeline",      value: formatCurrency(company.openDealValue ?? 0, tenant.defaultCurrency, true, tenant.locale), icon: ChevronRight },
          { label: "Contacts",      value: String(contacts.length),                 icon: Users },
          { label: "Employees",     value: company.headcount ? `${company.headcount.toLocaleString()}` : "—", icon: Building2 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Icon className="h-3.5 w-3.5" />{label}
            </div>
            <p className="text-xl font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* Two-column layout: Contacts + Deals */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Contacts */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2 font-medium">
              <Users className="h-4 w-4 text-primary" />
              Contacts <span className="text-xs text-muted-foreground">({contacts.length})</span>
            </div>
            {perms.canWrite && (
              <button onClick={() => setShowAddContact(true)}
                className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-3 w-3" /> Add
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {contacts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-center text-muted-foreground">No contacts yet</p>
            ) : contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {c.first_name} {c.last_name}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" />{c.email}
                  </div>
                </div>
                <div className="text-right">
                  {c.title && <p className="text-xs text-muted-foreground">{c.title}</p>}
                  {c.last_activity_at && (
                    <p className="text-xs text-muted-foreground">{formatRelativeTime(c.last_activity_at)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Deals */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2 font-medium">
              <Briefcase className="h-4 w-4 text-primary" />
              Deals <span className="text-xs text-muted-foreground">({deals.length})</span>
            </div>
            {perms.canWrite && (
              <button onClick={() => setShowAddDeal(true)}
                className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-3 w-3" /> Add Deal
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {deals.length === 0 ? (
              <p className="px-5 py-6 text-sm text-center text-muted-foreground">No deals yet</p>
            ) : deals.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30">
                <div>
                  <p className="text-sm font-medium text-foreground">{d.name}</p>
                  <StageBadge stage={d.stage} />
                </div>
                <div className="text-right">
                  {d.value != null && (
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {formatCurrency(d.value, d.currency ?? tenant.defaultCurrency, true, tenant.locale)}
                    </p>
                  )}
                  {d.close_date && (
                    <p className="text-xs text-muted-foreground">Closes {new Date(d.close_date).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activities */}
      {activities.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b px-5 py-3 font-medium">
            <Activity className="h-4 w-4 text-primary" /> Recent Activities
          </div>
          <div className="divide-y divide-border">
            {activities.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm capitalize text-foreground">{a.type}</span>
                  {a.subject && <span className="text-sm text-muted-foreground">— {a.subject}</span>}
                </div>
                {a.occurred_at && (
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(a.occurred_at)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onCreated={() => { setShowAddContact(false); fetchDetail(); }}
          prelinkedCompanyId={company.id}
          prelinkedCompanyName={company.name}
        />
      )}
      {showAddDeal && (
        <AddDealModal
          companyId={company.id}
          companyName={company.name}
          defaultCurrency={tenant.defaultCurrency}
          onClose={() => setShowAddDeal(false)}
          onCreated={() => { setShowAddDeal(false); fetchDetail(); }}
        />
      )}
      {showEdit && (
        <EditCompanyModal
          company={company}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); fetchDetail(); }}
        />
      )}
    </div>
  );
}
