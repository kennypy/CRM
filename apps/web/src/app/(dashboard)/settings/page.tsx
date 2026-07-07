"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import { api } from "@/lib/api";
import { useTenant } from "@/lib/tenant-context";
import {
  Settings, Users, Plug, CreditCard, Shield, User,
  Plus, Trash2, Mail, CheckCircle2, AlertCircle, X,
  Globe, Lock, Key, Monitor, LogOut, Building2, Phone, Sun, Moon,
  FileText, Package, ChevronDown, Columns3, Box, LockKeyhole, UsersRound, Upload,
  Copy, Check, CalendarClock,
} from "lucide-react";
import type { StoredUser } from "@/lib/auth";
import { useTheme } from "@/components/theme/theme-provider";
import type { Theme } from "@/components/theme/theme-provider";
import { useFont, FONTS, type FontKey } from "@/components/theme/font-provider";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { InviteUserModal } from "@/components/settings/invite-user-modal";
import { TeamsTab } from "@/components/settings/teams-tab";
import { ProductsImportModal } from "@/components/settings/products-import-modal";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TeamUser {
  id: string; firstName: string; lastName: string; email: string;
  role: "admin" | "manager" | "rep" | "read_only";
  lastLoginAt?: string; status: "active" | "invited";
  managerId?: string | null;
  canQuote?: boolean;
  capabilities?: Record<string, boolean>;
  profileId?: string | null;
  timezone?: string | null;
}

interface UserProfile {
  id: string; name: string; description?: string | null;
  baseRole: "admin" | "manager" | "rep" | "read_only";
  capabilities: Record<string, boolean>;
  defaultTimezone?: string | null; defaultLanguage?: string | null;
  isBuiltin: boolean; sortOrder: number;
}
interface Capability { key: string; label: string; }


const INTEGRATIONS = [
  { id: "gmail",   name: "Gmail",           icon: "📧", status: "connected", account: "admin@nexcrm.dev", desc: "Email ingestion active"          },
  { id: "gcal",    name: "Google Calendar", icon: "📅", status: "connected", account: "admin@nexcrm.dev", desc: "Meetings auto-captured"          },
  { id: "outlook", name: "Outlook / MS365", icon: "📬", status: "available", account: null,               desc: "Connect to ingest Outlook mail"  },
  { id: "slack",   name: "Slack",           icon: "💬", status: "available", account: null,               desc: "Deal alerts & notifications"     },
  { id: "zoom",    name: "Zoom",            icon: "🎥", status: "available", account: null,               desc: "Auto-transcribe meetings"         },
  { id: "stripe",  name: "Stripe",          icon: "💳", status: "available", account: null,               desc: "Revenue data sync"               },
];

function useRoleLabels(): Record<string, string> {
  const tr = useTranslations("roles");
  return {
    super_admin: tr("superAdmin"), admin: tr("admin"), manager: tr("manager"), rep: tr("rep"), read_only: tr("readOnly"),
  };
}
const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-700",   admin:     "bg-purple-100 text-purple-700",
  manager:     "bg-blue-100 text-blue-700", rep:       "bg-green-100 text-green-700",
  read_only:   "bg-gray-100 text-gray-600",
};

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "CHF", "INR", "BRL"];
const SUPPORTED_TIMEZONES  = [
  "UTC", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Singapore",
  "Asia/Tokyo", "Australia/Sydney",
];

// Broader IANA list for the per-user profile timezone picker.
const PROFILE_TIMEZONES = [
  "UTC",
  "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Sao_Paulo", "America/Mexico_City", "America/Toronto",
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin",
  "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Stockholm", "Europe/Moscow",
  "Africa/Johannesburg", "Africa/Lagos", "Africa/Cairo",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Perth", "Australia/Sydney", "Pacific/Auckland",
];

function detectedTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

type Tab = "profile" | "general" | "users" | "teams" | "integrations" | "billing" | "security" | "communications" | "quoting" | "products" | "custom-fields" | "custom-objects" | "permissions";

// ── Theme Selector ─────────────────────────────────────────────────────────────

function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations("settings");
  const options: { value: Theme; label: string; icon: React.FC<{ className?: string }> }[] = [
    { value: "light",  label: t("themeLight"),  icon: Sun     },
    { value: "dark",   label: t("themeDark"),   icon: Moon    },
    { value: "system", label: t("themeSystem"), icon: Monitor },
  ];
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">{t("theme")}</label>
      <div className="flex gap-2">
        {options.map(({ value, label, icon: Icon }) => (
          <button key={value} onClick={() => setTheme(value)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors",
              theme === value
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            )}>
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Font Selector ──────────────────────────────────────────────────────────────

function FontSelector() {
  const { font, setFont } = useFont();
  const t = useTranslations("settings");
  const keys = Object.keys(FONTS) as FontKey[];
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">{t("font")}</label>
      <div className="grid grid-cols-5 gap-2">
        {keys.map((k) => (
          <button key={k} onClick={() => setFont(k)}
            style={{ fontFamily: FONTS[k].stack }}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border py-3 text-xs font-medium transition-colors",
              font === k ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted"
            )}>
            <span className="text-lg leading-none">Aa</span>
            {FONTS[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Profile ───────────────────────────────────────────────────────────────

function ProfileTab({ user }: { user: StoredUser | null }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const ROLE_LABELS = useRoleLabels();
  const initials = user ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` : "?";
  const [firstName,    setFirstName]    = useState(user?.firstName ?? "");
  const [lastName,     setLastName]     = useState(user?.lastName  ?? "");
  const [email,        setEmail]        = useState(user?.email     ?? "");
  const [country,      setCountry]      = useState("");
  const [timezone,     setTimezone]     = useState("");
  const [phone,        setPhone]        = useState("");
  const [twilioNumber, setTwilioNumber] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    api.get("/api/v1/users/me").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      const d = j.data;
      if (d.country)      setCountry(d.country);
      // Prefill the timezone with the browser-detected zone when the user has
      // none saved yet, so the picker isn't blank.
      setTimezone(d.timezone || detectedTimezone());
      if (d.phone)        setPhone(d.phone);
      if (d.twilioNumber) setTwilioNumber(d.twilioNumber);
    }).catch(() => {});
  }, []);

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  const saveProfile = async () => {
    if (!firstName.trim() || !email.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await api.patch("/api/v1/users/me", {
        firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(),
        country: country || null, timezone: timezone || null,
        phone: phone || null, twilioNumber: twilioNumber || null,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? t("failedSave"));
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError(tc("networkError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold">
          {initials}
        </div>
        <div>
          <p className="text-lg font-semibold">{user?.firstName} {user?.lastName}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize", ROLE_COLORS[user?.role ?? "rep"])}>
            {ROLE_LABELS[user?.role ?? "rep"]}
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">{t("personalInfo")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("firstName")}</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("lastName")}</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{tc("email")}</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("phone")}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+1 555 000 0000" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("twilioNumber")}</label>
            <input value={twilioNumber} onChange={(e) => setTwilioNumber(e.target.value)} placeholder="+1 555 000 0000" className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("country")}</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. United Kingdom" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("timezone")}</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
              {/* Ensure a saved value outside the curated list still shows. */}
              {timezone && !PROFILE_TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {PROFILE_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={saveProfile} disabled={saving || !firstName.trim() || !email.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {saving ? tc("saving") : tc("saveChanges")}
          </button>
          {saved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> {t("savedProfile")}</span>}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">{t("appearance")}</h3>
        <ThemeSelector />
        <FontSelector />
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">{t("languageLabel")}</h3>
        <p className="text-sm text-muted-foreground">{t("languageDescription")}</p>
        <LanguageSwitcher />
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h3 className="font-semibold">{t("workspace")}</h3>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("organisation")}</span>
          <span className="font-medium">{user?.tenantName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("role")}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROLE_COLORS[user?.role ?? "rep"])}>
            {ROLE_LABELS[user?.role ?? "rep"]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("roleChangeNote")}
        </p>
      </div>
    </div>
  );
}

// ── Tab: General (Company Settings — admin only) ────────────────────────────────

function GeneralTab({ user }: { user: StoredUser | null }) {
  const { tenant, refresh } = useTenant();
  const [orgName,  setOrgName]  = useState(user?.tenantName ?? "");
  const [timezone, setTimezone] = useState(tenant.timezone);
  const [currency, setCurrency] = useState(tenant.defaultCurrency);
  const [saved,    setSaved]    = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => { setTimezone(tenant.timezone); setCurrency(tenant.defaultCurrency); }, [tenant.timezone, tenant.defaultCurrency]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await api.patch("/api/v1/tenant", { defaultCurrency: currency, timezone });
      if (!res.ok) { const json = await res.json().catch(() => ({})); setError(json?.error?.message ?? "Failed to save"); return; }
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { setError("Network error — please try again"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-lg" suppressHydrationWarning>
      <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700">
        <Building2 className="h-4 w-4 shrink-0" />
        <p>These settings apply to your entire workspace. Only admins can change them.</p>
      </div>
      <div>
        <h3 className="text-base font-semibold mb-4">Organisation</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Organisation name</label>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} suppressHydrationWarning
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium flex items-center gap-2"><Globe className="h-4 w-4" />Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} suppressHydrationWarning
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SUPPORTED_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Default currency</label>
            <p className="mb-2 text-xs text-muted-foreground">All new deals default to this currency.</p>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} suppressHydrationWarning
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} suppressHydrationWarning
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> Saved!</span>}
      </div>
    </div>
  );
}

// ── User Form Modal ─────────────────────────────────────────────────────────────

type UserFormMode = "create" | "edit";

interface UserFormProps {
  mode: UserFormMode;
  user?: TeamUser;
  allUsers: TeamUser[];
  onClose: () => void;
  onSaved: (u: TeamUser) => void;
}

// ── Scheduler assignment (individual + batch, WS2) ──────────────────────────────

function SchedulerAssignModal({ users, onClose }: { users: TeamUser[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title,    setTitle]    = useState("");
  const [duration, setDuration] = useState(30);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [result,   setResult]   = useState<{ created: number; skipped: number } | null>(null);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = selected.size === users.length && users.length > 0;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)));

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "mb-1.5 block text-sm font-medium";

  const submit = async () => {
    if (!selected.size) { setError("Select at least one user"); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post("/api/v1/booking-links/provision", {
        userIds: [...selected], title: title.trim() || undefined, durationMinutes: duration,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error?.message ?? "Failed to assign scheduler"); return; }
      setResult({ created: json.data?.created?.length ?? 0, skipped: json.data?.skipped?.length ?? 0 });
    } catch { setError("Network error — please try again"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Assign Scheduler</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {result ? (
          <div className="p-6 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Created {result.created} booking link{result.created !== 1 ? "s" : ""}{result.skipped > 0 && `, skipped ${result.skipped} already-assigned`}.
            </div>
            <p className="text-xs text-muted-foreground">Each user now has a personal booking link they can share and manage under Meetings.</p>
            <button onClick={onClose} className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Done</button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">Give one or more users a personal booking link. Select the users, then set a title and default duration.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Title <span className="font-normal text-muted-foreground">(optional)</span></label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Defaults per user" />
              </div>
              <div>
                <label className={labelCls}>Duration (min)</label>
                <input type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputCls} />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium">Users ({selected.size} selected)</label>
                <button type="button" onClick={toggleAll} className="text-xs font-medium text-primary hover:underline">
                  {allSelected ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {users.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 rounded border-border" />
                    <span className="text-sm">{u.firstName} {u.lastName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{u.email}</span>
                  </label>
                ))}
                {users.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No users to assign.</p>}
              </div>
            </div>
            {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">Cancel</button>
              <button type="button" onClick={submit} disabled={saving || !selected.size} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                {saving ? "Assigning…" : `Assign to ${selected.size || 0}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Profiles manager (built-in + editable presets, WS2) ─────────────────────────

function ProfilesManagerModal({ onClose }: { onClose: () => void }) {
  const ROLE_LABELS = useRoleLabels();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [caps,     setCaps]     = useState<Capability[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [editing,  setEditing]  = useState<Partial<UserProfile> | null>(null); // null = list view
  const [saving,   setSaving]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [pj, cj] = await Promise.all([
        api.get("/api/v1/user-profiles").then((r) => r.json()).catch(() => null),
        api.get("/api/v1/user-profiles/capabilities").then((r) => r.json()).catch(() => null),
      ]);
      if (pj?.success) setProfiles(pj.data as UserProfile[]);
      if (cj?.success) setCaps(cj.data as Capability[]);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "mb-1.5 block text-sm font-medium";

  const startNew = () => setEditing({ name: "", description: "", baseRole: "rep", capabilities: {}, defaultTimezone: null });
  const startEdit = (p: UserProfile) => setEditing({ ...p, capabilities: { ...p.capabilities } });

  const save = async () => {
    if (!editing?.name?.trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);
    const body = {
      name: editing.name, description: editing.description ?? null,
      baseRole: editing.baseRole ?? "rep", capabilities: editing.capabilities ?? {},
      defaultTimezone: editing.defaultTimezone ?? null,
    };
    try {
      const res = editing.id
        ? await api.patch(`/api/v1/user-profiles/${editing.id}`, body)
        : await api.post("/api/v1/user-profiles", body);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error?.message ?? "Failed to save profile"); return; }
      setEditing(null);
      await load();
    } catch { setError("Network error — please try again"); }
    finally { setSaving(false); }
  };

  const remove = async (p: UserProfile) => {
    if (!window.confirm(`Delete the "${p.name}" profile? Users keep their settings but lose the preset link.`)) return;
    setError(null);
    try {
      const res = await api.delete(`/api/v1/user-profiles/${p.id}`);
      if (res.ok || res.status === 404) await load();
      else { const json = await res.json().catch(() => ({})); setError(json?.error?.message ?? "Failed to delete"); }
    } catch { setError("Network error — could not delete"); }
  };

  const toggleCap = (key: string) =>
    setEditing((e) => e ? { ...e, capabilities: { ...(e.capabilities ?? {}), [key]: !(e.capabilities ?? {})[key] } } : e);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{editing ? (editing.id ? "Edit Profile" : "New Profile") : "User Profiles"}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {editing ? (
          <div className="p-6 space-y-4">
            <div>
              <label className={labelCls}>Name *</label>
              <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} placeholder="e.g. Sales Rep" />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={inputCls} placeholder="What this preset is for" />
            </div>
            <div>
              <label className={labelCls}>Base role</label>
              <select value={editing.baseRole ?? "rep"} onChange={(e) => setEditing({ ...editing, baseRole: e.target.value as UserProfile["baseRole"] })} className={inputCls}>
                {(["admin", "manager", "rep", "read_only"] as const).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Default timezone</label>
              <select value={editing.defaultTimezone ?? ""} onChange={(e) => setEditing({ ...editing, defaultTimezone: e.target.value || null })} className={inputCls}>
                <option value="">— None —</option>
                {PROFILE_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Default features</label>
              <div className="space-y-1.5 rounded-lg border border-border p-2">
                {caps.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted">
                    <span className="text-sm">{c.label}</span>
                    <button type="button" onClick={() => toggleCap(c.key)}
                      className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                        (editing.capabilities ?? {})[c.key] ? "bg-primary" : "bg-muted-foreground/30")}>
                      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        (editing.capabilities ?? {})[c.key] ? "translate-x-4" : "translate-x-0")} />
                    </button>
                  </label>
                ))}
              </div>
            </div>
            {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setEditing(null); setError(null); }} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">Back</button>
              <button type="button" onClick={save} disabled={saving} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Save Profile"}</button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-3">
            <p className="text-sm text-muted-foreground">Presets bundle a role + default features + timezone. Pick one when creating a user to auto-fill everything.</p>
            {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading profiles…</p>
            ) : (
              <div className="space-y-2">
                {profiles.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{p.name}</p>
                        {p.isBuiltin && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Built-in</span>}
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", ROLE_COLORS[p.baseRole])}>{ROLE_LABELS[p.baseRole]}</span>
                      </div>
                      {p.description && <p className="truncate text-xs text-muted-foreground">{p.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => startEdit(p)} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">Edit</button>
                      {!p.isBuiltin && <button onClick={() => remove(p)} className="rounded-md p-1 text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={startNew} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              <Plus className="h-4 w-4" /> New profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function UserFormModal({ mode, user, allUsers, onClose, onSaved }: UserFormProps) {
  const ROLE_LABELS = useRoleLabels();
  const [firstName,   setFirstName]   = useState(user?.firstName ?? "");
  const [lastName,    setLastName]    = useState(user?.lastName  ?? "");
  const [email,       setEmail]       = useState(user?.email     ?? "");
  const [role,        setRole]        = useState<TeamUser["role"]>(user?.role ?? "rep");
  const [password,    setPassword]    = useState("");
  const [canQuote,    setCanQuote]    = useState<boolean>(user?.canQuote ?? false);
  const [managerId,   setManagerId]   = useState<string | null>(user?.managerId ?? null);
  const [timezone,    setTimezone]    = useState<string>(user?.timezone ?? (mode === "create" ? detectedTimezone() : ""));
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Provisioning profiles + the capability catalog (WS2).
  const [profiles,    setProfiles]    = useState<UserProfile[]>([]);
  const [caps,        setCaps]        = useState<Capability[]>([]);
  const [profileId,   setProfileId]   = useState<string | null>(user?.profileId ?? null);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>(user?.capabilities ?? {});
  // Create mode: default to issuing an invite link (no password) instead of setting one.
  const [sendInvite,  setSendInvite]  = useState<boolean>(mode === "create");
  const [inviteLink,  setInviteLink]  = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get("/api/v1/user-profiles").then((r) => r.json()).catch(() => null),
      api.get("/api/v1/user-profiles/capabilities").then((r) => r.json()).catch(() => null),
    ]).then(([pj, cj]) => {
      if (!alive) return;
      if (pj?.success) setProfiles(pj.data as UserProfile[]);
      if (cj?.success) setCaps(cj.data as Capability[]);
    });
    return () => { alive = false; };
  }, []);

  // When role changes to admin/manager, auto-enable quoting
  const handleRoleChange = (r: TeamUser["role"]) => {
    setRole(r);
    if (["admin", "manager"].includes(r)) setCanQuote(true);
  };

  // Applying a profile pre-fills role + capabilities + timezone.
  const applyProfile = (id: string) => {
    setProfileId(id || null);
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setRole(p.baseRole);
    setCapabilities({ ...p.capabilities });
    if (["admin", "manager"].includes(p.baseRole) || p.capabilities.can_quote) setCanQuote(true);
    if (p.defaultTimezone) setTimezone(p.defaultTimezone);
  };

  const toggleCap = (key: string) => setCapabilities((c) => ({ ...c, [key]: !c[key] }));

  const managerUser = allUsers.find((u) => u.id === managerId);
  const potentialManagers = allUsers.filter((u) => u.id !== user?.id && ["admin", "manager"].includes(u.role));

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "mb-1.5 block text-sm font-medium";

  const copyInvite = async () => {
    if (!inviteLink) return;
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* http clipboard may be blocked */ }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !email.trim()) return;
    if (mode === "create" && !sendInvite && !password.trim()) return;
    setSaving(true); setError(null);
    try {
      let res: Response;
      if (mode === "create") {
        const body: Record<string, unknown> = {
          firstName, lastName, email, role, canQuote, managerId: managerId || null,
          profileId: profileId || null, capabilities, timezone: timezone || null,
        };
        if (sendInvite) body.sendInvite = true; else body.password = password;
        res = await api.post("/api/v1/users", body);
      } else {
        const body: Record<string, unknown> = {
          firstName, lastName, email, role, canQuote, managerId: managerId || null,
          profileId: profileId || null, capabilities, timezone: timezone || null,
        };
        if (password.trim()) body.password = password;
        res = await api.patch(`/api/v1/users/${user!.id}`, body);
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Failed to save user");
        return;
      }
      const saved = json.data as TeamUser;
      onSaved({ ...saved, status: saved.status ?? (mode === "create" ? (sendInvite ? "invited" : "active") : user?.status ?? "active") });
      // If an invite link came back, surface it instead of closing immediately.
      const path = json?.invite?.activationPath as string | undefined;
      if (path) { setInviteLink(`${window.location.origin}${path}`); return; }
      onClose();
    } catch { setError("Network error — please try again"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{mode === "create" ? "Create User" : "Edit User"}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {inviteLink ? (
          <div className="p-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              User created. Send this activation link to <span className="font-medium text-foreground">{email}</span> — it lets them set a password and sign in (expires in 7 days).
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
              <input readOnly value={inviteLink} className="min-w-0 flex-1 bg-transparent text-xs outline-none" onFocus={(e) => e.currentTarget.select()} />
              <button onClick={copyInvite} className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </button>
            </div>
            <button onClick={onClose} className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Done</button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Profile preset */}
          {profiles.length > 0 && (
            <div>
              <label className={labelCls}>Profile preset</label>
              <select value={profileId ?? ""} onChange={(e) => applyProfile(e.target.value)} className={inputCls}>
                <option value="">— Custom (no preset) —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {profileId && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {profiles.find((p) => p.id === profileId)?.description ?? "Applies a role and default features."}
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>First name *</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={inputCls} placeholder="Jane" />
            </div>
            <div>
              <label className={labelCls}>Last name</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} placeholder="Smith" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Email address *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} placeholder="jane@company.com" />
          </div>
          <div>
            <label className={labelCls}>Role *</label>
            <select value={role} onChange={(e) => handleRoleChange(e.target.value as TeamUser["role"])} className={inputCls}>
              {(["admin", "manager", "rep", "read_only"] as const).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {role === "admin" && "Full access to all settings and data."}
              {role === "manager" && "Can view reports and manage reps, cannot change billing."}
              {role === "rep" && "Standard CRM access — contacts, opportunities, activities."}
              {role === "read_only" && "Read-only access to CRM data. Cannot create or edit."}
            </p>
          </div>
          {/* Timezone (prefilled from browser / profile) */}
          <div>
            <label className={labelCls}>Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
              <option value="">— Not set —</option>
              {timezone && !PROFILE_TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {PROFILE_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          {/* Manager */}
          <div>
            <label className={labelCls}>Reports to (manager)</label>
            <select
              value={managerId ?? ""}
              onChange={(e) => setManagerId(e.target.value || null)}
              className={inputCls}>
              <option value="">— No manager —</option>
              {potentialManagers.map((m) => (
                <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({ROLE_LABELS[m.role]})</option>
              ))}
            </select>
            {managerUser && (
              <p className="mt-1 text-xs text-muted-foreground">Reports to: {managerUser.firstName} {managerUser.lastName}</p>
            )}
          </div>
          {/* Feature capabilities */}
          {caps.length > 0 && (
            <div>
              <label className={labelCls}>Features</label>
              <div className="space-y-1.5 rounded-lg border border-border p-2">
                {caps.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted">
                    <span className="text-sm">{c.label}</span>
                    <button
                      type="button"
                      onClick={() => toggleCap(c.key)}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                        capabilities[c.key] ? "bg-primary" : "bg-muted-foreground/30"
                      )}>
                      <span className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        capabilities[c.key] ? "translate-x-4" : "translate-x-0"
                      )} />
                    </button>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Toggle the exact features this user can access.</p>
            </div>
          )}
          {/* Can Quote */}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Can create quotes</p>
              <p className="text-xs text-muted-foreground">Allow this user to create and send quotes</p>
            </div>
            <button
              type="button"
              onClick={() => setCanQuote(!canQuote)}
              disabled={["admin", "manager"].includes(role)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                canQuote ? "bg-primary" : "bg-muted",
                ["admin", "manager"].includes(role) && "opacity-60 cursor-not-allowed"
              )}>
              <span className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                canQuote ? "translate-x-5" : "translate-x-0"
              )} />
            </button>
          </div>
          {["admin", "manager"].includes(role) && (
            <p className="text-xs text-muted-foreground -mt-2">Admins and managers always have quoting enabled.</p>
          )}
          {/* Invite vs. set-password (create mode) */}
          {mode === "create" && (
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Send activation link</p>
                <p className="text-xs text-muted-foreground">User sets their own password on first login</p>
              </div>
              <button
                type="button"
                onClick={() => setSendInvite(!sendInvite)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                  sendInvite ? "bg-primary" : "bg-muted"
                )}>
                <span className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                  sendInvite ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>
          )}
          {!(mode === "create" && sendInvite) && (
            <div>
              <label className={labelCls}>{mode === "create" ? "Password *" : "New password"} {mode === "edit" && <span className="font-normal text-muted-foreground">(leave blank to keep current)</span>}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required={mode === "create" && !sendInvite} minLength={8}
                placeholder={mode === "create" ? "Min. 8 characters" : "Leave blank to keep unchanged"}
                className={inputCls} />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {saving ? "Saving…" : mode === "create" ? (sendInvite ? "Create & get link" : "Create User") : "Save Changes"}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

// ── Org Tree ──────────────────────────────────────────────────────────────────

function OrgNode({ user, allUsers, depth = 0 }: { user: TeamUser; allUsers: TeamUser[]; depth?: number }) {
  const ROLE_LABELS = useRoleLabels();
  const children = allUsers.filter((u) => u.managerId === user.id);
  return (
    <div className={cn("relative", depth > 0 && "ml-6 border-l border-border pl-4")}>
      <div className={cn("flex items-center gap-3 py-2", depth > 0 && "before:absolute before:-left-4 before:top-1/2 before:h-px before:w-4 before:bg-border")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
          {(user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{user.firstName} {user.lastName}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROLE_COLORS[user.role])}>
            {ROLE_LABELS[user.role]}
          </span>
          {user.canQuote && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Quotes</span>
          )}
        </div>
      </div>
      {children.map((child) => (
        <OrgNode key={child.id} user={child} allUsers={allUsers} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Tab: Users ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const ROLE_LABELS = useRoleLabels();
  const [users,        setUsers]        = useState<TeamUser[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [showCreate,   setShowCreate]   = useState(false);
  const [showInvite,   setShowInvite]   = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [editUser,     setEditUser]     = useState<TeamUser | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  const [viewMode,     setViewMode]     = useState<"list" | "org">("list");

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/v1/users");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Failed to load users");
        return;
      }
      const json = await res.json();
      setUsers(json.data ?? []);
    } catch {
      setError("Network error — could not load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreated = (u: TeamUser) => setUsers((prev) => [...prev, u]);
  const handleUpdated = (u: TeamUser) => setUsers((prev) => prev.map((x) => x.id === u.id ? u : x));

  const handleRoleChange = async (id: string, role: TeamUser["role"]) => {
    const prev = users.find((u) => u.id === id);
    setUsers((us) => us.map((u) => u.id === id ? { ...u, role } : u));
    setRoleChanging(id);
    setError(null);
    try {
      const res = await api.patch(`/api/v1/users/${id}`, { role });
      if (!res.ok) {
        if (prev) setUsers((us) => us.map((u) => u.id === id ? prev : u));
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Failed to update role");
      }
    } catch {
      if (prev) setUsers((us) => us.map((u) => u.id === id ? prev : u));
      setError("Network error — could not update role");
    } finally { setRoleChanging(null); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await api.delete(`/api/v1/users/${id}`);
      if (res.ok || res.status === 204 || res.status === 404) {
        setUsers((us) => us.filter((x) => x.id !== id));
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Failed to delete user");
      }
    } catch {
      setError("Network error — could not delete user");
    } finally { setDeletingId(null); }
  };

  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading users…</div>;
  if (error && users.length === 0) return (
    <div className="py-16 text-center space-y-3">
      <div className="flex items-center justify-center gap-2 text-sm text-red-600">
        <AlertCircle className="h-4 w-4" /> {error}
      </div>
      <button onClick={fetchUsers} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
        Retry
      </button>
    </div>
  );

  // Org chart root nodes: users with no managerId or whose manager isn't in the list
  const userIds = new Set(users.map((u) => u.id));
  const roots = users.filter((u) => !u.managerId || !userIds.has(u.managerId));

  return (
    <div className="space-y-4">
      {showCreate   && <UserFormModal mode="create" allUsers={users} onClose={() => setShowCreate(false)} onSaved={handleCreated} />}
      {showInvite   && <InviteUserModal onClose={() => setShowInvite(false)} onInvited={fetchUsers} />}
      {showProfiles && <ProfilesManagerModal onClose={() => setShowProfiles(false)} />}
      {showScheduler && <SchedulerAssignModal users={users} onClose={() => setShowScheduler(false)} />}
      {editUser     && <UserFormModal mode="edit" user={editUser} allUsers={users} onClose={() => setEditUser(null)} onSaved={handleUpdated} />}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          {(["list", "org"] as const).map((v) => (
            <button key={v} onClick={() => setViewMode(v)}
              className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors",
                viewMode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v === "list" ? "List" : "Org Chart"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{users.length} team member{users.length !== 1 ? "s" : ""}</p>
          <button onClick={() => setShowProfiles(true)}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            <UsersRound className="h-4 w-4" /> Profiles
          </button>
          <button onClick={() => setShowScheduler(true)}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            <CalendarClock className="h-4 w-4" /> Scheduler
          </button>
          <button onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            <Mail className="h-4 w-4" /> Invite
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Create user
          </button>
        </div>
      </div>

      {error && users.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      {viewMode === "org" ? (
        <div className="rounded-lg border bg-card p-4 space-y-1">
          {roots.length === 0
            ? <p className="text-sm text-muted-foreground italic">No users yet.</p>
            : roots.map((u) => <OrgNode key={u.id} user={u} allUsers={users} />)
          }
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["User", "Role", "Manager", "Quotes", "Last active", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const manager = users.find((m) => m.id === u.managerId);
                return (
                  <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {(u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "")}
                        </div>
                        <div>
                          <p className="font-medium">{u.firstName} {u.lastName}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={roleChanging === u.id}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as TeamUser["role"])}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30",
                          ROLE_COLORS[u.role]
                        )}>
                        {(["admin", "manager", "rep", "read_only"] as const).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {manager ? `${manager.firstName} ${manager.lastName}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {u.canQuote || ["admin","manager"].includes(u.role)
                        ? <span className="text-xs text-green-600">✓</span>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{u.lastLoginAt ?? "Never"}</td>
                    <td className="px-4 py-3">
                      {u.status === "active"
                        ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Active</span>
                        : <span className="flex items-center gap-1 text-xs text-yellow-600"><Mail className="h-3 w-3" /> Invited</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditUser(u)} title="Edit user"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(u.id)} disabled={deletingId === u.id} title="Delete user"
                          className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Role changes take effect on the user&apos;s next login. Admins can create, edit, and delete any team member.
      </p>
    </div>
  );
}

// ── Tab: Quoting ───────────────────────────────────────────────────────────────

function QuotingTab() {
  const ROLE_LABELS = useRoleLabels();
  const [threshold,  setThreshold]  = useState(10);
  const [validDays,  setValidDays]  = useState(30);
  const [sendMethod, setSendMethod] = useState("email");
  const [users,      setUsers]      = useState<TeamUser[]>([]);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [quotingMap, setQuotingMap] = useState<Record<string, boolean>>({});
  const [roleThresholds, setRoleThresholds] = useState<Record<string, number>>({
    rep: 10,
    manager: 25,
    admin: 50,
  });
  const [tcvTiers, setTcvTiers] = useState([
    { label: "< $10k", maxTcv: 10000, maxDiscount: 15, approver: "manager" },
    { label: "$10k – $50k", maxTcv: 50000, maxDiscount: 10, approver: "manager" },
    { label: "$50k – $250k", maxTcv: 250000, maxDiscount: 8, approver: "admin" },
    { label: "> $250k", maxTcv: Infinity, maxDiscount: 5, approver: "admin" },
  ]);

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  const updateTcvTier = (index: number, field: "maxDiscount" | "approver", value: number | string) => {
    setTcvTiers((prev) =>
      prev.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier))
    );
  };

  useEffect(() => {
    api.get("/api/v1/users")
      .then((r) => r.json())
      .then((j) => {
        const u: TeamUser[] = j.data ?? [];
        setUsers(u);
        const map: Record<string, boolean> = {};
        u.forEach((user) => { map[user.id] = user.canQuote ?? ["admin","manager"].includes(user.role); });
        setQuotingMap(map);
      })
      .catch(() => {
        setUsers([]);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch("/api/v1/tenant", {
        discountApprovalThreshold: threshold,
        quoteValidDays: validDays,
        quoteSendMethod: sendMethod,
        roleThresholds,
        tcvTiers: tcvTiers.map((t) => ({
          label: t.label,
          maxTcv: t.maxTcv === Infinity ? null : t.maxTcv,
          maxDiscount: t.maxDiscount,
          approver: t.approver,
        })),
      });
      // Update quoting skill per user
      for (const [id, canQuote] of Object.entries(quotingMap)) {
        await api.patch(`/api/v1/users/${id}`, { canQuote }).catch(() => {});
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Role-Based Discount Limits */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Role-Based Discount Limits</h3>
        <p className="text-xs text-muted-foreground">
          Maximum discount each role can apply without requiring further approval.
        </p>
        <div className="divide-y divide-border rounded-lg border overflow-hidden">
          {(["rep", "manager", "admin"] as const).map((role) => (
            <div key={role} className="flex items-center gap-4 px-4 py-3 bg-card">
              <span className="text-sm font-medium w-24 capitalize">{role === "rep" ? "Rep" : role === "manager" ? "Manager" : "Admin"}</span>
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={roleThresholds[role]}
                  onChange={(e) =>
                    setRoleThresholds((prev) => ({ ...prev, [role]: parseInt(e.target.value) || 0 }))
                  }
                  className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="text-sm text-muted-foreground">% max discount</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TCV-Based Approval Rules */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> TCV-Based Approval Rules</h3>
        <p className="text-xs text-muted-foreground">
          Configure maximum discount percentages and required approvers based on the Total Contract Value of the deal.
        </p>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Deal Size Tier</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Max Discount %</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Required Approver</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tcvTiers.map((tier, idx) => (
                <tr key={tier.label} className="bg-card">
                  <td className="px-4 py-2.5 font-medium">{tier.label}</td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={tier.maxDiscount}
                      onChange={(e) => updateTcvTier(idx, "maxDiscount", parseInt(e.target.value) || 0)}
                      className="w-20 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={tier.approver}
                      onChange={(e) => updateTcvTier(idx, "approver", e.target.value)}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quote defaults */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Quote Defaults</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Default quote validity (days)</label>
            <input type="number" min="1" max="365" step="1" value={validDays}
              onChange={(e) => setValidDays(parseInt(e.target.value) || 30)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Default send method</label>
            <select value={sendMethod} onChange={(e) => setSendMethod(e.target.value)} className={inputCls}>
              <option value="email">Email from CRM (rep's address)</option>
              <option value="link">Shareable link</option>
              <option value="both">Email + Shareable link</option>
            </select>
          </div>
        </div>
      </div>

      {/* Per-user quoting skill */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Quoting Permissions</h3>
          <p className="text-xs text-muted-foreground mt-1">Control which users can create and send quotes. Admins and managers always have this permission.</p>
        </div>
        <div className="divide-y divide-border rounded-lg border overflow-hidden">
          {users.map((u) => {
            const isAlwaysOn = ["admin","manager","super_admin"].includes(u.role);
            return (
              <div key={u.id} className="flex items-center gap-4 px-4 py-3 bg-card">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                  {(u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{u.firstName} {u.lastName}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[u.role]} · {u.email}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isAlwaysOn || (quotingMap[u.id] ?? false)}
                    disabled={isAlwaysOn}
                    onChange={(e) => setQuotingMap((prev) => ({ ...prev, [u.id]: e.target.checked }))}
                    className="h-4 w-4 accent-primary rounded"
                  />
                  Can quote
                </label>
                {isAlwaysOn && <span className="text-xs text-muted-foreground">(always)</span>}
              </div>
            );
          })}
        </div>
      </div>

      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" /> Quoting settings saved
        </div>
      )}
      <button onClick={handleSave} disabled={saving}
        className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {saving ? "Saving…" : "Save quoting settings"}
      </button>
    </div>
  );
}

// ── Tab: Products ──────────────────────────────────────────────────────────────

function ProductsTab() {
  const { DEMO_PRODUCTS: demoProd, BILLING_CYCLE_LABELS, fmtCurrency } = (() => {
    const { DEMO_PRODUCTS, BILLING_CYCLE_LABELS, fmtCurrency } = require("@/lib/quotes");
    return { DEMO_PRODUCTS, BILLING_CYCLE_LABELS, fmtCurrency };
  })();

  const [products,    setProducts]    = useState<Record<string, unknown>[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [editProduct, setEditProduct] = useState<Record<string, unknown> | null>(null);
  const [showImport,  setShowImport]  = useState(false);

  const loadProducts = () => {
    api.get("/api/v1/products")
      .then((r) => r.json())
      .then((j) => setProducts(j.data?.length ? j.data : demoProd))
      .catch(() => setProducts(demoProd))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProducts(); }, []);

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading products…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{products.length} product{products.length !== 1 ? "s" : ""} in catalog</p>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </button>
          <button onClick={() => { setEditProduct(null); setShowForm(true); }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> Add product
          </button>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {["SKU", "Name", "Price", "Cycle", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {products.map((p: Record<string, unknown>) => (
              <tr key={String(p.id)} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{String(p.sku ?? "—")}</td>
                <td className="px-4 py-3">
                  <p className="font-medium">{String(p.name)}</p>
                  {!!p.description && <p className="text-xs text-muted-foreground truncate max-w-xs">{String(p.description)}</p>}
                </td>
                <td className="px-4 py-3 font-semibold">{fmtCurrency(Number(p.unitPrice ?? p.unit_price ?? 0), String(p.currency ?? "GBP"))}</td>
                <td className="px-4 py-3 text-muted-foreground">{BILLING_CYCLE_LABELS[String(p.billingCycle ?? p.billing_cycle ?? "one_time")]}</td>
                <td className="px-4 py-3">
                  <span className={p.active ? "text-green-700 text-xs font-medium" : "text-muted-foreground text-xs"}>
                    {p.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => { setEditProduct(p); setShowForm(true); }}
                    className="text-xs text-primary hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showImport && (
        <ProductsImportModal
          onClose={() => setShowImport(false)}
          onDone={loadProducts}
        />
      )}
    </div>
  );
}

// ── Tab: Integrations ──────────────────────────────────────────────────────────

function IntegrationsTab() {
  const [integrations,   setIntegrations]   = useState(INTEGRATIONS);
  const [disconnecting,  setDisconnecting]  = useState<string | null>(null);
  const [connectingId,   setConnectingId]   = useState<string | null>(null);
  const [connectResult,  setConnectResult]  = useState<{id: string; success: boolean} | null>(null);

  const demoAccounts: Record<string, string> = {
    slack: "acme-workspace",
    zoom: "admin@acme.com",
    outlook: "admin@acme.com",
    stripe: "acct_acme_prod",
  };

  const connect = (id: string) => {
    setConnectingId(id);
    setTimeout(() => {
      setIntegrations((prev) =>
        prev.map((i) => i.id === id ? { ...i, status: "connected", account: demoAccounts[id] ?? "demo-account" } : i)
      );
      setConnectingId(null);
      setConnectResult({ id, success: true });
      setTimeout(() => setConnectResult(null), 3000);
    }, 2000);
  };

  const disconnect = async (id: string) => {
    setDisconnecting(id);
    try {
      await api.delete(`/api/v1/integrations/${id}`);
    } catch { /* fall through — update locally anyway */ }
    setIntegrations((prev) => prev.map((i) => i.id === id ? { ...i, status: "available", account: null } : i));
    setDisconnecting(null);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {integrations.map((intg) => (
        <div key={intg.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{intg.icon}</span>
              <div>
                <p className="font-medium text-sm">{intg.name}</p>
                <p className="text-xs text-muted-foreground">{intg.desc}</p>
                {intg.status === "connected" && intg.account && (
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{intg.account}</p>
                )}
              </div>
            </div>
            {intg.status === "connected" ? (
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
                <button onClick={() => disconnect(intg.id)} disabled={disconnecting === intg.id}
                  className="text-xs text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50">
                  {disconnecting === intg.id ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <button onClick={() => connect(intg.id)} disabled={connectingId === intg.id}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
                  {connectingId === intg.id ? "Connecting…" : "Connect"}
                </button>
                {connectResult?.id === intg.id && connectResult.success && (
                  <span className="text-xs text-green-600 font-medium">Connected successfully!</span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Billing ───────────────────────────────────────────────────────────────

function BillingTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-xl border bg-gradient-to-r from-primary/5 to-accent/5 p-6">
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">GROWTH</span>
            <p className="mt-3 text-2xl font-bold">$49 <span className="text-base font-normal text-muted-foreground">/ user / month</span></p>
            <p className="text-sm text-muted-foreground mt-1">5 users · Billed monthly · Next billing Mar 15</p>
          </div>
          <button className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">Upgrade to Enterprise</button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {[
            { label: "AI extractions", used: "8,432", limit: "Unlimited" },
            { label: "Contacts",       used: "1,247", limit: "Unlimited" },
            { label: "Storage",        used: "2.3 GB", limit: "50 GB"   },
          ].map(({ label, used, limit }) => (
            <div key={label} className="rounded-lg bg-background/60 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold">{used}</p>
              <p className="text-xs text-muted-foreground">of {limit}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <h3 className="font-semibold mb-3">Payment method</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded bg-muted px-3 py-2 font-mono text-xs">VISA •••• 4242</div>
            <span className="text-xs text-muted-foreground">Expires 12/26</span>
          </div>
          <button className="text-sm text-primary hover:underline">Update</button>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Security ──────────────────────────────────────────────────────────────

function SecurityTab() {
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaved, setPwSaved] = useState(false);
  const [twoFa, setTwoFa]    = useState(false);

  const DEMO_SESSIONS = [
    { id: "s1", device: "Chrome · Windows",   ip: "192.168.1.10", lastActive: "Active now",  current: true  },
    { id: "s2", device: "Safari · macOS",      ip: "81.103.45.21", lastActive: "2 hours ago", current: false },
    { id: "s3", device: "NexCRM Mobile · iOS", ip: "81.103.45.21", lastActive: "1 day ago",   current: false },
  ];
  const DEMO_KEYS = [
    { id: "k1", name: "CI/CD Integration",  created: "2026-01-12", lastUsed: "3 days ago", prefix: "nxc_ci_••••••" },
    { id: "k2", name: "Internal Reporting", created: "2026-02-01", lastUsed: "Today",       prefix: "nxc_rp_••••••" },
  ];
  const [sessions, setSessions] = useState(DEMO_SESSIONS);
  const [apiKeys,  setApiKeys]  = useState(DEMO_KEYS);

  return (
    <div className="space-y-8 max-w-lg">
      <section>
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2"><Lock className="h-4 w-4" /> Change Password</h3>
        <div className="space-y-3">
          {(["current", "next", "confirm"] as const).map((field) => (
            <div key={field}>
              <label className="mb-1.5 block text-sm font-medium">
                {field === "current" ? "Current password" : field === "next" ? "New password" : "Confirm new password"}
              </label>
              <input type="password" value={pwForm[field]} onChange={(e) => setPwForm((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button disabled={!pwForm.current || !pwForm.next || pwForm.next !== pwForm.confirm}
              onClick={() => { setPwSaved(true); setPwForm({ current: "", next: "", confirm: "" }); setTimeout(() => setPwSaved(false), 2500); }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Update password
            </button>
            {pwSaved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> Password updated</span>}
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><Shield className="h-4 w-4" /> Two-Factor Authentication</h3>
        <div className="flex items-center justify-between rounded-lg border bg-card p-4">
          <div>
            <p className="text-sm font-medium">Authenticator app (TOTP)</p>
            <p className="text-xs text-muted-foreground mt-0.5">{twoFa ? "2FA is enabled." : "Add an extra layer of protection."}</p>
          </div>
          <button onClick={() => setTwoFa((v) => !v)}
            className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              twoFa ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200" : "bg-primary text-primary-foreground hover:opacity-90")}>
            {twoFa ? "Disable 2FA" : "Enable 2FA"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><Monitor className="h-4 w-4" /> Active Sessions</h3>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div><p className="text-sm font-medium">{s.device}</p><p className="text-xs text-muted-foreground">{s.ip} · {s.lastActive}</p></div>
              {s.current
                ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Current</span>
                : <button onClick={() => setSessions((prev) => prev.filter((x) => x.id !== s.id))}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600 transition-colors">
                    <LogOut className="h-3 w-3" /> Revoke
                  </button>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2"><Key className="h-4 w-4" /> API Keys</h3>
          <button className="text-xs text-primary hover:underline">+ New key</button>
        </div>
        <div className="space-y-2">
          {apiKeys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div>
                <p className="text-sm font-medium">{k.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{k.prefix}</p>
                <p className="text-xs text-muted-foreground">Created {k.created} · Last used {k.lastUsed}</p>
              </div>
              <button onClick={() => setApiKeys((prev) => prev.filter((x) => x.id !== k.id))}
                className="text-muted-foreground hover:text-red-600 transition-colors"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {apiKeys.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No API keys. Create one above.</p>}
        </div>
      </section>
    </div>
  );
}

// ── Tab: Communications ────────────────────────────────────────────────────────

const STORAGE_KEY_COMMS = "nexcrm_comms_config";

const DEFAULT_EMAIL_TEMPLATES = {
  welcome: {
    subject: "Welcome to NexCRM, {{firstName}}!",
    body: "Hi {{firstName}},\n\nYour workspace {{tenantName}} is ready.\n\nNexCRM captures your emails, calls, and meetings automatically — no manual data entry required.\n\nConnect your Google or Microsoft account in Settings → Integrations to start auto-capturing activities.\n\n{{loginUrl}}",
  },
  passwordReset: {
    subject: "Reset your NexCRM password",
    body: "Hi {{firstName}},\n\nWe received a request to reset your NexCRM password. Click the link below (expires in 1 hour):\n\n{{resetUrl}}\n\nIf you didn't request this, you can safely ignore this email.",
  },
  teamInvite: {
    subject: "{{inviterName}} invited you to {{tenantName}} on NexCRM",
    body: "Hi,\n\n{{inviterName}} has invited you to join {{tenantName}} on NexCRM.\n\nAccept your invitation here (expires in 7 days):\n{{acceptUrl}}",
  },
};

function loadCommsConfig() {
  try {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY_COMMS) : null;
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

function CommunicationsTab() {
  const [emailCfg, setEmailCfg] = useState({
    provider: "smtp",
    host: "",
    port: "587",
    username: "",
    password: "",
    fromName: "",
    fromEmail: "",
    tls: true,
  });

  const [diallerCfg, setDiallerCfg] = useState({
    provider: "twilio",
    twilioSid: "",
    twilioToken: "",
    twilioFrom: "",
    voipUrl: "",
  });

  const [templates, setTemplates] = useState(DEFAULT_EMAIL_TEMPLATES);
  const [activeTemplate, setActiveTemplate] = useState<"welcome" | "passwordReset" | "teamInvite">("welcome");

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = loadCommsConfig();
    if (cfg?.email) setEmailCfg((prev) => ({ ...prev, ...cfg.email }));
    if (cfg?.dialler) setDiallerCfg((prev) => ({ ...prev, ...cfg.dialler }));
    if (cfg?.templates) setTemplates((prev) => ({ ...prev, ...cfg.templates }));
  }, []);

  const setEmail = (k: keyof typeof emailCfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEmailCfg((prev) => ({ ...prev, [k]: e.target.value }));

  const setDialler = (k: keyof typeof diallerCfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDiallerCfg((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async () => {
    // Persist locally for offline/fast access
    try {
      localStorage.setItem(STORAGE_KEY_COMMS, JSON.stringify({ email: emailCfg, dialler: diallerCfg, templates }));
    } catch {}
    // Also sync to server so settings survive browser data clear
    try {
      await api.patch("/api/v1/tenant", { settings: { comms: { email: emailCfg, dialler: diallerCfg, templates } } });
    } catch { /* non-fatal — local copy is the fallback */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "mb-1.5 block text-sm font-medium";

  return (
    <div className="space-y-8 max-w-lg">
      {/* Email config */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">Email Configuration</h3>
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <label className={labelCls}>Provider</label>
            <select value={emailCfg.provider} onChange={setEmail("provider")} className={inputCls}>
              <option value="smtp">SMTP (custom)</option>
              <option value="gmail">Gmail / Google Workspace</option>
              <option value="outlook">Outlook / Microsoft 365</option>
              <option value="sendgrid">SendGrid</option>
            </select>
          </div>
          {emailCfg.provider === "smtp" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>SMTP host</label>
                  <input value={emailCfg.host} onChange={setEmail("host")} placeholder="smtp.example.com" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Port</label>
                  <input value={emailCfg.port} onChange={setEmail("port")} placeholder="587" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Username</label>
                  <input value={emailCfg.username} onChange={setEmail("username")} placeholder="user@example.com" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Password</label>
                  <input type="password" value={emailCfg.password} onChange={setEmail("password")} placeholder="••••••••" className={inputCls} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input id="tls" type="checkbox" checked={emailCfg.tls}
                  onChange={(e) => setEmailCfg((prev) => ({ ...prev, tls: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary" />
                <label htmlFor="tls" className="text-sm">Use TLS / STARTTLS</label>
              </div>
            </>
          )}
          {(emailCfg.provider === "gmail" || emailCfg.provider === "outlook") && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <p>Connect via OAuth in the <strong>Integrations</strong> tab — no credentials needed here.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>From name</label>
              <input value={emailCfg.fromName} onChange={setEmail("fromName")} placeholder="ACME Sales" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>From email</label>
              <input type="email" value={emailCfg.fromEmail} onChange={setEmail("fromEmail")} placeholder="sales@acme.com" className={inputCls} />
            </div>
          </div>
        </div>
      </section>

      {/* Dialler config */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Phone className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">Dialler Configuration</h3>
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <label className={labelCls}>Dialler provider</label>
            <select value={diallerCfg.provider} onChange={setDialler("provider")} className={inputCls}>
              <option value="twilio">Twilio (built-in)</option>
              <option value="voip">Custom VOIP / SIP URL</option>
              <option value="native">Browser native (tel: links)</option>
            </select>
          </div>

          {diallerCfg.provider === "twilio" && (
            <>
              <div>
                <label className={labelCls}>Account SID</label>
                <input value={diallerCfg.twilioSid} onChange={setDialler("twilioSid")} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Auth token</label>
                <input type="password" value={diallerCfg.twilioToken} onChange={setDialler("twilioToken")} placeholder="••••••••••••••••••••••••••••••••" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>From number</label>
                <input value={diallerCfg.twilioFrom} onChange={setDialler("twilioFrom")} placeholder="+15551234567" className={inputCls} />
                <p className="mt-1 text-xs text-muted-foreground">Must be a Twilio-verified number in E.164 format.</p>
              </div>
            </>
          )}

          {diallerCfg.provider === "voip" && (
            <div>
              <label className={labelCls}>VOIP / embedded dialler URL</label>
              <input value={diallerCfg.voipUrl} onChange={setDialler("voipUrl")} placeholder="https://dialler.yourpbx.com/embed" className={inputCls} />
              <p className="mt-1 text-xs text-muted-foreground">The URL will be loaded in an iframe when you open the phone panel.</p>
            </div>
          )}

          {diallerCfg.provider === "native" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
                Phone numbers will open as <code className="font-mono">tel:</code> links using your system&apos;s default app.
              </div>
              <div>
                <label className={labelCls}>Embedded dialler URL <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input value={diallerCfg.voipUrl} onChange={setDialler("voipUrl")} placeholder="https://your-dialler.com/embed" className={inputCls} />
                <p className="mt-1 text-xs text-muted-foreground">
                  If provided, this URL loads as an iframe inside the phone sidebar panel instead of opening a tel: link.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Email Templates */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">Email Templates</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Customise the transactional emails sent to users. Available variables are shown as{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">{"{{variable}}"}</code>.
        </p>

        {/* Template tabs */}
        <div className="mb-4 flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
          {([
            { id: "welcome"       as const, label: "Welcome"        },
            { id: "passwordReset" as const, label: "Password Reset" },
            { id: "teamInvite"    as const, label: "Team Invite"    },
          ]).map(({ id, label }) => (
            <button key={id} onClick={() => setActiveTemplate(id)}
              className={cn("rounded px-3 py-1 text-xs font-medium transition-colors",
                activeTemplate === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border bg-card p-5 space-y-4">
          {activeTemplate === "welcome" && (
            <p className="text-xs text-muted-foreground">
              Sent when a new user registers. Variables:{" "}
              <code className="font-mono">{"{{firstName}}"}</code>,{" "}
              <code className="font-mono">{"{{tenantName}}"}</code>,{" "}
              <code className="font-mono">{"{{loginUrl}}"}</code>
            </p>
          )}
          {activeTemplate === "passwordReset" && (
            <p className="text-xs text-muted-foreground">
              Sent when a user requests a password reset. Variables:{" "}
              <code className="font-mono">{"{{firstName}}"}</code>,{" "}
              <code className="font-mono">{"{{resetUrl}}"}</code>
            </p>
          )}
          {activeTemplate === "teamInvite" && (
            <p className="text-xs text-muted-foreground">
              Sent when an admin invites a team member. Variables:{" "}
              <code className="font-mono">{"{{inviterName}}"}</code>,{" "}
              <code className="font-mono">{"{{tenantName}}"}</code>,{" "}
              <code className="font-mono">{"{{acceptUrl}}"}</code>
            </p>
          )}
          <div>
            <label className={labelCls}>Subject line</label>
            <input
              value={templates[activeTemplate].subject}
              onChange={(e) => setTemplates((prev) => ({ ...prev, [activeTemplate]: { ...prev[activeTemplate], subject: e.target.value } }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Body</label>
            <textarea
              rows={8}
              value={templates[activeTemplate].body}
              onChange={(e) => setTemplates((prev) => ({ ...prev, [activeTemplate]: { ...prev[activeTemplate], body: e.target.value } }))}
              className={cn(inputCls, "resize-y font-mono text-xs")}
            />
          </div>
          <button
            onClick={() => setTemplates((prev) => ({ ...prev, [activeTemplate]: DEFAULT_EMAIL_TEMPLATES[activeTemplate] }))}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
            Reset to default
          </button>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Save changes
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" /> Saved!
          </span>
        )}
      </div>
    </div>
  );
}

// ── Custom Fields Tab ────────────────────────────────────────────────────────

function CustomFieldsTab() {
  const [fields, setFields] = useState<any[]>([]);
  const [entityType, setEntityType] = useState("contact");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ field_key: "", field_label: "", field_type: "text", is_required: false, options: [] as any[] });

  const entityTypes = ["contact", "company", "deal", "activity", "task"];
  const fieldTypes = ["text", "number", "date", "datetime", "boolean", "enum", "multi_enum", "url", "email", "phone", "currency"];

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/custom-fields?entityType=${entityType}`);
      const json = res.ok ? await res.json() : { data: [] };
      setFields(json.data ?? []);
    } catch { setFields([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [entityType]);

  const create = async () => {
    try {
      await api.post("/api/v1/custom-fields", { ...form, entity_type: entityType });
      setShowCreate(false);
      setForm({ field_key: "", field_label: "", field_type: "text", is_required: false, options: [] });
      load();
    } catch (e: any) { alert(e.message); }
  };

  const remove = async (id: string) => {
    await api.delete(`/api/v1/custom-fields/${id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {entityTypes.map((t) => (
            <button key={t} onClick={() => setEntityType(t)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                entityType === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {t}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Add Field
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="field_key (snake_case)" value={form.field_key}
              onChange={(e) => setForm({ ...form, field_key: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm" />
            <input placeholder="Display Label" value={form.field_label}
              onChange={(e) => setForm({ ...form, field_label: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm" />
            <select value={form.field_type} onChange={(e) => setForm({ ...form, field_type: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm">
              {fieldTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_required}
                onChange={(e) => setForm({ ...form, is_required: e.target.checked })} />
              Required
            </label>
            <button onClick={create}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              Create
            </button>
            <button onClick={() => setShowCreate(false)} className="text-sm text-muted-foreground hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-20 rounded-lg bg-muted animate-pulse" />
      ) : fields.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No custom fields for {entityType}. Click "Add Field" to create one.</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {fields.map((f: any) => (
            <div key={f.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{f.fieldLabel}</p>
                <p className="text-xs text-muted-foreground">{f.fieldKey} &middot; {f.fieldType}{f.isRequired ? " (required)" : ""}</p>
              </div>
              <button onClick={() => remove(f.id)} className="text-muted-foreground hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Custom Objects Tab ──────────────────────────────────────────────────────

function CustomObjectsTab() {
  const [objects, setObjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    object_key: "", object_label: "", object_label_plural: "", icon: "box", description: "",
    associations: [] as { target_entity_type: string; relationship_type: string }[],
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/v1/custom-objects");
      const json = res.ok ? await res.json() : { data: [] };
      setObjects(json.data ?? []);
    } catch { setObjects([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    try {
      await api.post("/api/v1/custom-objects", form);
      setShowCreate(false);
      setForm({ object_key: "", object_label: "", object_label_plural: "", icon: "box", description: "", associations: [] });
      load();
    } catch (e: any) { alert(e.message); }
  };

  const remove = async (id: string) => {
    await api.delete(`/api/v1/custom-objects/${id}`);
    load();
  };

  const addAssoc = () => {
    setForm({ ...form, associations: [...form.associations, { target_entity_type: "contact", relationship_type: "many_to_one" }] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{objects.length} custom object type{objects.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New Object Type
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="object_key (snake_case)" value={form.object_key}
              onChange={(e) => setForm({ ...form, object_key: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm" />
            <input placeholder="Label (singular)" value={form.object_label}
              onChange={(e) => setForm({ ...form, object_label: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm" />
            <input placeholder="Label (plural)" value={form.object_label_plural}
              onChange={(e) => setForm({ ...form, object_label_plural: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm" />
          </div>
          <textarea placeholder="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} />
          <div className="space-y-2">
            <p className="text-sm font-medium">Associations</p>
            {form.associations.map((a, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={a.target_entity_type}
                  onChange={(e) => {
                    const assocs = [...form.associations];
                    assocs[i] = { ...a, target_entity_type: e.target.value };
                    setForm({ ...form, associations: assocs });
                  }}
                  className="rounded-lg border px-3 py-1.5 text-sm">
                  {["contact", "company", "deal", "activity", "task"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={a.relationship_type}
                  onChange={(e) => {
                    const assocs = [...form.associations];
                    assocs[i] = { ...a, relationship_type: e.target.value };
                    setForm({ ...form, associations: assocs });
                  }}
                  className="rounded-lg border px-3 py-1.5 text-sm">
                  {["one_to_one", "one_to_many", "many_to_one", "many_to_many"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={() => setForm({ ...form, associations: form.associations.filter((_, j) => j !== i) })}
                  className="text-muted-foreground hover:text-red-500"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button onClick={addAssoc} className="text-sm text-primary hover:underline">+ Add association</button>
          </div>
          <div className="flex gap-2">
            <button onClick={create}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">Create</button>
            <button onClick={() => setShowCreate(false)} className="text-sm text-muted-foreground hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-20 rounded-lg bg-muted animate-pulse" />
      ) : objects.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No custom objects yet.</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {objects.map((o: any) => (
            <div key={o.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{o.objectLabel} ({o.objectLabelPlural})</p>
                <p className="text-xs text-muted-foreground">{o.objectKey} &middot; {o.associations?.length ?? 0} association{(o.associations?.length ?? 0) !== 1 ? "s" : ""}</p>
              </div>
              <button onClick={() => remove(o.id)} className="text-muted-foreground hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Permissions Tab ─────────────────────────────────────────────────────────

function PermissionsTab() {
  const [view, setView] = useState<"fields" | "records" | "defaults">("fields");
  const [entityType, setEntityType] = useState("contact");
  const [perms, setPerms] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const entityTypes = ["contact", "company", "deal", "activity", "task"];
  const roles = ["rep", "manager", "admin", "read_only"];
  const accessLevels = ["read_write", "read_only", "hidden"];

  const loadFields = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/permissions/fields?entityType=${entityType}`);
      const json = res.ok ? await res.json() : { data: [] };
      setPerms(json.data ?? []);
    } catch { setPerms([]); }
    setLoading(false);
  };

  const loadDefaults = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/v1/permissions/defaults");
      const json = res.ok ? await res.json() : { data: [] };
      setDefaults(json.data ?? []);
    } catch { setDefaults([]); }
    setLoading(false);
  };

  useEffect(() => {
    if (view === "fields") loadFields();
    else if (view === "defaults") loadDefaults();
    else setLoading(false);
  }, [view, entityType]);

  const setFieldPerm = async (fieldName: string, role: string, accessLevel: string) => {
    await api.post("/api/v1/permissions/fields", {
      entity_type: entityType,
      field_name: fieldName,
      role,
      access_level: accessLevel,
    });
    loadFields();
  };

  const setDefault = async (entType: string, ownerAccess: string, teamAccess: string, orgAccess: string) => {
    await api.post("/api/v1/permissions/defaults", {
      entity_type: entType,
      owner_access: ownerAccess,
      team_access: teamAccess,
      org_access: orgAccess,
    });
    loadDefaults();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["fields", "records", "defaults"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              view === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
            {v === "fields" ? "Field Permissions" : v === "records" ? "Record ACLs" : "Default Rules"}
          </button>
        ))}
      </div>

      {view === "fields" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {entityTypes.map((t) => (
              <button key={t} onClick={() => setEntityType(t)}
                className={cn("rounded-lg px-2 py-1 text-xs font-medium capitalize transition-colors",
                  entityType === t ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted")}>
                {t}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="h-20 rounded-lg bg-muted animate-pulse" />
          ) : perms.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No field permissions configured. All fields default to read_write.</p>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Field</th>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2 text-left font-medium">Access</th>
                </tr></thead>
                <tbody>
                  {perms.map((p: any) => (
                    <tr key={p.id} className="border-b">
                      <td className="px-4 py-2">{p.fieldName}</td>
                      <td className="px-4 py-2">{p.role}</td>
                      <td className="px-4 py-2">
                        <select value={p.accessLevel}
                          onChange={(e) => setFieldPerm(p.fieldName, p.role, e.target.value)}
                          className="rounded border px-2 py-1 text-xs">
                          {accessLevels.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === "defaults" && (
        <div className="space-y-3">
          {loading ? (
            <div className="h-20 rounded-lg bg-muted animate-pulse" />
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Entity Type</th>
                  <th className="px-4 py-2 text-left font-medium">Owner Access</th>
                  <th className="px-4 py-2 text-left font-medium">Team Access</th>
                  <th className="px-4 py-2 text-left font-medium">Org Access</th>
                </tr></thead>
                <tbody>
                  {entityTypes.map((et) => {
                    const d = defaults.find((d: any) => d.entityType === et);
                    return (
                      <tr key={et} className="border-b">
                        <td className="px-4 py-2 capitalize">{et}</td>
                        {["ownerAccess", "teamAccess", "orgAccess"].map((field) => (
                          <td key={field} className="px-4 py-2">
                            <select value={d?.[field] ?? (field === "ownerAccess" ? "read_write_delete" : field === "teamAccess" ? "read" : "none")}
                              onChange={(e) => setDefault(et,
                                field === "ownerAccess" ? e.target.value : d?.ownerAccess ?? "read_write_delete",
                                field === "teamAccess" ? e.target.value : d?.teamAccess ?? "read",
                                field === "orgAccess" ? e.target.value : d?.orgAccess ?? "none")}
                              className="rounded border px-2 py-1 text-xs">
                              {["read_write_delete", "read_write", "read", "none"].map((l) => <option key={l} value={l}>{l}</option>)}
                            </select>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === "records" && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Record-level ACLs are managed per-record via the "Share" button on individual entity detail pages.
        </p>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function useTabs() {
  const t = useTranslations("settings");
  return [
    { id: "profile" as Tab,          label: t("tabs.profile"),        icon: User     },
    { id: "security" as Tab,         label: t("tabs.security"),       icon: Shield   },
    { id: "general" as Tab,          label: t("tabs.company"),        icon: Building2, adminOnly: true },
    { id: "users" as Tab,            label: t("tabs.users"),          icon: Users,     adminOnly: true },
    { id: "teams" as Tab,            label: t("tabs.teams"),          icon: UsersRound, adminOnly: true },
    { id: "integrations" as Tab,     label: t("tabs.integrations"),   icon: Plug,      adminOnly: true },
    { id: "quoting" as Tab,          label: t("tabs.quoting"),        icon: FileText,  adminOnly: true },
    { id: "products" as Tab,         label: t("tabs.products"),       icon: Package,   adminOnly: true },
    { id: "communications" as Tab,   label: t("tabs.communications"), icon: Phone,     adminOnly: true },
    { id: "billing" as Tab,          label: t("tabs.billing"),        icon: CreditCard, adminOnly: true },
    { id: "custom-fields" as Tab,    label: t("tabs.customFields"),   icon: Columns3,   adminOnly: true },
    { id: "custom-objects" as Tab,   label: t("tabs.customObjects"),  icon: Box,        adminOnly: true },
    { id: "permissions" as Tab,      label: t("tabs.permissions"),    icon: LockKeyhole, adminOnly: true },
  ] satisfies { id: Tab; label: string; icon: React.FC<{ className?: string }>; adminOnly?: boolean }[];
}

const VALID_TAB_IDS: Set<string> = new Set([
  "profile", "security", "general", "users", "integrations", "quoting",
  "products", "communications", "billing", "custom-fields", "custom-objects", "permissions",
]);

function SettingsInner() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab") as Tab | null;
  const initialTab: Tab = rawTab && VALID_TAB_IDS.has(rawTab) ? rawTab : "profile";

  const [tab,  setTab]  = useState<Tab>(initialTab);
  const [user, setUser] = useState<StoredUser | null>(null);
  useEffect(() => { setUser(getStoredUser()); }, []);

  const TABS = useTabs();

  // Sync tab with URL search params so dropdown nav links work without remounting
  useEffect(() => {
    const raw = searchParams.get("tab") as Tab | null;
    if (raw && VALID_TAB_IDS.has(raw)) setTab(raw);
  }, [searchParams]);

  const isAdmin = ["admin", "super_admin", "manager"].includes(user?.role ?? "");
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="flex h-full gap-6">
      <aside className="w-52 shrink-0">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1">Personal</p>
          <nav className="space-y-0.5">
            {visibleTabs.filter((t) => !t.adminOnly).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                  tab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon className="h-4 w-4 shrink-0" />{label}
              </button>
            ))}
          </nav>
        </div>
        {isAdmin && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1 mt-4">Workspace</p>
            <nav className="space-y-0.5">
              {visibleTabs.filter((t) => t.adminOnly).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                    tab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  <Icon className="h-4 w-4 shrink-0" />{label}
                </button>
              ))}
            </nav>
          </div>
        )}
      </aside>

      <div className="flex-1 overflow-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">{TABS.find((t) => t.id === tab)?.label}</h1>
        </div>
        {tab === "profile"      && <ProfileTab user={user} />}
        {tab === "security"     && <SecurityTab />}
        {tab === "general"      && <GeneralTab user={user} />}
        {tab === "users"        && <UsersTab />}
        {tab === "teams"        && <TeamsTab />}
        {tab === "integrations"   && <IntegrationsTab />}
        {tab === "quoting"        && <QuotingTab />}
        {tab === "products"       && <ProductsTab />}
        {tab === "communications" && <CommunicationsTab />}
        {tab === "billing"        && <BillingTab />}
        {tab === "custom-fields"  && <CustomFieldsTab />}
        {tab === "custom-objects" && <CustomObjectsTab />}
        {tab === "permissions"    && <PermissionsTab />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-8 w-48 rounded bg-muted animate-pulse" />}>
      <SettingsInner />
    </Suspense>
  );
}
