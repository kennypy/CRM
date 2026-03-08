"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import {
  Shield, Database, Server, Globe, Lock, Key,
  Clock, CheckCircle2, AlertCircle, XCircle,
  RefreshCw, Upload, Download, Play, TestTube,
  ChevronRight, Calendar, FileText, Archive,
  HardDrive, Cloud, Settings, Eye, Trash2,
  AlertTriangle, Info, Plus, Search,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────────

type Tab = "soc2" | "escrow" | "mirroring" | "residency" | "encryption" | "retention";

type ControlStatus = "implemented" | "in_progress" | "not_started";

interface SOC2Control {
  id: string;
  category: string;
  name: string;
  description: string;
  status: ControlStatus;
  owner: string;
  lastReviewedAt: string;
  evidence?: string;
}

interface EscrowEntry {
  id: string;
  timestamp: string;
  provider: string;
  sizeBytes: number;
  status: "completed" | "failed" | "in_progress" | "verified";
  verificationHash?: string;
}

interface MirrorDestination {
  id: string;
  provider: "aws_s3" | "azure_blob" | "gcs";
  region: string;
  bucket: string;
  format: "json" | "parquet" | "csv";
  syncFrequency: "realtime" | "hourly" | "daily" | "weekly";
  status: "active" | "paused" | "error";
  lastSyncAt: string;
  objectsSelected: string[];
}

interface SyncHistoryEntry {
  id: string;
  destinationId: string;
  timestamp: string;
  recordsSynced: number;
  duration: string;
  status: "success" | "partial" | "failed";
}

interface Region {
  id: string;
  name: string;
  location: string;
  available: boolean;
  latency: string;
}

interface RetentionPolicy {
  entityType: string;
  retentionDays: number;
  archiveAfterDays: number;
  deleteAfterDays: number;
  legalHold: boolean;
}

// ── Demo Data ───────────────────────────────────────────────────────────────────

const SOC2_CATEGORIES = [
  "Access Control",
  "Change Management",
  "Risk Assessment",
  "Monitoring",
  "Incident Response",
  "Vendor Management",
  "Data Protection",
  "Business Continuity",
];

const DEMO_CONTROLS: SOC2Control[] = [
  { id: "ac-1", category: "Access Control", name: "Multi-Factor Authentication", description: "MFA enforced for all user accounts", status: "implemented", owner: "Sarah Kim", lastReviewedAt: "2026-02-15", evidence: "MFA policy doc v3.2" },
  { id: "ac-2", category: "Access Control", name: "Role-Based Access Control", description: "RBAC implemented across all modules", status: "implemented", owner: "Sarah Kim", lastReviewedAt: "2026-02-15", evidence: "RBAC matrix v2.1" },
  { id: "ac-3", category: "Access Control", name: "Session Management", description: "Auto-logout after 30 min inactivity", status: "implemented", owner: "Marcus Chen", lastReviewedAt: "2026-01-20" },
  { id: "cm-1", category: "Change Management", name: "Change Advisory Board", description: "All production changes reviewed by CAB", status: "implemented", owner: "Marcus Chen", lastReviewedAt: "2026-02-01", evidence: "CAB meeting minutes" },
  { id: "cm-2", category: "Change Management", name: "Automated CI/CD Pipeline", description: "All deployments go through automated pipeline with tests", status: "implemented", owner: "DevOps Team", lastReviewedAt: "2026-02-10" },
  { id: "cm-3", category: "Change Management", name: "Rollback Procedures", description: "Documented rollback for every deployment", status: "in_progress", owner: "DevOps Team", lastReviewedAt: "2026-01-28" },
  { id: "ra-1", category: "Risk Assessment", name: "Annual Risk Assessment", description: "Comprehensive risk assessment conducted annually", status: "implemented", owner: "Priya Sharma", lastReviewedAt: "2026-01-05", evidence: "Risk register 2026" },
  { id: "ra-2", category: "Risk Assessment", name: "Threat Modeling", description: "Threat models for all new features", status: "in_progress", owner: "Priya Sharma", lastReviewedAt: "2025-12-15" },
  { id: "mo-1", category: "Monitoring", name: "SIEM Integration", description: "Centralized security event monitoring", status: "implemented", owner: "Marcus Chen", lastReviewedAt: "2026-02-20", evidence: "SIEM dashboard" },
  { id: "mo-2", category: "Monitoring", name: "Anomaly Detection", description: "ML-based anomaly detection on access patterns", status: "in_progress", owner: "Marcus Chen", lastReviewedAt: "2026-01-30" },
  { id: "mo-3", category: "Monitoring", name: "Uptime Monitoring", description: "99.9% uptime SLA with automated alerting", status: "implemented", owner: "DevOps Team", lastReviewedAt: "2026-02-18" },
  { id: "ir-1", category: "Incident Response", name: "Incident Response Plan", description: "Documented IRP with defined escalation paths", status: "implemented", owner: "Sarah Kim", lastReviewedAt: "2026-02-05", evidence: "IRP v4.0" },
  { id: "ir-2", category: "Incident Response", name: "Tabletop Exercises", description: "Quarterly incident response drills", status: "implemented", owner: "Sarah Kim", lastReviewedAt: "2026-01-15" },
  { id: "ir-3", category: "Incident Response", name: "Post-Incident Reviews", description: "Blameless post-mortems after every incident", status: "implemented", owner: "Marcus Chen", lastReviewedAt: "2026-02-12" },
  { id: "vm-1", category: "Vendor Management", name: "Vendor Risk Assessment", description: "All vendors assessed before onboarding", status: "implemented", owner: "Priya Sharma", lastReviewedAt: "2026-01-20", evidence: "Vendor registry" },
  { id: "vm-2", category: "Vendor Management", name: "Vendor SLA Monitoring", description: "Continuous monitoring of vendor SLAs", status: "not_started", owner: "Priya Sharma", lastReviewedAt: "2025-11-10" },
  { id: "dp-1", category: "Data Protection", name: "Encryption at Rest", description: "AES-256 encryption for all stored data", status: "implemented", owner: "DevOps Team", lastReviewedAt: "2026-02-01", evidence: "Encryption policy" },
  { id: "dp-2", category: "Data Protection", name: "Data Classification", description: "All data classified by sensitivity level", status: "in_progress", owner: "Priya Sharma", lastReviewedAt: "2026-01-25" },
  { id: "dp-3", category: "Data Protection", name: "DLP Controls", description: "Data loss prevention rules active", status: "not_started", owner: "Marcus Chen", lastReviewedAt: "2025-12-01" },
  { id: "bc-1", category: "Business Continuity", name: "Disaster Recovery Plan", description: "Documented DR plan with RTO/RPO targets", status: "implemented", owner: "Sarah Kim", lastReviewedAt: "2026-02-08", evidence: "DR plan v2.3" },
  { id: "bc-2", category: "Business Continuity", name: "Backup Verification", description: "Weekly backup restoration tests", status: "implemented", owner: "DevOps Team", lastReviewedAt: "2026-02-22" },
  { id: "bc-3", category: "Business Continuity", name: "Geographic Redundancy", description: "Multi-region deployment for failover", status: "in_progress", owner: "DevOps Team", lastReviewedAt: "2026-01-30" },
];

const DEMO_ESCROW_HISTORY: EscrowEntry[] = [
  { id: "e-1", timestamp: "2026-03-07T02:00:00Z", provider: "Iron Mountain", sizeBytes: 4_832_000_000, status: "verified", verificationHash: "sha256:a3f2c8..." },
  { id: "e-2", timestamp: "2026-03-06T02:00:00Z", provider: "Iron Mountain", sizeBytes: 4_815_000_000, status: "completed", verificationHash: "sha256:b1d4e7..." },
  { id: "e-3", timestamp: "2026-03-05T02:00:00Z", provider: "Iron Mountain", sizeBytes: 4_798_000_000, status: "verified", verificationHash: "sha256:c9f1a2..." },
  { id: "e-4", timestamp: "2026-03-04T02:00:00Z", provider: "Iron Mountain", sizeBytes: 4_780_000_000, status: "verified", verificationHash: "sha256:d2e5b8..." },
  { id: "e-5", timestamp: "2026-03-03T02:00:00Z", provider: "Iron Mountain", sizeBytes: 4_761_000_000, status: "failed" },
  { id: "e-6", timestamp: "2026-03-02T02:00:00Z", provider: "Iron Mountain", sizeBytes: 4_745_000_000, status: "verified", verificationHash: "sha256:f7a3c1..." },
];

const DEMO_MIRROR_DESTINATIONS: MirrorDestination[] = [
  {
    id: "m-1", provider: "aws_s3", region: "us-east-1", bucket: "acme-crm-mirror-prod",
    format: "parquet", syncFrequency: "hourly", status: "active", lastSyncAt: "2026-03-08T01:00:00Z",
    objectsSelected: ["contacts", "companies", "deals", "activities", "emails"],
  },
  {
    id: "m-2", provider: "azure_blob", region: "westeurope", bucket: "acme-crm-eu-backup",
    format: "json", syncFrequency: "daily", status: "active", lastSyncAt: "2026-03-08T00:00:00Z",
    objectsSelected: ["contacts", "companies", "deals"],
  },
];

const DEMO_SYNC_HISTORY: SyncHistoryEntry[] = [
  { id: "sh-1", destinationId: "m-1", timestamp: "2026-03-08T01:00:00Z", recordsSynced: 142_580, duration: "4m 32s", status: "success" },
  { id: "sh-2", destinationId: "m-1", timestamp: "2026-03-08T00:00:00Z", recordsSynced: 142_410, duration: "4m 28s", status: "success" },
  { id: "sh-3", destinationId: "m-2", timestamp: "2026-03-08T00:00:00Z", recordsSynced: 98_320, duration: "6m 15s", status: "success" },
  { id: "sh-4", destinationId: "m-1", timestamp: "2026-03-07T23:00:00Z", recordsSynced: 142_390, duration: "4m 25s", status: "success" },
  { id: "sh-5", destinationId: "m-1", timestamp: "2026-03-07T22:00:00Z", recordsSynced: 0, duration: "0m 12s", status: "failed" },
  { id: "sh-6", destinationId: "m-2", timestamp: "2026-03-07T00:00:00Z", recordsSynced: 98_150, duration: "6m 08s", status: "partial" },
];

const AVAILABLE_REGIONS: Region[] = [
  { id: "us-east", name: "US East", location: "Virginia, USA", available: true, latency: "12ms" },
  { id: "us-west", name: "US West", location: "Oregon, USA", available: true, latency: "45ms" },
  { id: "eu-west", name: "EU West", location: "Ireland", available: true, latency: "89ms" },
  { id: "eu-central", name: "EU Central", location: "Frankfurt, Germany", available: true, latency: "95ms" },
  { id: "ap-southeast", name: "AP Southeast", location: "Singapore", available: true, latency: "180ms" },
  { id: "ap-northeast", name: "AP Northeast", location: "Tokyo, Japan", available: false, latency: "195ms" },
];

const DEMO_RETENTION_POLICIES: RetentionPolicy[] = [
  { entityType: "Contacts", retentionDays: 2555, archiveAfterDays: 1825, deleteAfterDays: 2555, legalHold: false },
  { entityType: "Companies", retentionDays: 2555, archiveAfterDays: 1825, deleteAfterDays: 2555, legalHold: false },
  { entityType: "Deals", retentionDays: 3650, archiveAfterDays: 2555, deleteAfterDays: 3650, legalHold: true },
  { entityType: "Emails", retentionDays: 1825, archiveAfterDays: 730, deleteAfterDays: 1825, legalHold: false },
  { entityType: "Activities", retentionDays: 1095, archiveAfterDays: 730, deleteAfterDays: 1095, legalHold: false },
  { entityType: "Audit Logs", retentionDays: 2555, archiveAfterDays: 1825, deleteAfterDays: 2555, legalHold: true },
  { entityType: "Attachments", retentionDays: 1825, archiveAfterDays: 365, deleteAfterDays: 1825, legalHold: false },
  { entityType: "Notes", retentionDays: 1825, archiveAfterDays: 730, deleteAfterDays: 1825, legalHold: false },
];

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(1)} KB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function daysToYears(days: number): string {
  const y = Math.floor(days / 365);
  const d = days % 365;
  if (y === 0) return `${d}d`;
  if (d === 0) return `${y}y`;
  return `${y}y ${d}d`;
}

// ── Status Badges ───────────────────────────────────────────────────────────────

function ControlStatusBadge({ status }: { status: ControlStatus }) {
  const config = {
    implemented: { label: "Implemented", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
    in_progress: { label: "In Progress", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: Clock },
    not_started: { label: "Not Started", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", icon: XCircle },
  }[status];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", config.className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function SyncStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    paused: { label: "Paused", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
    error: { label: "Error", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    success: { label: "Success", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    partial: { label: "Partial", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
    failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    completed: { label: "Completed", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    verified: { label: "Verified", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    in_progress: { label: "In Progress", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}

// ── Tab Components ──────────────────────────────────────────────────────────────

function SOC2Tab() {
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filtered = DEMO_CONTROLS.filter((c) => {
    if (filterCategory !== "all" && c.category !== filterCategory) return false;
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    return true;
  });

  const implemented = DEMO_CONTROLS.filter((c) => c.status === "implemented").length;
  const inProgress = DEMO_CONTROLS.filter((c) => c.status === "in_progress").length;
  const notStarted = DEMO_CONTROLS.filter((c) => c.status === "not_started").length;
  const complianceScore = Math.round((implemented / DEMO_CONTROLS.length) * 100);

  return (
    <div className="space-y-6">
      {/* Score Overview */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Compliance Score</p>
            <Shield className="h-5 w-5 text-green-500" />
          </div>
          <p className="mt-2 text-3xl font-bold">{complianceScore}%</p>
          <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${complianceScore}%` }} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Implemented</p>
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          </div>
          <p className="mt-2 text-3xl font-bold text-green-600">{implemented}</p>
          <p className="mt-1 text-xs text-muted-foreground">of {DEMO_CONTROLS.length} controls</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">In Progress</p>
            <Clock className="h-5 w-5 text-yellow-500" />
          </div>
          <p className="mt-2 text-3xl font-bold text-yellow-600">{inProgress}</p>
          <p className="mt-1 text-xs text-muted-foreground">controls being worked on</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Not Started</p>
            <XCircle className="h-5 w-5 text-gray-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-gray-500">{notStarted}</p>
          <p className="mt-1 text-xs text-muted-foreground">controls pending</p>
        </div>
      </div>

      {/* Next Audit */}
      <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
        <Calendar className="h-5 w-5 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Next SOC2 Audit Scheduled</p>
          <p className="text-sm text-blue-600 dark:text-blue-400">June 15, 2026 - Auditor: Deloitte LLP</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="all">All Categories</option>
          {SOC2_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="implemented">Implemented</option>
          <option value="in_progress">In Progress</option>
          <option value="not_started">Not Started</option>
        </select>
        <span className="text-sm text-muted-foreground">{filtered.length} controls</span>
      </div>

      {/* Controls Table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Control</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Owner</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Reviewed</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((control) => (
              <tr key={control.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium">{control.name}</p>
                    <p className="text-xs text-muted-foreground">{control.description}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-medium text-muted-foreground">{control.category}</span>
                </td>
                <td className="px-4 py-3">
                  <ControlStatusBadge status={control.status} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{control.owner}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(control.lastReviewedAt)}</td>
                <td className="px-4 py-3">
                  {control.evidence ? (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                      <FileText className="h-3 w-3" />
                      {control.evidence}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">--</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EscrowTab() {
  const [provider, setProvider] = useState("Iron Mountain");
  const [schedule, setSchedule] = useState<"daily" | "weekly" | "monthly">("daily");
  const [triggeringEscrow, setTriggeringEscrow] = useState(false);
  const [escrowHistory, setEscrowHistory] = useState(DEMO_ESCROW_HISTORY);

  const handleTriggerEscrow = () => {
    setTriggeringEscrow(true);
    setTimeout(() => {
      const newEntry: EscrowEntry = {
        id: `e-manual-${Date.now()}`,
        timestamp: new Date().toISOString(),
        provider,
        sizeBytes: 4_840_000_000,
        status: "in_progress",
      };
      setEscrowHistory([newEntry, ...escrowHistory]);
      setTriggeringEscrow(false);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      {/* Provider Configuration */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold flex items-center gap-2">
          <Archive className="h-5 w-5" />
          Escrow Provider Configuration
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="Iron Mountain">Iron Mountain</option>
              <option value="EscrowTech">EscrowTech International</option>
              <option value="NCC Group">NCC Group</option>
              <option value="Custom">Custom Provider</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Schedule</label>
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as "daily" | "weekly" | "monthly")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Verification</label>
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm dark:border-green-800 dark:bg-green-950/30">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-green-700 dark:text-green-400">SHA-256 hash verification enabled</span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={handleTriggerEscrow}
            disabled={triggeringEscrow}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
              triggeringEscrow
                ? "cursor-not-allowed bg-gray-400"
                : "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {triggeringEscrow ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {triggeringEscrow ? "Running Escrow..." : "Trigger Manual Escrow"}
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
            <Settings className="h-4 w-4" />
            Advanced Settings
          </button>
        </div>
      </div>

      {/* Escrow History */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Escrow History
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Provider</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Size</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Verification Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {escrowHistory.map((entry) => (
                <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-3 text-muted-foreground">{formatDateTime(entry.timestamp)}</td>
                  <td className="px-6 py-3">{entry.provider}</td>
                  <td className="px-6 py-3 text-muted-foreground">{formatBytes(entry.sizeBytes)}</td>
                  <td className="px-6 py-3"><SyncStatusBadge status={entry.status} /></td>
                  <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                    {entry.verificationHash ?? "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MirroringTab() {
  const [destinations, setDestinations] = useState(DEMO_MIRROR_DESTINATIONS);
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [newDest, setNewDest] = useState<{
    provider: "aws_s3" | "azure_blob" | "gcs";
    region: string;
    bucket: string;
    format: "json" | "parquet" | "csv";
    syncFrequency: "realtime" | "hourly" | "daily" | "weekly";
    objectsSelected: string[];
  }>({
    provider: "aws_s3",
    region: "us-east-1",
    bucket: "",
    format: "parquet",
    syncFrequency: "daily",
    objectsSelected: [],
  });

  const availableObjects = ["contacts", "companies", "deals", "activities", "emails", "tasks", "notes", "attachments"];

  const providerLabels: Record<string, string> = {
    aws_s3: "AWS S3",
    azure_blob: "Azure Blob Storage",
    gcs: "Google Cloud Storage",
  };

  const regionOptions: Record<string, string[]> = {
    aws_s3: ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1", "ap-northeast-1"],
    azure_blob: ["eastus", "westus2", "westeurope", "northeurope", "southeastasia"],
    gcs: ["us-central1", "us-east1", "europe-west1", "asia-east1", "australia-southeast1"],
  };

  const handleTestConnection = (destId: string) => {
    setTestingConnection(destId);
    setTimeout(() => setTestingConnection(null), 2500);
  };

  const handleToggleObject = (obj: string) => {
    setNewDest((prev) => ({
      ...prev,
      objectsSelected: prev.objectsSelected.includes(obj)
        ? prev.objectsSelected.filter((o) => o !== obj)
        : [...prev.objectsSelected, obj],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Existing Destinations */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Mirror Destinations</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Destination
        </button>
      </div>

      {/* Add Destination Form */}
      {showAddForm && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-6 dark:border-blue-800 dark:bg-blue-950/20">
          <h4 className="mb-4 font-semibold">New Mirror Destination</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Provider</label>
              <select
                value={newDest.provider}
                onChange={(e) => setNewDest({ ...newDest, provider: e.target.value as "aws_s3" | "azure_blob" | "gcs", region: regionOptions[e.target.value]?.[0] ?? "" })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="aws_s3">AWS S3</option>
                <option value="azure_blob">Azure Blob Storage</option>
                <option value="gcs">Google Cloud Storage</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Region</label>
              <select
                value={newDest.region}
                onChange={(e) => setNewDest({ ...newDest, region: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {regionOptions[newDest.provider]?.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Bucket / Container</label>
              <input
                type="text"
                value={newDest.bucket}
                onChange={(e) => setNewDest({ ...newDest, bucket: e.target.value })}
                placeholder="my-crm-backup"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Format</label>
              <select
                value={newDest.format}
                onChange={(e) => setNewDest({ ...newDest, format: e.target.value as "json" | "parquet" | "csv" })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="json">JSON</option>
                <option value="parquet">Parquet</option>
                <option value="csv">CSV</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Sync Frequency</label>
              <select
                value={newDest.syncFrequency}
                onChange={(e) => setNewDest({ ...newDest, syncFrequency: e.target.value as "realtime" | "hourly" | "daily" | "weekly" })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="realtime">Real-time</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium">Objects to Mirror</label>
            <div className="flex flex-wrap gap-2">
              {availableObjects.map((obj) => (
                <label key={obj} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm cursor-pointer hover:bg-muted transition-colors">
                  <input
                    type="checkbox"
                    checked={newDest.objectsSelected.includes(obj)}
                    onChange={() => handleToggleObject(obj)}
                    className="rounded"
                  />
                  {obj.charAt(0).toUpperCase() + obj.slice(1)}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
              Save Destination
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Destination Cards */}
      {destinations.map((dest) => (
        <div key={dest.id} className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-semibold">{providerLabels[dest.provider]}</h4>
                <p className="text-sm text-muted-foreground">{dest.bucket} ({dest.region})</p>
              </div>
            </div>
            <SyncStatusBadge status={dest.status} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Format</p>
              <p className="text-sm font-medium uppercase">{dest.format}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sync Frequency</p>
              <p className="text-sm font-medium capitalize">{dest.syncFrequency}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last Sync</p>
              <p className="text-sm font-medium">{formatDateTime(dest.lastSyncAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Objects</p>
              <p className="text-sm font-medium">{dest.objectsSelected.length} selected</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {dest.objectsSelected.map((obj) => (
              <span key={obj} className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{obj}</span>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => handleTestConnection(dest.id)}
              disabled={testingConnection === dest.id}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              {testingConnection === dest.id ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <TestTube className="h-3.5 w-3.5" />
              )}
              {testingConnection === dest.id ? "Testing..." : "Test Connection"}
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
              Sync Now
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              <Settings className="h-3.5 w-3.5" />
              Configure
            </button>
          </div>
        </div>
      ))}

      {/* Sync History */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Sync History
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Destination</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Records</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Duration</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {DEMO_SYNC_HISTORY.map((entry) => {
                const dest = destinations.find((d) => d.id === entry.destinationId);
                return (
                  <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3 text-muted-foreground">{formatDateTime(entry.timestamp)}</td>
                    <td className="px-6 py-3">{dest ? `${providerLabels[dest.provider]} (${dest.bucket})` : entry.destinationId}</td>
                    <td className="px-6 py-3 text-muted-foreground">{entry.recordsSynced.toLocaleString()}</td>
                    <td className="px-6 py-3 text-muted-foreground">{entry.duration}</td>
                    <td className="px-6 py-3"><SyncStatusBadge status={entry.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ResidencyTab() {
  const [currentRegion] = useState("us-east");
  const [selectedMigrationTarget, setSelectedMigrationTarget] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Current Region */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Current Data Residency
        </h3>
        <div className="flex items-center gap-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
            <Globe className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-green-800 dark:text-green-300">US East (Virginia, USA)</p>
            <p className="text-sm text-green-600 dark:text-green-400">Primary data center - All data stored in this region</p>
          </div>
        </div>
      </div>

      {/* Available Regions */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">Available Regions</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {AVAILABLE_REGIONS.map((region) => (
            <div
              key={region.id}
              className={cn(
                "rounded-lg border p-4 transition-colors",
                region.id === currentRegion
                  ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/20"
                  : region.available
                  ? "border-border hover:border-blue-300 cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/10"
                  : "border-border opacity-50"
              )}
              onClick={() => region.available && region.id !== currentRegion && setSelectedMigrationTarget(region.id)}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{region.name}</p>
                {region.id === currentRegion && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/50 dark:text-green-400">
                    Current
                  </span>
                )}
                {!region.available && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    Coming Soon
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{region.location}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Latency: {region.latency}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Migration Tool */}
      {selectedMigrationTarget && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-6 dark:border-yellow-800 dark:bg-yellow-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-600" />
            <div>
              <h4 className="font-semibold text-yellow-800 dark:text-yellow-300">Region Migration</h4>
              <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">
                You are about to migrate all data to{" "}
                <strong>{AVAILABLE_REGIONS.find((r) => r.id === selectedMigrationTarget)?.name}</strong>.
                This operation may take several hours and will result in brief read-only downtime.
              </p>
              <div className="mt-4 flex gap-3">
                <button className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 transition-colors">
                  Start Migration
                </button>
                <button
                  onClick={() => setSelectedMigrationTarget(null)}
                  className="rounded-lg border border-yellow-300 px-4 py-2 text-sm font-medium text-yellow-700 hover:bg-yellow-100 transition-colors dark:border-yellow-700 dark:text-yellow-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EncryptionTab() {
  const [byokKey, setByokKey] = useState("");

  return (
    <div className="space-y-6">
      {/* At Rest / In Transit Status */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
              <HardDrive className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h4 className="font-semibold">Encryption at Rest</h4>
              <p className="text-sm text-muted-foreground">All stored data</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                <CheckCircle2 className="h-4 w-4" /> Enabled
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Algorithm</span>
              <span className="text-sm font-medium">AES-256-GCM</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Key Management</span>
              <span className="text-sm font-medium">AWS KMS</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
              <Lock className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h4 className="font-semibold">Encryption in Transit</h4>
              <p className="text-sm text-muted-foreground">All network traffic</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                <CheckCircle2 className="h-4 w-4" /> Enabled
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Protocol</span>
              <span className="text-sm font-medium">TLS 1.3</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Certificate</span>
              <span className="text-sm font-medium">Let&apos;s Encrypt (auto-renewed)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Rotation */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Key Rotation Schedule
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Rotated</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Next Rotation</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Frequency</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">Primary Data Key</td>
                <td className="px-4 py-3 text-muted-foreground">Jan 1, 2025</td>
                <td className="px-4 py-3 text-muted-foreground">Feb 1, 2026</td>
                <td className="px-4 py-3 text-muted-foreground">Mar 1, 2026</td>
                <td className="px-4 py-3 text-muted-foreground">Monthly</td>
                <td className="px-4 py-3"><SyncStatusBadge status="active" /></td>
              </tr>
              <tr className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">Backup Encryption Key</td>
                <td className="px-4 py-3 text-muted-foreground">Jun 15, 2025</td>
                <td className="px-4 py-3 text-muted-foreground">Dec 15, 2025</td>
                <td className="px-4 py-3 text-muted-foreground">Jun 15, 2026</td>
                <td className="px-4 py-3 text-muted-foreground">Annually</td>
                <td className="px-4 py-3"><SyncStatusBadge status="active" /></td>
              </tr>
              <tr className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">API Token Signing Key</td>
                <td className="px-4 py-3 text-muted-foreground">Mar 1, 2025</td>
                <td className="px-4 py-3 text-muted-foreground">Jan 1, 2026</td>
                <td className="px-4 py-3 text-muted-foreground">Apr 1, 2026</td>
                <td className="px-4 py-3 text-muted-foreground">Quarterly</td>
                <td className="px-4 py-3"><SyncStatusBadge status="active" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* BYOK */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-2 text-lg font-semibold flex items-center gap-2">
          <Key className="h-5 w-5" />
          Bring Your Own Key (BYOK)
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Use your own encryption key managed through your cloud provider&apos;s KMS. This gives you full control over data encryption.
        </p>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">KMS Provider</label>
            <select className="w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option>AWS KMS</option>
              <option>Azure Key Vault</option>
              <option>Google Cloud KMS</option>
              <option>HashiCorp Vault</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Key ARN / URI</label>
            <input
              type="text"
              value={byokKey}
              onChange={(e) => setByokKey(e.target.value)}
              placeholder="arn:aws:kms:us-east-1:123456789:key/mrk-xxxxxxxxxxxx"
              className="w-full max-w-lg rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/20">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <p className="text-sm text-yellow-700 dark:text-yellow-400">
              Enabling BYOK will re-encrypt all data. This process may take up to 2 hours.
            </p>
          </div>
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            Enable BYOK
          </button>
        </div>
      </div>
    </div>
  );
}

function RetentionTab() {
  const [policies, setPolicies] = useState(DEMO_RETENTION_POLICIES);
  const [legalHolds, setLegalHolds] = useState([
    { id: "lh-1", name: "SEC Investigation 2026-Q1", entityTypes: ["Deals", "Emails"], createdAt: "2026-01-15", expiresAt: "2026-07-15", status: "active" as const },
    { id: "lh-2", name: "Contract Dispute - Acme Corp", entityTypes: ["Contacts", "Emails", "Attachments"], createdAt: "2025-11-01", expiresAt: "2026-05-01", status: "active" as const },
  ]);

  return (
    <div className="space-y-6">
      {/* Retention Policies Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Retention Policies
          </h3>
          <button className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
            <Settings className="h-3.5 w-3.5" />
            Edit Policies
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Entity Type</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Retention Period</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Archive After</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Delete After</th>
                <th className="px-6 py-3 text-left font-medium text-muted-foreground">Legal Hold</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policies.map((policy) => (
                <tr key={policy.entityType} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-3 font-medium">{policy.entityType}</td>
                  <td className="px-6 py-3 text-muted-foreground">{daysToYears(policy.retentionDays)}</td>
                  <td className="px-6 py-3 text-muted-foreground">{daysToYears(policy.archiveAfterDays)}</td>
                  <td className="px-6 py-3 text-muted-foreground">{daysToYears(policy.deleteAfterDays)}</td>
                  <td className="px-6 py-3">
                    {policy.legalHold ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        <Lock className="h-3 w-3" />
                        Active
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legal Holds */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Legal Holds
          </h3>
          <button className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            Create Legal Hold
          </button>
        </div>
        <div className="divide-y divide-border">
          {legalHolds.map((hold) => (
            <div key={hold.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-medium">{hold.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Applies to: {hold.entityTypes.join(", ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Created: {formatDate(hold.createdAt)} | Expires: {formatDate(hold.expiresAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <Lock className="h-3 w-3" />
                  {hold.status === "active" ? "Active" : "Released"}
                </span>
                <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                  Release
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
        <Info className="mt-0.5 h-5 w-5 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">About Retention Policies</p>
          <p className="mt-1 text-sm text-blue-600 dark:text-blue-400">
            Retention policies define how long data is kept before archiving or deletion. Legal holds override retention policies
            and prevent any data from being archived or deleted while active. Changes to retention policies are logged in the audit trail.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: "soc2", label: "SOC2 Compliance", icon: Shield },
  { id: "escrow", label: "Data Escrow", icon: Archive },
  { id: "mirroring", label: "Data Mirroring", icon: Server },
  { id: "residency", label: "Data Residency", icon: Globe },
  { id: "encryption", label: "Encryption", icon: Lock },
  { id: "retention", label: "Retention", icon: Clock },
];

export default function CompliancePage() {
  const [activeTab, setActiveTab] = useState<Tab>("soc2");
  const { isAdmin } = usePermissions();

  if (!isAdmin) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">Access Denied</h2>
          <p className="mt-2 text-muted-foreground">
            You need administrator privileges to access Compliance & Data Management.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Compliance & Data Management</h1>
        <p className="mt-1 text-muted-foreground">
          Manage SOC2 compliance, data escrow, mirroring, residency, encryption, and retention policies.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-1 overflow-x-auto" aria-label="Compliance tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === id
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-muted-foreground hover:border-gray-300 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "soc2" && <SOC2Tab />}
        {activeTab === "escrow" && <EscrowTab />}
        {activeTab === "mirroring" && <MirroringTab />}
        {activeTab === "residency" && <ResidencyTab />}
        {activeTab === "encryption" && <EncryptionTab />}
        {activeTab === "retention" && <RetentionTab />}
      </div>
    </div>
  );
}
