"use client";

import { cn } from "@/lib/utils";
import {
  X, Mail, Phone, Building2, Briefcase, Star, ExternalLink,
  User, Clock, Tag,
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
  lastActivity?: string;
  linkedinUrl?: string;
  source: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

function InfluenceBadge({ score }: { score?: number }) {
  if (score == null || score === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const stars = Math.round((score / 100) * 5);
  return (
    <div className="flex items-center gap-0.5" title={"Influence: " + score + "/100"}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("h-4 w-4", i < stars ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30")} />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{score}/100</span>
    </div>
  );
}

function Row({ icon: Icon, label, children }: {
  icon: React.FC<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-2 w-32 shrink-0 text-xs text-muted-foreground pt-0.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}

interface ContactDrawerProps {
  contact: Contact;
  onClose: () => void;
  onEmail: (c: Contact) => void;
  onPhone: (c: Contact) => void;
  onEdit: (c: Contact) => void;
  canWrite: boolean;
}

export function ContactDrawer({ contact, onClose, onEmail, onPhone, onEdit, canWrite }: ContactDrawerProps) {
  const fullName = contact.firstName + " " + contact.lastName;
  const initials = (contact.firstName?.[0] ?? "") + (contact.lastName?.[0] ?? "");
  const sourceLabel = contact.source === "user" ? "Manual" : "Auto-captured";
  const addedDate = new Date(contact.createdAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b px-4">
          <span className="text-sm font-semibold">Contact Details</span>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Identity block */}
          <div className="flex items-start gap-4 p-5 border-b border-border">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xl font-bold">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground">{fullName}</h2>
              {contact.title && <p className="text-sm text-muted-foreground">{contact.title}</p>}
              {contact.company && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Building2 className="h-3.5 w-3.5" />{contact.company.name}
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 p-4 border-b border-border">
            <button
              onClick={() => onEmail(contact)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
            >
              <Mail className="h-4 w-4" /> Email
            </button>
            {contact.phone && (
              <button
                onClick={() => onPhone(contact)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-green-50 hover:text-green-700 hover:border-green-200 transition-colors"
              >
                <Phone className="h-4 w-4" /> Call
              </button>
            )}
            {canWrite && (
              <button
                onClick={() => onEdit(contact)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                Edit
              </button>
            )}
          </div>

          {/* Details */}
          <div className="px-5 py-2">
            <Row icon={Mail} label="Email">
              <a href={"mailto:" + contact.email} className="text-primary hover:underline break-all">
                {contact.email}
              </a>
            </Row>
            {contact.phone && (
              <Row icon={Phone} label="Phone">
                <button onClick={() => onPhone(contact)} className="text-primary hover:underline">
                  {contact.phone}
                </button>
              </Row>
            )}
            {contact.company && (
              <Row icon={Building2} label="Company">
                <span>{contact.company.name}</span>
              </Row>
            )}
            {contact.title && (
              <Row icon={Briefcase} label="Title">
                <span>{contact.title}</span>
              </Row>
            )}
            {contact.seniority && (
              <Row icon={User} label="Seniority">
                <span className="capitalize">{contact.seniority}</span>
              </Row>
            )}
            <Row icon={Star} label="Influence">
              <InfluenceBadge score={contact.influenceScore} />
            </Row>
            {contact.lastActivityAt && (
              <Row icon={Clock} label="Last Activity">
                <span className="text-muted-foreground">
                  {new Date(contact.lastActivityAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </Row>
            )}
            <Row icon={Tag} label="Source">
              <span className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                contact.source === "user" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
              )}>
                {sourceLabel}
              </span>
            </Row>
            <Row icon={Clock} label="Added">
              <span className="text-muted-foreground">{addedDate}</span>
            </Row>
            {contact.updatedAt && (
              <Row icon={Clock} label="Updated">
                <span className="text-muted-foreground">
                  {new Date(contact.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </Row>
            )}
            {contact.createdBy && (
              <Row icon={User} label="Created By">
                <span className="text-muted-foreground">{contact.createdBy}</span>
              </Row>
            )}
            {contact.linkedinUrl && (
              <Row icon={ExternalLink} label="LinkedIn">
                <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline">
                  View profile <ExternalLink className="h-3 w-3" />
                </a>
              </Row>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
