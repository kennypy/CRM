"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { AddContactModal }  from "@/components/modals/add-contact-modal";
import { ActionBar } from "@/components/action-bar/action-bar";
import { EditContactModal } from "@/components/modals/edit-contact-modal";
import { EmailDrawer }      from "@/components/email/EmailDrawer";
import { PhoneDrawer }      from "@/components/phone/PhoneDrawer";
import { ColumnPicker, useColumnPrefs } from "@/components/ui/column-picker";
import type { ColDef } from "@/components/ui/column-picker";
import { ContactDrawer } from "@/components/contacts/ContactDrawer";
import {
  Users, Search, Plus, RefreshCw, AlertCircle,
  Building2, Mail, Phone, ChevronLeft, ChevronRight, ExternalLink, Star, Pencil, Trash2,
} from "lucide-react";

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  phone?: string;
  seniority?: string;
  company?: { id: string; name: string };
  influenceScore?: number;
  lastActivityAt?: string;
  linkedinUrl?: string;
  source: string;
  createdAt: string;
}

function InfluenceBadge({ score }: { score?: number }) {
  if (score == null || score === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const stars = Math.round((score / 100) * 5);
  return (
    <div className="flex items-center gap-0.5" title={`Influence: ${score}/100`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("h-3 w-3", i < stars ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30")} />
      ))}
    </div>
  );
}

function SourcePill({ source }: { source: string }) {
  const isAuto = source !== "user";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
      isAuto ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700")}>
      {isAuto ? "Auto" : "Manual"}
    </span>
  );
}

const COL_DEFS: ColDef[] = [
  { key: "name",         label: "Name",          required: true },
  { key: "company",      label: "Company" },
  { key: "title",        label: "Title" },
  { key: "lastActivity", label: "Last Activity" },
  { key: "influence",    label: "Influence" },
  { key: "source",       label: "Source" },
  { key: "actions",      label: "Actions",       required: true },
];

const PAGE_SIZE = 50;

export default function ContactsPage() {
  const perms = usePermissions();
  const { visible, toggle } = useColumnPrefs("nexcrm_cols_contacts", COL_DEFS);

  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [editing, setEditing]     = useState<Contact | null>(null);
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const [emailContact, setEmailContact] = useState<Contact | null>(null);
  const [phoneContact, setPhoneContact] = useState<Contact | null>(null);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(value); setPage(1); }, 300);
  };

  const handleDeleteContact = async (id: string) => {
    if (!window.confirm("Delete this contact? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await api.delete(`/api/v1/contacts/${id}`);
      if (res.ok || res.status === 404) fetchContacts();
    } catch {}
    setDeletingId(null);
  };

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await api.get(`/api/v1/contacts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setContacts(json.data ?? []);
      setTotal(json.pagination?.total ?? json.data?.length ?? 0);
    } catch (e: any) {
      setError(e.message ?? "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleCols = COL_DEFS.filter((d) => visible.has(d.key));

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Contacts</h1>
          <ActionBar context="contacts" />
          {!loading && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {total.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <ColumnPicker defs={COL_DEFS} visible={visible} toggle={toggle} />
          <button onClick={fetchContacts} disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          {perms.canWrite && (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> Add Contact
            </button>
          )}
        </div>
      </div>

      {showAdd && <AddContactModal onClose={() => setShowAdd(false)} onCreated={() => fetchContacts()} />}
      {editing && (
        <EditContactModal
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchContacts(); }}
        />
      )}
      {detailContact && (
        <ContactDrawer
          contact={detailContact}
          canWrite={perms.canWrite}
          onClose={() => setDetailContact(null)}
          onEmail={(c) => { setDetailContact(null); setEmailContact(c); }}
          onPhone={(c) => { setDetailContact(null); setPhoneContact(c); }}
          onEdit={(c) => { setDetailContact(null); setEditing(c); }}
        />
      )}
      {emailContact && (
        <EmailDrawer
          contactId={emailContact.id}
          contactEmail={emailContact.email}
          contactName={`${emailContact.firstName} ${emailContact.lastName}`}
          onClose={() => setEmailContact(null)}
        />
      )}
      {phoneContact && (
        <PhoneDrawer
          contactId={phoneContact.id}
          contactEmail={phoneContact.email}
          contactName={`${phoneContact.firstName} ${phoneContact.lastName}`}
          contactPhone={phoneContact.phone}
          onClose={() => setPhoneContact(null)}
        />
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder="Search by name, email, or company…" value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              {visibleCols.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {col.key === "actions" ? "" : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {visibleCols.map((col) => (
                    <td key={col.key} className="px-4 py-3"><div className="h-4 w-3/4 rounded bg-muted" /></td>
                  ))}
                </tr>
              ))
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length} className="px-4 py-12 text-center text-muted-foreground">
                  {debouncedSearch ? "No contacts match your search" : "No contacts yet"}
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id} className="transition-colors hover:bg-muted/40">
                  {/* Name — always visible */}
                  {visible.has("name") && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDetailContact(contact)}
                        className="font-medium text-foreground hover:text-primary hover:underline text-left"
                      >
                        {contact.firstName} {contact.lastName}
                      </button>
                      {/* Email — clickable → EmailDrawer */}
                      <button
                        onClick={() => setEmailContact(contact)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-blue-600 transition-colors"
                      >
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </button>
                      {/* Phone — clickable → PhoneDrawer */}
                      {contact.phone && (
                        <button
                          onClick={() => setPhoneContact(contact)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-green-600 transition-colors"
                        >
                          <Phone className="h-3 w-3" />
                          {contact.phone}
                        </button>
                      )}
                    </td>
                  )}
                  {visible.has("company") && (
                    <td className="px-4 py-3">
                      {contact.company ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-foreground">{contact.company.name}</span>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {visible.has("title") && (
                    <td className="px-4 py-3 text-muted-foreground">{contact.title ?? "—"}</td>
                  )}
                  {visible.has("lastActivity") && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {contact.lastActivityAt ? formatRelativeTime(contact.lastActivityAt) : "Never"}
                    </td>
                  )}
                  {visible.has("influence") && (
                    <td className="px-4 py-3"><InfluenceBadge score={contact.influenceScore} /></td>
                  )}
                  {visible.has("source") && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <SourcePill source={contact.source} />
                        {contact.linkedinUrl && (
                          <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  )}
                  {/* Actions — always visible */}
                  {visible.has("actions") && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEmailContact(contact)}
                          className="rounded p-1 text-muted-foreground hover:bg-blue-50 hover:text-blue-600"
                          title="Email"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        {contact.phone && (
                          <button
                            onClick={() => setPhoneContact(contact)}
                            className="rounded p-1 text-muted-foreground hover:bg-green-50 hover:text-green-600"
                            title="Call"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {perms.canWrite && (
                          <button onClick={() => setEditing(contact)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {perms.canManageUsers && (
                          <button
                            onClick={() => handleDeleteContact(contact.id)}
                            disabled={deletingId === contact.id}
                            className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                            title="Delete contact">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">Page {page} of {totalPages} ({total.toLocaleString()} total)</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
