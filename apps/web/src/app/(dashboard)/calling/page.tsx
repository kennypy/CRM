"use client";

/**
 * Calling / Power Dialer Page
 *
 * A comprehensive calling interface rivaling Nooks.ai with:
 * - Power dialer queue with skip/pause
 * - Active call panel (timer, mute, hold, DTMF, transfer)
 * - Call recording with consent tracking
 * - Call history with filtering
 * - Disposition workflow
 * - Call scripts during active calls
 * - Post-call notes with auto-save
 * - Parallel dialer (multi-line) toggle
 * - Local presence toggle
 * - Analytics bar
 * - Voicemail drop
 * - Contact info sidebar
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useTenant } from "@/lib/tenant-context";
import { usePermissions } from "@/lib/permissions";
import { useTranslations } from "next-intl";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play, SkipForward,
  Volume2, VolumeX, Clock, Hash, Users, Search, ChevronRight,
  AlertCircle, RefreshCw, Settings, BarChart3, MessageSquare,
  Voicemail, Globe, Radio, PhoneForwarded, PhoneIncoming,
  PhoneOutgoing, Square, Circle, X, Check, Plus, Filter,
  ArrowRight, Headphones,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Contact {
  id: string;
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  location: string;
  lastContacted?: string;
  linkedinUrl?: string;
  notes?: string;
  tags: string[];
}

type CallDirection = "outbound" | "inbound";
type Disposition =
  | "connected"
  | "voicemail"
  | "no-answer"
  | "busy"
  | "bad-number"
  | "do-not-call";

interface CallRecord {
  id: string;
  contactId: string;
  contactName: string;
  company: string;
  phone: string;
  direction: CallDirection;
  disposition?: Disposition;
  duration: number;
  startedAt: string;
  recordingUrl?: string;
  notes?: string;
  consentGiven?: boolean;
}

interface CallScript {
  id: string;
  name: string;
  sections: { title: string; body: string }[];
}

interface AnalyticsSummary {
  callsToday: number;
  connectRate: number;
  avgDuration: number;
  talkTime: number;
}

type DialerMode = "single" | "parallel";
type ActiveTab = "queue" | "history" | "scripts" | "analytics";

/* ------------------------------------------------------------------ */
/*  Demo data                                                          */
/* ------------------------------------------------------------------ */

const DEMO_CONTACTS: Contact[] = [
  {
    id: "c1", name: "Sarah Chen", title: "VP of Engineering",
    company: "TechFlow Inc.", phone: "+1 (415) 555-0101",
    email: "sarah.chen@techflow.io", location: "San Francisco, CA",
    lastContacted: "2026-03-05", tags: ["decision-maker", "hot-lead"],
    notes: "Interested in enterprise plan. Follow up on security requirements.",
  },
  {
    id: "c2", name: "Marcus Williams", title: "Head of Sales",
    company: "GrowthMetrics", phone: "+1 (212) 555-0202",
    email: "m.williams@growthmetrics.com", location: "New York, NY",
    lastContacted: "2026-03-06", tags: ["champion"],
    notes: "Requested pricing for 50-seat deployment.",
  },
  {
    id: "c3", name: "Emily Rodriguez", title: "CTO",
    company: "DataBridge Solutions", phone: "+1 (512) 555-0303",
    email: "emily.r@databridge.io", location: "Austin, TX",
    tags: ["technical-buyer"],
  },
  {
    id: "c4", name: "James O'Brien", title: "Director of Operations",
    company: "ScaleUp Corp", phone: "+1 (617) 555-0404",
    email: "jobrien@scaleupcorp.com", location: "Boston, MA",
    lastContacted: "2026-03-01", tags: ["warm-lead"],
    notes: "Moving off competitor in Q2.",
  },
  {
    id: "c5", name: "Anika Patel", title: "Product Manager",
    company: "CloudNova", phone: "+1 (206) 555-0505",
    email: "anika.p@cloudnova.dev", location: "Seattle, WA",
    tags: ["evaluator"],
  },
  {
    id: "c6", name: "David Kim", title: "CEO",
    company: "NexGen AI", phone: "+1 (650) 555-0606",
    email: "dkim@nexgenai.com", location: "Palo Alto, CA",
    lastContacted: "2026-03-07", tags: ["decision-maker", "hot-lead"],
    notes: "Board approved budget. Closing this quarter.",
  },
  {
    id: "c7", name: "Rachel Foster", title: "VP Sales",
    company: "Beacon Analytics", phone: "+1 (303) 555-0707",
    email: "rfoster@beaconanalytics.com", location: "Denver, CO",
    tags: ["warm-lead"],
  },
  {
    id: "c8", name: "Tom Alvarez", title: "IT Director",
    company: "MedCore Systems", phone: "+1 (713) 555-0808",
    email: "talvarez@medcore.com", location: "Houston, TX",
    tags: ["technical-buyer", "compliance"],
  },
];

const DEMO_HISTORY: CallRecord[] = [
  {
    id: "h1", contactId: "c1", contactName: "Sarah Chen", company: "TechFlow Inc.",
    phone: "+1 (415) 555-0101", direction: "outbound", disposition: "connected",
    duration: 342, startedAt: "2026-03-08T09:15:00Z", consentGiven: true,
    notes: "Discussed enterprise security features. Sending proposal by EOD.",
  },
  {
    id: "h2", contactId: "c2", contactName: "Marcus Williams", company: "GrowthMetrics",
    phone: "+1 (212) 555-0202", direction: "outbound", disposition: "voicemail",
    duration: 32, startedAt: "2026-03-08T09:22:00Z", consentGiven: false,
  },
  {
    id: "h3", contactId: "c4", contactName: "James O'Brien", company: "ScaleUp Corp",
    phone: "+1 (617) 555-0404", direction: "outbound", disposition: "no-answer",
    duration: 0, startedAt: "2026-03-08T09:30:00Z",
  },
  {
    id: "h4", contactId: "c6", contactName: "David Kim", company: "NexGen AI",
    phone: "+1 (650) 555-0606", direction: "inbound", disposition: "connected",
    duration: 912, startedAt: "2026-03-08T10:05:00Z", consentGiven: true,
    notes: "Confirmed 200-seat deal. Legal reviewing MSA. Target close 3/15.",
  },
  {
    id: "h5", contactId: "c3", contactName: "Emily Rodriguez", company: "DataBridge Solutions",
    phone: "+1 (512) 555-0303", direction: "outbound", disposition: "busy",
    duration: 5, startedAt: "2026-03-08T10:45:00Z",
  },
  {
    id: "h6", contactId: "c7", contactName: "Rachel Foster", company: "Beacon Analytics",
    phone: "+1 (303) 555-0707", direction: "outbound", disposition: "connected",
    duration: 487, startedAt: "2026-03-08T11:02:00Z", consentGiven: true,
    notes: "Demoed reporting module. Scheduling technical deep-dive next week.",
  },
];

const DEMO_SCRIPT: CallScript = {
  id: "s1",
  name: "Discovery Call Script",
  sections: [
    {
      title: "Opening",
      body: "Hi [Name], this is [Your Name] from [Company]. I noticed that [Company] has been growing rapidly — congratulations! I'm reaching out because we help teams like yours streamline their sales operations. Do you have a quick moment?",
    },
    {
      title: "Qualification",
      body: "To make sure I'm not wasting your time, can I ask:\n• What tools are you currently using for [relevant area]?\n• What's your biggest challenge with your current setup?\n• How many people on your team would use a solution like this?",
    },
    {
      title: "Value Proposition",
      body: "Based on what you've shared, here's how we typically help teams in your situation:\n• [Benefit 1 tied to their pain point]\n• [Benefit 2 tied to their goals]\n• Companies similar to yours have seen [specific metric improvement].",
    },
    {
      title: "Objection Handling",
      body: "Common objections:\n• \"We're happy with current solution\" → \"That's great. Many of our customers felt the same way. What made them switch was [specific differentiator].\"\n• \"Not in budget\" → \"I understand. Would it help if I showed you the ROI analysis? Most teams see payback within [timeframe].\"\n• \"Bad timing\" → \"Completely understand. When would be a better time to revisit? I'd love to at least send over some resources.\"",
    },
    {
      title: "Close / Next Steps",
      body: "It sounds like there could be a real fit here. Would it make sense to schedule a 30-minute demo where I can walk your team through [specific feature]? I have availability [suggest times]. I'll send over a calendar invite and a brief overview document.",
    },
  ],
};

const DEMO_ANALYTICS: AnalyticsSummary = {
  callsToday: 47,
  connectRate: 32.5,
  avgDuration: 245,
  talkTime: 6840,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const DISPOSITION_META: Record<Disposition, { label: string; color: string; icon: React.ReactNode }> = {
  connected:    { label: "Connected",    color: "bg-green-100 text-green-700 border-green-200",  icon: <Check className="w-3.5 h-3.5" /> },
  voicemail:    { label: "Voicemail",    color: "bg-purple-100 text-purple-700 border-purple-200", icon: <Voicemail className="w-3.5 h-3.5" /> },
  "no-answer":  { label: "No Answer",   color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: <PhoneOff className="w-3.5 h-3.5" /> },
  busy:         { label: "Busy",         color: "bg-orange-100 text-orange-700 border-orange-200", icon: <Phone className="w-3.5 h-3.5" /> },
  "bad-number": { label: "Bad Number",  color: "bg-red-100 text-red-700 border-red-200",        icon: <AlertCircle className="w-3.5 h-3.5" /> },
  "do-not-call":{ label: "Do Not Call", color: "bg-gray-100 text-gray-700 border-gray-200",      icon: <X className="w-3.5 h-3.5" /> },
};

const DTMF_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CallingPage() {
  const t = useTranslations("calling");
  const tenant = useTenant();

  /* ---- queue state ---- */
  const [queue, setQueue] = useState<Contact[]>(DEMO_CONTACTS);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queuePaused, setQueuePaused] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  /* ---- call state ---- */
  const [callActive, setCallActive] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [showDtmf, setShowDtmf] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferNumber, setTransferNumber] = useState("");

  /* ---- dialer settings ---- */
  const [dialerMode, setDialerMode] = useState<DialerMode>("single");
  const [localPresence, setLocalPresence] = useState(false);
  const [parallelLines, setParallelLines] = useState(3);

  /* ---- disposition / post-call ---- */
  const [showDisposition, setShowDisposition] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState<Disposition | null>(null);
  const [postCallNotes, setPostCallNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);

  /* ---- history ---- */
  const [history, setHistory] = useState<CallRecord[]>(DEMO_HISTORY);
  const [historyFilter, setHistoryFilter] = useState<"all" | CallDirection>("all");
  const [dispositionFilter, setDispositionFilter] = useState<"all" | Disposition>("all");

  /* ---- tabs & panels ---- */
  const [activeTab, setActiveTab] = useState<ActiveTab>("queue");
  const [showContactSidebar, setShowContactSidebar] = useState(true);
  const [expandedScriptSection, setExpandedScriptSection] = useState<number>(0);

  /* ---- analytics ---- */
  const [analytics, setAnalytics] = useState<AnalyticsSummary>(DEMO_ANALYTICS);

  /* ---- loading ---- */
  const [loading, setLoading] = useState(false);

  const currentContact = queue[queueIndex] ?? null;

  /* ---- call timer ---- */
  useEffect(() => {
    if (!callActive) return;
    const interval = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [callActive]);

  /* ---- auto-save notes ---- */
  useEffect(() => {
    if (!postCallNotes) return;
    setNotesSaved(false);
    const timeout = setTimeout(() => {
      setNotesSaved(true);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [postCallNotes]);

  /* ---- auto-dial when queue unpaused ---- */
  useEffect(() => {
    if (!queuePaused && !callActive && currentContact) {
      const timeout = setTimeout(() => startCall(), 1200);
      return () => clearTimeout(timeout);
    }
  }, [queuePaused, callActive, queueIndex]);

  /* ---- fetch data on mount ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [contactsRes, historyRes] = await Promise.allSettled([
          api.get("/api/calling/queue"),
          api.get("/api/calling/history"),
        ]);
        if (!cancelled) {
          if (contactsRes.status === "fulfilled" && Array.isArray(contactsRes.value)) {
            setQueue(contactsRes.value);
          }
          if (historyRes.status === "fulfilled" && Array.isArray(historyRes.value)) {
            setHistory(historyRes.value);
          }
        }
      } catch {
        // keep demo data on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---- actions ---- */
  const startCall = useCallback(() => {
    if (!currentContact) return;
    setCallActive(true);
    setCallSeconds(0);
    setMuted(false);
    setOnHold(false);
    setRecording(false);
    setConsentGiven(false);
    setShowDisposition(false);
    setSelectedDisposition(null);
    setPostCallNotes("");
    setNotesSaved(false);
    setShowDtmf(false);
    setShowTransfer(false);
  }, [currentContact]);

  const endCall = useCallback(() => {
    setCallActive(false);
    setShowDisposition(true);
    setShowDtmf(false);
    setShowTransfer(false);
  }, []);

  const skipContact = useCallback(() => {
    if (callActive) endCall();
    setQueueIndex((i) => Math.min(i + 1, queue.length - 1));
    setShowDisposition(false);
  }, [callActive, endCall, queue.length]);

  const submitDisposition = useCallback((d: Disposition) => {
    setSelectedDisposition(d);
    if (currentContact) {
      const record: CallRecord = {
        id: `h${Date.now()}`,
        contactId: currentContact.id,
        contactName: currentContact.name,
        company: currentContact.company,
        phone: currentContact.phone,
        direction: "outbound",
        disposition: d,
        duration: callSeconds,
        startedAt: new Date().toISOString(),
        consentGiven,
        notes: postCallNotes || undefined,
      };
      setHistory((prev) => [record, ...prev]);
      setAnalytics((prev) => ({
        ...prev,
        callsToday: prev.callsToday + 1,
        connectRate: d === "connected"
          ? Math.round(((prev.connectRate / 100) * prev.callsToday + 1) / (prev.callsToday + 1) * 1000) / 10
          : Math.round(((prev.connectRate / 100) * prev.callsToday) / (prev.callsToday + 1) * 1000) / 10,
        avgDuration: Math.round((prev.avgDuration * prev.callsToday + callSeconds) / (prev.callsToday + 1)),
        talkTime: prev.talkTime + callSeconds,
      }));
    }
    setShowDisposition(false);
    setQueueIndex((i) => Math.min(i + 1, queue.length - 1));
  }, [currentContact, callSeconds, consentGiven, postCallNotes, queue.length]);

  const dropVoicemail = useCallback(() => {
    submitDisposition("voicemail");
  }, [submitDisposition]);

  const filteredHistory = history.filter((h) => {
    if (historyFilter !== "all" && h.direction !== historyFilter) return false;
    if (dispositionFilter !== "all" && h.disposition !== dispositionFilter) return false;
    return true;
  });

  const filteredQueue = searchQuery
    ? queue.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.company.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : queue;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">
      {/* ---- Analytics Bar ---- */}
      <div className="border-b border-border bg-card px-5 py-3">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-2">
            <Headphones className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">{t("title")}</h1>
          </div>

          <div className="flex items-center gap-6">
            {/* Stat pills */}
            <div className="flex items-center gap-4">
              <StatPill
                icon={<Phone className="w-3.5 h-3.5" />}
                label="Calls Today"
                value={String(analytics.callsToday)}
              />
              <StatPill
                icon={<BarChart3 className="w-3.5 h-3.5" />}
                label="Connect Rate"
                value={`${analytics.connectRate}%`}
              />
              <StatPill
                icon={<Clock className="w-3.5 h-3.5" />}
                label="Avg Duration"
                value={fmtDuration(analytics.avgDuration)}
              />
              <StatPill
                icon={<Headphones className="w-3.5 h-3.5" />}
                label="Talk Time"
                value={fmtDuration(analytics.talkTime)}
              />
            </div>

            {/* Mode toggles */}
            <div className="flex items-center gap-2 pl-4 border-l border-border">
              <button
                onClick={() => setDialerMode(dialerMode === "single" ? "parallel" : "single")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  dialerMode === "parallel"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                <Radio className="w-3.5 h-3.5" />
                {dialerMode === "parallel" ? `Parallel (${parallelLines}x)` : "Single Line"}
              </button>

              <button
                onClick={() => setLocalPresence(!localPresence)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  localPresence
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                Local Presence
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Main Layout ---- */}
      <div className="flex flex-1 overflow-hidden max-w-screen-2xl mx-auto w-full">
        {/* ========== LEFT PANEL ========== */}
        <div className="w-80 border-r border-border flex flex-col bg-card">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            {(
              [
                { key: "queue", label: "Queue", icon: <Users className="w-3.5 h-3.5" /> },
                { key: "history", label: "History", icon: <Clock className="w-3.5 h-3.5" /> },
                { key: "scripts", label: "Scripts", icon: <MessageSquare className="w-3.5 h-3.5" /> },
                { key: "analytics", label: "Stats", icon: <BarChart3 className="w-3.5 h-3.5" /> },
              ] as { key: ActiveTab; label: string; icon: React.ReactNode }[]
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors border-b-2",
                  activeTab === tab.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ---- Queue Tab ---- */}
            {activeTab === "queue" && (
              <div className="flex flex-col">
                {/* Search */}
                <div className="p-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search queue..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 rounded-lg bg-muted/50 border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>{filteredQueue.length} contacts in queue</span>
                    <span>Position {queueIndex + 1}/{queue.length}</span>
                  </div>
                </div>

                {/* Queue list */}
                {filteredQueue.map((contact, idx) => {
                  const realIdx = queue.indexOf(contact);
                  const isCurrent = realIdx === queueIndex;
                  const isPast = realIdx < queueIndex;
                  return (
                    <button
                      key={contact.id}
                      onClick={() => {
                        if (!callActive) setQueueIndex(realIdx);
                      }}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 border-b border-border text-left transition-colors",
                        isCurrent && "bg-primary/5 border-l-2 border-l-primary",
                        isPast && "opacity-50",
                        !isCurrent && !isPast && "hover:bg-muted/50"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                        isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      )}>
                        {contact.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{contact.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {contact.title} · {contact.company}
                        </p>
                      </div>
                      {isCurrent && callActive && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <Circle className="w-2 h-2 fill-green-500" />
                          Live
                        </span>
                      )}
                      {isPast && (
                        <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ---- History Tab ---- */}
            {activeTab === "history" && (
              <div className="flex flex-col">
                {/* Filters */}
                <div className="p-3 border-b border-border space-y-2">
                  <div className="flex gap-1">
                    {(["all", "outbound", "inbound"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setHistoryFilter(f)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                          historyFilter === f
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {f === "all" ? "All" : f === "outbound" ? "Outbound" : "Inbound"}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => setDispositionFilter("all")}
                      className={cn(
                        "px-2 py-0.5 rounded text-xs transition-colors",
                        dispositionFilter === "all"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      All
                    </button>
                    {(Object.keys(DISPOSITION_META) as Disposition[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDispositionFilter(d)}
                        className={cn(
                          "px-2 py-0.5 rounded text-xs border transition-colors",
                          dispositionFilter === d
                            ? DISPOSITION_META[d].color
                            : "text-muted-foreground hover:bg-muted border-transparent"
                        )}
                      >
                        {DISPOSITION_META[d].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* History list */}
                {filteredHistory.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground text-center">No calls match filters.</p>
                )}
                {filteredHistory.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-start gap-3 px-3 py-2.5 border-b border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      call.direction === "inbound" ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"
                    )}>
                      {call.direction === "inbound"
                        ? <PhoneIncoming className="w-3.5 h-3.5" />
                        : <PhoneOutgoing className="w-3.5 h-3.5" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{call.contactName}</p>
                        {call.disposition && (
                          <span className={cn(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                            DISPOSITION_META[call.disposition].color
                          )}>
                            {DISPOSITION_META[call.disposition].icon}
                            {DISPOSITION_META[call.disposition].label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {call.company} · {fmtTime(call.startedAt)} · {fmtDuration(call.duration)}
                      </p>
                      {call.notes && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{call.notes}</p>
                      )}
                    </div>
                    {call.consentGiven && (
                      <span title="Recording consent given" className="text-green-500 mt-1">
                        <Circle className="w-2 h-2 fill-current" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ---- Scripts Tab ---- */}
            {activeTab === "scripts" && (
              <div className="flex flex-col">
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-sm font-medium">{DEMO_SCRIPT.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {DEMO_SCRIPT.sections.length} sections
                  </p>
                </div>
                {DEMO_SCRIPT.sections.map((section, idx) => (
                  <div key={idx} className="border-b border-border">
                    <button
                      onClick={() => setExpandedScriptSection(expandedScriptSection === idx ? -1 : idx)}
                      className="flex items-center justify-between w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm font-medium">{section.title}</span>
                      <ChevronRight
                        className={cn(
                          "w-4 h-4 text-muted-foreground transition-transform",
                          expandedScriptSection === idx && "rotate-90"
                        )}
                      />
                    </button>
                    {expandedScriptSection === idx && (
                      <div className="px-3 pb-3">
                        <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">
                          {section.body}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ---- Analytics Tab ---- */}
            {activeTab === "analytics" && (
              <div className="p-4 space-y-4">
                <div className="space-y-3">
                  <AnalyticsCard label="Total Calls Today" value={String(analytics.callsToday)} subtext="outbound + inbound" />
                  <AnalyticsCard label="Connect Rate" value={`${analytics.connectRate}%`} subtext="of total calls" color={analytics.connectRate >= 30 ? "text-green-600" : "text-yellow-600"} />
                  <AnalyticsCard label="Avg Call Duration" value={fmtDuration(analytics.avgDuration)} subtext="across all calls" />
                  <AnalyticsCard label="Total Talk Time" value={fmtDuration(analytics.talkTime)} subtext="today" />
                </div>

                {/* Disposition breakdown */}
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs font-medium mb-3">Disposition Breakdown</p>
                  {(Object.keys(DISPOSITION_META) as Disposition[]).map((d) => {
                    const count = history.filter((h) => h.disposition === d).length;
                    const pct = history.length > 0 ? Math.round((count / history.length) * 100) : 0;
                    return (
                      <div key={d} className="flex items-center gap-2 mb-2">
                        <span className={cn(
                          "inline-flex items-center justify-center w-5 h-5 rounded",
                          DISPOSITION_META[d].color
                        )}>
                          {DISPOSITION_META[d].icon}
                        </span>
                        <span className="text-xs flex-1">{DISPOSITION_META[d].label}</span>
                        <span className="text-xs font-medium">{count}</span>
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========== CENTER PANEL ========== */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ---- Active Call / Dialer Controls ---- */}
          <div className={cn(
            "border-b border-border p-5 transition-colors",
            callActive ? "bg-green-50/50 dark:bg-green-950/10" : "bg-card"
          )}>
            {/* Parallel dialer indicator */}
            {dialerMode === "parallel" && !callActive && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-sm">
                <Radio className="w-4 h-4 text-blue-600" />
                <span className="text-blue-700 dark:text-blue-400 font-medium">
                  Parallel Dialer Active — calling {parallelLines} lines simultaneously
                </span>
                <button
                  onClick={() => setParallelLines((l) => Math.min(l + 1, 5))}
                  className="ml-auto text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                >
                  + Line
                </button>
                <button
                  onClick={() => setParallelLines((l) => Math.max(l - 1, 2))}
                  className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                >
                  - Line
                </button>
              </div>
            )}

            <div className="flex items-center gap-4">
              {/* Call status / contact summary */}
              <div className="flex-1">
                {currentContact ? (
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                      callActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                    )}>
                      {currentContact.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <div>
                      <p className="text-base font-semibold">{currentContact.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {currentContact.title} at {currentContact.company}
                      </p>
                      <p className="text-sm text-muted-foreground">{currentContact.phone}</p>
                    </div>
                    {callActive && (
                      <div className="ml-4 flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                          </span>
                          <span className="text-sm font-mono font-medium text-green-700 dark:text-green-400">
                            {fmtDuration(callSeconds)}
                          </span>
                        </div>
                        {recording && (
                          <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded-full border border-red-200 dark:border-red-800">
                            <Circle className="w-2 h-2 fill-red-500 animate-pulse" />
                            REC
                            {consentGiven && (
                              <Check className="w-3 h-3 text-green-600 ml-1" />
                            )}
                          </span>
                        )}
                        {onHold && (
                          <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-200">
                            ON HOLD
                          </span>
                        )}
                        {muted && (
                          <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                            MUTED
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No contacts in queue</p>
                )}
              </div>

              {/* Main call controls */}
              <div className="flex items-center gap-2">
                {!callActive ? (
                  <>
                    <button
                      onClick={startCall}
                      disabled={!currentContact}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 text-white font-medium text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      Call
                    </button>
                    <button
                      onClick={() => setQueuePaused(!queuePaused)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                        queuePaused
                          ? "bg-muted text-muted-foreground hover:bg-muted/80"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {queuePaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      {queuePaused ? "Auto-Dial" : "Pause"}
                    </button>
                    <button
                      onClick={skipContact}
                      disabled={!currentContact}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm font-medium hover:bg-muted/80 disabled:opacity-50 transition-colors"
                    >
                      <SkipForward className="w-4 h-4" />
                      Skip
                    </button>
                  </>
                ) : (
                  <>
                    {/* In-call controls */}
                    <button
                      onClick={() => setMuted(!muted)}
                      className={cn(
                        "p-2.5 rounded-xl transition-colors",
                        muted
                          ? "bg-orange-100 text-orange-600 hover:bg-orange-200"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                      title={muted ? "Unmute" : "Mute"}
                    >
                      {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setOnHold(!onHold)}
                      className={cn(
                        "p-2.5 rounded-xl transition-colors",
                        onHold
                          ? "bg-yellow-100 text-yellow-600 hover:bg-yellow-200"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                      title={onHold ? "Resume" : "Hold"}
                    >
                      {onHold ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setSpeakerOn(!speakerOn)}
                      className={cn(
                        "p-2.5 rounded-xl transition-colors",
                        !speakerOn
                          ? "bg-red-100 text-red-600 hover:bg-red-200"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                      title={speakerOn ? "Speaker Off" : "Speaker On"}
                    >
                      {speakerOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => {
                        setRecording(!recording);
                        if (!recording) setConsentGiven(false);
                      }}
                      className={cn(
                        "p-2.5 rounded-xl transition-colors",
                        recording
                          ? "bg-red-100 text-red-600 hover:bg-red-200"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                      title={recording ? "Stop Recording" : "Start Recording"}
                    >
                      {recording ? <Square className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                    </button>
                    {recording && !consentGiven && (
                      <button
                        onClick={() => setConsentGiven(true)}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-amber-100 text-amber-700 text-xs font-medium hover:bg-amber-200 transition-colors border border-amber-200"
                        title="Mark consent as given"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Consent
                      </button>
                    )}
                    <button
                      onClick={() => { setShowDtmf(!showDtmf); setShowTransfer(false); }}
                      className={cn(
                        "p-2.5 rounded-xl transition-colors",
                        showDtmf
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                      title="Keypad"
                    >
                      <Hash className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setShowTransfer(!showTransfer); setShowDtmf(false); }}
                      className={cn(
                        "p-2.5 rounded-xl transition-colors",
                        showTransfer
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                      title="Transfer"
                    >
                      <PhoneForwarded className="w-4 h-4" />
                    </button>
                    <button
                      onClick={dropVoicemail}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-purple-100 text-purple-700 text-sm font-medium hover:bg-purple-200 transition-colors"
                      title="Drop voicemail and move to next"
                    >
                      <Voicemail className="w-4 h-4" />
                      VM Drop
                    </button>
                    <button
                      onClick={endCall}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white font-medium text-sm hover:bg-red-700 transition-colors"
                    >
                      <PhoneOff className="w-4 h-4" />
                      End
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* DTMF Keypad */}
            {showDtmf && callActive && (
              <div className="mt-4 flex justify-center">
                <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-card border border-border shadow-sm">
                  {DTMF_KEYS.flat().map((key) => (
                    <button
                      key={key}
                      className="w-14 h-10 rounded-lg bg-muted hover:bg-muted/80 text-sm font-semibold transition-colors"
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Transfer input */}
            {showTransfer && callActive && (
              <div className="mt-4 flex items-center gap-2 max-w-md">
                <input
                  type="text"
                  placeholder="Enter number or extension..."
                  value={transferNumber}
                  onChange={(e) => setTransferNumber(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                  Warm Transfer
                </button>
                <button className="px-3 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:bg-muted/80 transition-colors">
                  Cold Transfer
                </button>
              </div>
            )}
          </div>

          {/* ---- Disposition Panel ---- */}
          {showDisposition && (
            <div className="border-b border-border bg-amber-50/50 dark:bg-amber-950/10 p-5">
              <p className="text-sm font-medium mb-3">
                How did the call go? Call duration: {fmtDuration(callSeconds)}
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {(Object.keys(DISPOSITION_META) as Disposition[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelectedDisposition(d)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-colors",
                      selectedDisposition === d
                        ? cn(DISPOSITION_META[d].color, "ring-2 ring-offset-1 ring-primary/30")
                        : "bg-card border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {DISPOSITION_META[d].icon}
                    {DISPOSITION_META[d].label}
                  </button>
                ))}
              </div>

              {/* Post-call notes */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Post-Call Notes</label>
                  {notesSaved && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Auto-saved
                    </span>
                  )}
                </div>
                <textarea
                  value={postCallNotes}
                  onChange={(e) => setPostCallNotes(e.target.value)}
                  placeholder="Add notes about this call..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => selectedDisposition && submitDisposition(selectedDisposition)}
                  disabled={!selectedDisposition}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Save &amp; Next
                </button>
                <button
                  onClick={skipContact}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted text-muted-foreground text-sm font-medium hover:bg-muted/80 transition-colors"
                >
                  <SkipForward className="w-4 h-4" />
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ---- Main content: scripts during active call, or recent call history table ---- */}
          <div className="flex-1 overflow-y-auto p-5">
            {callActive ? (
              /* Call script during active call */
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold">Call Script: {DEMO_SCRIPT.name}</h2>
                </div>
                <div className="space-y-3">
                  {DEMO_SCRIPT.sections.map((section, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-xl border p-4 transition-colors",
                        expandedScriptSection === idx
                          ? "border-primary/30 bg-primary/5"
                          : "border-border bg-card hover:border-border/80"
                      )}
                    >
                      <button
                        onClick={() => setExpandedScriptSection(expandedScriptSection === idx ? -1 : idx)}
                        className="flex items-center justify-between w-full text-left"
                      >
                        <span className="text-sm font-medium">{section.title}</span>
                        <ChevronRight
                          className={cn(
                            "w-4 h-4 text-muted-foreground transition-transform",
                            expandedScriptSection === idx && "rotate-90"
                          )}
                        />
                      </button>
                      {expandedScriptSection === idx && (
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                          {section.body}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Call history table when not on a call */
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold">Recent Calls</h2>
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                  </button>
                </div>

                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Contact</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Direction</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Disposition</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Duration</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Recording</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((call) => (
                        <tr key={call.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <p className="font-medium">{call.contactName}</p>
                            <p className="text-xs text-muted-foreground">{call.company}</p>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              "inline-flex items-center gap-1 text-xs",
                              call.direction === "inbound" ? "text-blue-600" : "text-emerald-600"
                            )}>
                              {call.direction === "inbound"
                                ? <PhoneIncoming className="w-3 h-3" />
                                : <PhoneOutgoing className="w-3 h-3" />
                              }
                              {call.direction}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {call.disposition && (
                              <span className={cn(
                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                                DISPOSITION_META[call.disposition].color
                              )}>
                                {DISPOSITION_META[call.disposition].icon}
                                {DISPOSITION_META[call.disposition].label}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                            {fmtDuration(call.duration)}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground text-xs">
                            {fmtTime(call.startedAt)}
                          </td>
                          <td className="px-4 py-2.5">
                            {call.consentGiven !== undefined && (
                              <span className={cn(
                                "inline-flex items-center gap-1 text-xs",
                                call.consentGiven ? "text-green-600" : "text-muted-foreground"
                              )}>
                                {call.consentGiven ? (
                                  <><Check className="w-3 h-3" /> Consent</>
                                ) : (
                                  <><X className="w-3 h-3" /> No consent</>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 max-w-[200px]">
                            <p className="text-xs text-muted-foreground truncate">{call.notes ?? "—"}</p>
                          </td>
                        </tr>
                      ))}
                      {filteredHistory.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                            No calls match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========== RIGHT PANEL — Contact Sidebar ========== */}
        {showContactSidebar && currentContact && (
          <div className="w-80 border-l border-border flex flex-col bg-card overflow-y-auto">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Contact Details</h3>
                <button
                  onClick={() => setShowContactSidebar(false)}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                  {currentContact.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <div>
                  <p className="font-semibold">{currentContact.name}</p>
                  <p className="text-sm text-muted-foreground">{currentContact.title}</p>
                </div>
              </div>

              <div className="space-y-3">
                <DetailRow label="Company" value={currentContact.company} />
                <DetailRow label="Phone" value={currentContact.phone} />
                <DetailRow label="Email" value={currentContact.email} />
                <DetailRow label="Location" value={currentContact.location} />
                {currentContact.lastContacted && (
                  <DetailRow label="Last Contacted" value={currentContact.lastContacted} />
                )}
              </div>
            </div>

            {/* Tags */}
            {currentContact.tags.length > 0 && (
              <div className="p-4 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentContact.tags.map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        tag === "hot-lead"
                          ? "bg-red-100 text-red-700"
                          : tag === "decision-maker"
                          ? "bg-blue-100 text-blue-700"
                          : tag === "champion"
                          ? "bg-green-100 text-green-700"
                          : tag === "technical-buyer"
                          ? "bg-purple-100 text-purple-700"
                          : tag === "compliance"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {currentContact.notes && (
              <div className="p-4 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground mb-2">Notes</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{currentContact.notes}</p>
              </div>
            )}

            {/* Recent calls for this contact */}
            <div className="p-4 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground mb-2">Call History</p>
              {history.filter((h) => h.contactId === currentContact.id).length === 0 ? (
                <p className="text-xs text-muted-foreground">No previous calls</p>
              ) : (
                <div className="space-y-2">
                  {history
                    .filter((h) => h.contactId === currentContact.id)
                    .slice(0, 5)
                    .map((call) => (
                      <div key={call.id} className="flex items-center gap-2 text-xs">
                        {call.direction === "inbound"
                          ? <PhoneIncoming className="w-3 h-3 text-blue-500" />
                          : <PhoneOutgoing className="w-3 h-3 text-emerald-500" />
                        }
                        <span className="text-muted-foreground">{fmtTime(call.startedAt)}</span>
                        {call.disposition && (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                            DISPOSITION_META[call.disposition].color
                          )}>
                            {DISPOSITION_META[call.disposition].label}
                          </span>
                        )}
                        <span className="text-muted-foreground ml-auto font-mono">
                          {fmtDuration(call.duration)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Quick Actions</p>
              <div className="space-y-1.5">
                <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left hover:bg-muted transition-colors">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                  Send SMS
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left hover:bg-muted transition-colors">
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                  Add to Sequence
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left hover:bg-muted transition-colors">
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                  Create Task
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left hover:bg-muted transition-colors">
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                  Edit Contact
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collapsed sidebar toggle */}
        {!showContactSidebar && currentContact && (
          <button
            onClick={() => setShowContactSidebar(true)}
            className="w-10 border-l border-border bg-card flex flex-col items-center justify-center gap-1 hover:bg-muted transition-colors"
            title="Show contact details"
          >
            <Users className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-[10px] text-muted-foreground leading-none">{label}</p>
        <p className="text-sm font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );
}

function AnalyticsCard({
  label,
  value,
  subtext,
  color,
}: {
  label: string;
  value: string;
  subtext: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border p-3 bg-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-bold", color)}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{subtext}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
