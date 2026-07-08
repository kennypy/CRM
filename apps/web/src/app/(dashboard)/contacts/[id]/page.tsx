"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { formatRelativeTime, cn } from "@/lib/utils";
import { EditContactModal } from "@/components/modals/edit-contact-modal";
import { CustomFieldsDisplay } from "@/components/custom-fields/custom-fields-form";
import { TagInput } from "@/components/ui/tag-input";
import { NotesPanel } from "@/components/ui/notes-panel";
import { OwnerPicker } from "@/components/ui/owner-picker";
import {
  User, Mail, Phone, Building2, ArrowLeft, Pencil,
  AlertCircle, Activity, Briefcase, Shield, ShieldOff,
  Calendar, Globe, ExternalLink, MapPin,
} from "lucide-react";

interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  title?: string;
  seniority?: string;
  company?: { id: string; name: string };
  influenceScore?: number;
  lastActivityAt?: string;
  linkedinUrl?: string;
  source: string;
  lifecycleStage?: string;
  leadSource?: string;
  ownerId?: string;
  gdprConsent?: boolean;
  gdprConsentDate?: string;
  doNotContact?: boolean;
  doNotContactReason?: string;
  communicationPreferences?: { email?: boolean; phone?: boolean; sms?: boolean };
  engagementScore?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  createdAt: string;
  updatedAt?: string;
  customFields?: Record<string, unknown>;
}

interface ActivityRow {
  id: string;
  type: string;
  subject?: string;
  occurred_at?: string;
}

interface DealRow {
  id: string;
  name: string;
  value?: number;
  stage?: string;
  updated_at: string;
}

const LIFECYCLE_COLORS: Record<string, string> = {
  subscriber: "bg-gray-100 text-gray-700",
  lead: "bg-blue-100 text-blue-700",
  mql: "bg-purple-100 text-purple-700",
  sql: "bg-indigo-100 text-indigo-700",
  opportunity: "bg-orange-100 text-orange-700",
  customer: "bg-green-100 text-green-700",
};

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const perms = usePermissions();
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const tl = useTranslations("lifecycle");
  const tg = useTranslations("gdpr");

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const contactId = params.id as string;

  const fetchContact = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/v1/contacts/${contactId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setContact(json.data ?? json);

      // Fetch related activities
      const actRes = await api.get(`/api/v1/activities?contactId=${contactId}&limit=20`);
      if (actRes.ok) {
        const actJson = await actRes.json();
        setActivities(actJson.data ?? []);
      }

      // Fetch related deals
      const dealRes = await api.get(`/api/v1/deals?contactId=${contactId}&limit=10`);
      if (dealRes.ok) {
        const dealJson = await dealRes.json();
        setDeals(dealJson.data ?? []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { fetchContact(); }, [fetchContact]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-muted-foreground">{error ?? "Contact not found"}</p>
        <button onClick={() => router.push("/contacts")} className="text-sm text-primary hover:underline">
          {t("title")}
        </button>
      </div>
    );
  }

  const initials = `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase();

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={() => router.push("/contacts")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("title")}
      </button>

      {/* Profile header */}
      <div className="flex items-start justify-between rounded-xl border bg-card p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{contact.firstName} {contact.lastName}</h1>
            {contact.title && <p className="text-sm text-muted-foreground">{contact.title}</p>}
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {contact.email}</span>
              {contact.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {contact.phone}</span>}
            </div>
            {contact.company && (
              <button onClick={() => router.push(`/companies/${contact.company!.id}`)}
                className="mt-1 flex items-center gap-1 text-sm text-primary hover:underline">
                <Building2 className="h-3.5 w-3.5" /> {contact.company.name}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contact.lifecycleStage && (
            <span className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize", LIFECYCLE_COLORS[contact.lifecycleStage] ?? "bg-gray-100")}>
              {tl(contact.lifecycleStage as any, { defaultValue: contact.lifecycleStage })}
            </span>
          )}
          {contact.doNotContact && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
              <ShieldOff className="mr-1 inline h-3 w-3" /> {tg("doNotContact")}
            </span>
          )}
          {perms.canWrite && (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
              <Pencil className="h-3.5 w-3.5" /> {tc("edit")}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left column — details */}
        <div className="col-span-2 space-y-6">
          {/* Contact details grid */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">Contact Details</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Owner</span>
                <div className="mt-1">
                  <OwnerPicker
                    value={contact.ownerId}
                    onChange={async (userId) => {
                      await api.patch(`/api/v1/contacts/${contact.id}`, { ownerId: userId });
                      fetchContact();
                    }}
                  />
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Source</span>
                <p className="mt-1 capitalize">{contact.leadSource ?? contact.source ?? "—"}</p>
              </div>
              {contact.engagementScore != null && (
                <div>
                  <span className="text-muted-foreground">Engagement Score</span>
                  <p className="mt-1 font-medium">{contact.engagementScore}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Created</span>
                <p className="mt-1">{new Date(contact.createdAt).toLocaleDateString()}</p>
              </div>
              {(contact.utmSource || contact.utmMedium || contact.utmCampaign) && (
                <>
                  {contact.utmSource && <div><span className="text-muted-foreground">UTM Source</span><p className="mt-1">{contact.utmSource}</p></div>}
                  {contact.utmMedium && <div><span className="text-muted-foreground">UTM Medium</span><p className="mt-1">{contact.utmMedium}</p></div>}
                  {contact.utmCampaign && <div><span className="text-muted-foreground">UTM Campaign</span><p className="mt-1">{contact.utmCampaign}</p></div>}
                </>
              )}
            </div>
          </div>

          {/* Custom fields */}
          {contact.customFields && Object.keys(contact.customFields).length > 0 && (
            <div className="rounded-xl border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold">Custom Fields</h2>
              <CustomFieldsDisplay entityType="contact" values={contact.customFields} />
            </div>
          )}

          {/* GDPR & Communication Preferences */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Shield className="h-4 w-4" /> {tg("consent")} & {tg("commPrefs")}
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{tg("consent")}</span>
                <p className={cn("mt-1 font-medium", contact.gdprConsent ? "text-green-600" : "text-red-600")}>
                  {contact.gdprConsent ? tc("yes") : tc("no")}
                </p>
                {contact.gdprConsentDate && (
                  <p className="text-xs text-muted-foreground">{new Date(contact.gdprConsentDate).toLocaleDateString()}</p>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{tg("doNotContact")}</span>
                <p className={cn("mt-1 font-medium", contact.doNotContact ? "text-red-600" : "text-green-600")}>
                  {contact.doNotContact ? tc("yes") : tc("no")}
                </p>
                {contact.doNotContactReason && (
                  <p className="text-xs text-muted-foreground">{contact.doNotContactReason}</p>
                )}
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{tg("commPrefs")}</span>
                <div className="mt-2 flex gap-3">
                  {[
                    { key: "email", label: tg("emailOptIn") },
                    { key: "phone", label: tg("phoneOptIn") },
                    { key: "sms",   label: tg("smsOptIn") },
                  ].map(({ key, label }) => {
                    const opted = (contact.communicationPreferences as any)?.[key] !== false;
                    return (
                      <span key={key} className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        opted ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700",
                      )}>
                        {label}: {opted ? tc("yes") : tc("no")}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Tags</h2>
            <TagInput entityType="contact" entityId={contact.id} readOnly={!perms.canWrite} />
          </div>

          {/* Activity timeline */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" /> Recent Activities
            </h2>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activities yet</p>
            ) : (
              <div className="space-y-3">
                {activities.map((act) => (
                  <div key={act.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium capitalize">{act.type.replace(/_/g, " ")}</p>
                      {act.subject && <p className="text-xs text-muted-foreground">{act.subject}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {act.occurred_at ? formatRelativeTime(act.occurred_at) : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — sidebar */}
        <div className="space-y-6">
          {/* Deals */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Briefcase className="h-4 w-4" /> Deals ({deals.length})
            </h2>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deals yet</p>
            ) : (
              <div className="space-y-2">
                {deals.map((deal) => (
                  <button key={deal.id} onClick={() => router.push("/pipeline")}
                    className="block w-full rounded-lg border p-3 text-left text-sm hover:bg-muted">
                    <p className="font-medium">{deal.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {deal.stage && <span className="capitalize">{deal.stage.replace(/_/g, " ")}</span>}
                      {deal.value != null && <span>${deal.value.toLocaleString()}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-xl border bg-card p-5">
            <NotesPanel entityType="contact" entityId={contact.id} readOnly={!perms.canWrite} />
          </div>

          {/* LinkedIn */}
          {contact.linkedinUrl && (
            <div className="rounded-xl border bg-card p-5">
              <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4" /> View LinkedIn Profile
              </a>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditContactModal
          contact={contact}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); fetchContact(); }}
        />
      )}
    </div>
  );
}
