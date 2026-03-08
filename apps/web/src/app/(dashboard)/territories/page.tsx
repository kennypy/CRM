"use client";

/**
 * Territory Management — Comprehensive territory configuration, assignment
 * rules, performance tracking, and hierarchical territory views.
 *
 * Currency: always uses tenant.defaultCurrency from TenantContext.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { usePermissions } from "@/lib/permissions";
import {
  Globe,
  Plus,
  MapPin,
  Users,
  Building2,
  BarChart3,
  Target,
  RefreshCw,
  Settings,
  ChevronRight,
  Edit,
  Trash2,
  ArrowRight,
  Filter,
  Search,
  X,
  Check,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type TerritoryType = "enterprise" | "mid-market" | "smb" | "growth";
type ViewMode = "grid" | "hierarchy" | "rules";

interface Territory {
  id: string;
  name: string;
  region: string;
  subRegion: string;
  type: TerritoryType;
  owner: string;
  ownerId: string;
  repCount: number;
  accountCount: number;
  pipelineValue: number;
  quota: number;
  revenue: number;
  winRate: number;
  accountCoverage: number;
  attainment: number;
  color: string;
}

interface AssignmentRule {
  id: string;
  name: string;
  territoryId: string;
  territoryName: string;
  conditions: RuleCondition[];
  priority: number;
  active: boolean;
}

interface RuleCondition {
  field: "country" | "industry" | "employees" | "revenue";
  operator: "equals" | "in" | "gt" | "lt" | "between";
  value: string;
}

interface HierarchyNode {
  region: string;
  subRegions: {
    name: string;
    territories: Territory[];
  }[];
}

// ── Demo Data ───────────────────────────────────────────────────────────────

const DEMO_TERRITORIES: Territory[] = [
  {
    id: "t1",
    name: "US Northeast Enterprise",
    region: "North America",
    subRegion: "US East",
    type: "enterprise",
    owner: "Sarah Chen",
    ownerId: "u1",
    repCount: 8,
    accountCount: 124,
    pipelineValue: 4850000,
    quota: 6000000,
    revenue: 3420000,
    winRate: 34,
    accountCoverage: 78,
    attainment: 57,
    color: "blue",
  },
  {
    id: "t2",
    name: "US West Mid-Market",
    region: "North America",
    subRegion: "US West",
    type: "mid-market",
    owner: "James Park",
    ownerId: "u2",
    repCount: 6,
    accountCount: 210,
    pipelineValue: 2340000,
    quota: 3500000,
    revenue: 2180000,
    winRate: 41,
    accountCoverage: 65,
    attainment: 62,
    color: "green",
  },
  {
    id: "t3",
    name: "EMEA DACH Enterprise",
    region: "EMEA",
    subRegion: "DACH",
    type: "enterprise",
    owner: "Lena Mueller",
    ownerId: "u3",
    repCount: 5,
    accountCount: 87,
    pipelineValue: 3150000,
    quota: 4200000,
    revenue: 2750000,
    winRate: 38,
    accountCoverage: 82,
    attainment: 65,
    color: "purple",
  },
  {
    id: "t4",
    name: "APAC Growth",
    region: "APAC",
    subRegion: "Southeast Asia",
    type: "growth",
    owner: "Kevin Tan",
    ownerId: "u4",
    repCount: 4,
    accountCount: 156,
    pipelineValue: 1280000,
    quota: 2000000,
    revenue: 890000,
    winRate: 28,
    accountCoverage: 45,
    attainment: 44,
    color: "orange",
  },
  {
    id: "t5",
    name: "UK & Ireland SMB",
    region: "EMEA",
    subRegion: "UK & Ireland",
    type: "smb",
    owner: "Emily Shaw",
    ownerId: "u5",
    repCount: 3,
    accountCount: 340,
    pipelineValue: 890000,
    quota: 1500000,
    revenue: 1120000,
    winRate: 45,
    accountCoverage: 52,
    attainment: 75,
    color: "teal",
  },
  {
    id: "t6",
    name: "LATAM Mid-Market",
    region: "LATAM",
    subRegion: "Brazil & Southern Cone",
    type: "mid-market",
    owner: "Carlos Mendez",
    ownerId: "u6",
    repCount: 4,
    accountCount: 98,
    pipelineValue: 1560000,
    quota: 2200000,
    revenue: 1340000,
    winRate: 32,
    accountCoverage: 60,
    attainment: 61,
    color: "rose",
  },
];

const DEMO_RULES: AssignmentRule[] = [
  {
    id: "r1",
    name: "US Enterprise by Country",
    territoryId: "t1",
    territoryName: "US Northeast Enterprise",
    conditions: [
      { field: "country", operator: "in", value: "US, Canada" },
      { field: "employees", operator: "gt", value: "1000" },
      { field: "revenue", operator: "gt", value: "$50M" },
    ],
    priority: 1,
    active: true,
  },
  {
    id: "r2",
    name: "DACH Region Routing",
    territoryId: "t3",
    territoryName: "EMEA DACH Enterprise",
    conditions: [
      { field: "country", operator: "in", value: "Germany, Austria, Switzerland" },
      { field: "employees", operator: "gt", value: "500" },
    ],
    priority: 2,
    active: true,
  },
  {
    id: "r3",
    name: "SMB Auto-Route",
    territoryId: "t5",
    territoryName: "UK & Ireland SMB",
    conditions: [
      { field: "country", operator: "in", value: "UK, Ireland" },
      { field: "employees", operator: "lt", value: "200" },
      { field: "revenue", operator: "between", value: "$1M - $20M" },
    ],
    priority: 3,
    active: true,
  },
  {
    id: "r4",
    name: "APAC Growth Accounts",
    territoryId: "t4",
    territoryName: "APAC Growth",
    conditions: [
      { field: "country", operator: "in", value: "Singapore, Indonesia, Thailand, Vietnam" },
      { field: "industry", operator: "in", value: "Technology, Fintech, E-commerce" },
    ],
    priority: 4,
    active: true,
  },
  {
    id: "r5",
    name: "LATAM Mid-Market by Revenue",
    territoryId: "t6",
    territoryName: "LATAM Mid-Market",
    conditions: [
      { field: "country", operator: "in", value: "Brazil, Argentina, Chile" },
      { field: "revenue", operator: "between", value: "$10M - $100M" },
    ],
    priority: 5,
    active: false,
  },
];

const REGIONS = ["All Regions", "North America", "EMEA", "APAC", "LATAM"];
const TERRITORY_TYPES: { value: TerritoryType | "all"; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "enterprise", label: "Enterprise" },
  { value: "mid-market", label: "Mid-Market" },
  { value: "smb", label: "SMB" },
  { value: "growth", label: "Growth" },
];

const TYPE_COLORS: Record<TerritoryType, string> = {
  enterprise: "bg-blue-100 text-blue-700",
  "mid-market": "bg-green-100 text-green-700",
  smb: "bg-amber-100 text-amber-700",
  growth: "bg-purple-100 text-purple-700",
};

const TYPE_LABELS: Record<TerritoryType, string> = {
  enterprise: "Enterprise",
  "mid-market": "Mid-Market",
  smb: "SMB",
  growth: "Growth",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function attainmentColor(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-yellow-600";
  return "text-red-600";
}

function attainmentBg(pct: number): string {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function buildHierarchy(territories: Territory[]): HierarchyNode[] {
  const regionMap = new Map<string, Map<string, Territory[]>>();
  for (const t of territories) {
    if (!regionMap.has(t.region)) regionMap.set(t.region, new Map());
    const subMap = regionMap.get(t.region)!;
    if (!subMap.has(t.subRegion)) subMap.set(t.subRegion, []);
    subMap.get(t.subRegion)!.push(t);
  }
  const nodes: HierarchyNode[] = [];
  for (const [region, subMap] of regionMap) {
    const subRegions: HierarchyNode["subRegions"] = [];
    for (const [name, territories] of subMap) {
      subRegions.push({ name, territories });
    }
    nodes.push({ region, subRegions });
  }
  return nodes;
}

function conditionLabel(c: RuleCondition): string {
  const fieldLabels: Record<string, string> = {
    country: "Country",
    industry: "Industry",
    employees: "Employees",
    revenue: "Revenue",
  };
  const opLabels: Record<string, string> = {
    equals: "=",
    in: "in",
    gt: ">",
    lt: "<",
    between: "between",
  };
  return `${fieldLabels[c.field]} ${opLabels[c.operator]} ${c.value}`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function TerritoriesPage() {
  const tenant = useTenant();
  const { can } = usePermissions();
  const currency = tenant?.defaultCurrency ?? "USD";
  const locale = tenant?.locale ?? "en-US";

  const [territories, setTerritories] = useState<Territory[]>(DEMO_TERRITORIES);
  const [rules, setRules] = useState<AssignmentRule[]>(DEMO_RULES);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("All Regions");
  const [typeFilter, setTypeFilter] = useState<TerritoryType | "all">("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set(REGIONS));
  const [expandedSubRegions, setExpandedSubRegions] = useState<Set<string>>(new Set());

  // ── Filtered data ───────────────────────────────────────────────────────

  const filteredTerritories = useMemo(() => {
    let result = territories;
    if (regionFilter !== "All Regions") {
      result = result.filter((t) => t.region === regionFilter);
    }
    if (typeFilter !== "all") {
      result = result.filter((t) => t.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.owner.toLowerCase().includes(q) ||
          t.region.toLowerCase().includes(q)
      );
    }
    return result;
  }, [territories, regionFilter, typeFilter, searchQuery]);

  // ── Aggregate stats ─────────────────────────────────────────────────────

  const aggregateStats = useMemo(() => {
    const totalPipeline = filteredTerritories.reduce((s, t) => s + t.pipelineValue, 0);
    const totalRevenue = filteredTerritories.reduce((s, t) => s + t.revenue, 0);
    const totalQuota = filteredTerritories.reduce((s, t) => s + t.quota, 0);
    const avgWinRate =
      filteredTerritories.length > 0
        ? Math.round(
            filteredTerritories.reduce((s, t) => s + t.winRate, 0) /
              filteredTerritories.length
          )
        : 0;
    const avgCoverage =
      filteredTerritories.length > 0
        ? Math.round(
            filteredTerritories.reduce((s, t) => s + t.accountCoverage, 0) /
              filteredTerritories.length
          )
        : 0;
    const totalAttainment = totalQuota > 0 ? Math.round((totalRevenue / totalQuota) * 100) : 0;
    return { totalPipeline, totalRevenue, totalQuota, avgWinRate, avgCoverage, totalAttainment };
  }, [filteredTerritories]);

  const hierarchy = useMemo(() => buildHierarchy(filteredTerritories), [filteredTerritories]);

  // ── Data fetching ───────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [terr, rls] = await Promise.all([
        api.get("/territories"),
        api.get("/territories/rules"),
      ]);
      if (terr?.data) setTerritories(terr.data);
      if (rls?.data) setRules(rls.data);
    } catch {
      // keep demo data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── Create territory ───────────────────────────────────────────────────

  const handleCreate = useCallback(
    async (data: {
      name: string;
      region: string;
      type: TerritoryType;
      owner: string;
      quota: number;
    }) => {
      try {
        const res = await api.post("/territories", data);
        if (res?.data) {
          setTerritories((prev) => [...prev, res.data]);
        }
      } catch {
        // fallback: add locally
        const newTerritory: Territory = {
          id: `t${Date.now()}`,
          name: data.name,
          region: data.region,
          subRegion: data.region,
          type: data.type,
          owner: data.owner,
          ownerId: `u${Date.now()}`,
          repCount: 0,
          accountCount: 0,
          pipelineValue: 0,
          quota: data.quota,
          revenue: 0,
          winRate: 0,
          accountCoverage: 0,
          attainment: 0,
          color: "gray",
        };
        setTerritories((prev) => [...prev, newTerritory]);
      }
      setShowCreateModal(false);
    },
    []
  );

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.delete(`/territories/${id}`);
    } catch {
      // continue with local removal
    }
    setTerritories((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleRule = useCallback((id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r))
    );
  }, []);

  const toggleRegion = useCallback((region: string) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  }, []);

  const toggleSubRegion = useCallback((key: string) => {
    setExpandedSubRegions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Territory Management</h1>
          <p className="text-sm text-muted-foreground">
            Configure territories, assignment rules, and track regional performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Territory
          </button>
        </div>
      </div>

      {/* ── Performance Summary ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard
          icon={<BarChart3 className="h-4 w-4 text-blue-600" />}
          label="Total Pipeline"
          value={formatCurrency(aggregateStats.totalPipeline, currency, locale)}
        />
        <SummaryCard
          icon={<Target className="h-4 w-4 text-green-600" />}
          label="Total Revenue"
          value={formatCurrency(aggregateStats.totalRevenue, currency, locale)}
        />
        <SummaryCard
          icon={<Globe className="h-4 w-4 text-purple-600" />}
          label="Total Quota"
          value={formatCurrency(aggregateStats.totalQuota, currency, locale)}
        />
        <SummaryCard
          icon={<Target className="h-4 w-4 text-amber-600" />}
          label="Avg Win Rate"
          value={`${aggregateStats.avgWinRate}%`}
        />
        <SummaryCard
          icon={<Building2 className="h-4 w-4 text-teal-600" />}
          label="Avg Coverage"
          value={`${aggregateStats.avgCoverage}%`}
        />
        <SummaryCard
          icon={<BarChart3 className="h-4 w-4 text-rose-600" />}
          label="Attainment"
          value={`${aggregateStats.totalAttainment}%`}
          valueClassName={attainmentColor(aggregateStats.totalAttainment)}
        />
      </div>

      {/* ── Filters & View Toggle ───────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search territories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-md border bg-card pl-9 pr-8 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-56"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Region Filter */}
          <div className="relative">
            <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="h-9 appearance-none rounded-md border bg-card pl-9 pr-8 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TerritoryType | "all")}
            className="h-9 appearance-none rounded-md border bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {TERRITORY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* View Mode */}
        <div className="flex items-center rounded-md border bg-card shadow-sm">
          {(
            [
              { key: "grid", label: "Grid", icon: <Building2 className="h-4 w-4" /> },
              { key: "hierarchy", label: "Hierarchy", icon: <Globe className="h-4 w-4" /> },
              { key: "rules", label: "Rules", icon: <Settings className="h-4 w-4" /> },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              onClick={() => setViewMode(v.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === v.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Grid View ───────────────────────────────────────────────────── */}
      {viewMode === "grid" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTerritories.map((territory) => (
            <TerritoryCard
              key={territory.id}
              territory={territory}
              currency={currency}
              locale={locale}
              onDelete={handleDelete}
            />
          ))}
          {filteredTerritories.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed bg-card py-12 text-muted-foreground">
              <MapPin className="mb-2 h-8 w-8" />
              <p className="font-medium">No territories found</p>
              <p className="text-sm">Try adjusting your filters or create a new territory</p>
            </div>
          )}
        </div>
      )}

      {/* ── Hierarchy View ──────────────────────────────────────────────── */}
      {viewMode === "hierarchy" && (
        <div className="space-y-3">
          {hierarchy.map((node) => (
            <div
              key={node.region}
              className="rounded-lg border bg-card shadow-sm"
            >
              <button
                onClick={() => toggleRegion(node.region)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      expandedRegions.has(node.region) && "rotate-90"
                    )}
                  />
                  <Globe className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{node.region}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {node.subRegions.reduce((s, sr) => s + sr.territories.length, 0)} territories
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {formatCurrency(
                    node.subRegions
                      .flatMap((sr) => sr.territories)
                      .reduce((s, t) => s + t.pipelineValue, 0),
                    currency,
                    locale
                  )}{" "}
                  pipeline
                </span>
              </button>
              {expandedRegions.has(node.region) && (
                <div className="border-t px-4 pb-3">
                  {node.subRegions.map((sr) => {
                    const srKey = `${node.region}:${sr.name}`;
                    return (
                      <div key={sr.name} className="mt-2">
                        <button
                          onClick={() => toggleSubRegion(srKey)}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent/50 transition-colors"
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 text-muted-foreground transition-transform",
                              expandedSubRegions.has(srKey) && "rotate-90"
                            )}
                          />
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{sr.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({sr.territories.length})
                          </span>
                        </button>
                        {expandedSubRegions.has(srKey) && (
                          <div className="ml-8 mt-1 space-y-1">
                            {sr.territories.map((t) => (
                              <div
                                key={t.id}
                                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm bg-card"
                              >
                                <div className="flex items-center gap-3">
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                      TYPE_COLORS[t.type]
                                    )}
                                  >
                                    {TYPE_LABELS[t.type]}
                                  </span>
                                  <span className="font-medium">{t.name}</span>
                                  <span className="text-muted-foreground">
                                    <Users className="mr-1 inline h-3 w-3" />
                                    {t.repCount} reps
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                  <span>{t.accountCount} accounts</span>
                                  <span>{formatCurrency(t.pipelineValue, currency, locale)}</span>
                                  <span className={attainmentColor(t.attainment)}>
                                    {t.attainment}% attainment
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {hierarchy.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card py-12 text-muted-foreground">
              <Globe className="mb-2 h-8 w-8" />
              <p className="font-medium">No territories to display</p>
            </div>
          )}
        </div>
      )}

      {/* ── Rules View ──────────────────────────────────────────────────── */}
      {viewMode === "rules" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Auto-Assignment Rules</h2>
              <p className="text-sm text-muted-foreground">
                Rules are evaluated in priority order. First matching rule assigns the account.
              </p>
            </div>
            <button className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors">
              <Plus className="h-4 w-4" />
              Add Rule
            </button>
          </div>

          <div className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  "rounded-lg border bg-card p-4 shadow-sm transition-opacity",
                  !rule.active && "opacity-60"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {rule.priority}
                      </span>
                      <h3 className="font-medium">{rule.name}</h3>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          rule.active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        )}
                      >
                        {rule.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="ml-9 mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                      <ArrowRight className="h-3.5 w-3.5" />
                      Routes to:{" "}
                      <span className="font-medium text-foreground">
                        {rule.territoryName}
                      </span>
                    </div>
                    <div className="ml-9 mt-2 flex flex-wrap gap-2">
                      {rule.conditions.map((c, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center rounded-md border bg-muted/50 px-2 py-1 text-xs"
                        >
                          {conditionLabel(c)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleRule(rule.id)}
                      className={cn(
                        "rounded-md p-1.5 transition-colors",
                        rule.active
                          ? "text-green-600 hover:bg-green-50"
                          : "text-gray-400 hover:bg-gray-50"
                      )}
                      title={rule.active ? "Deactivate" : "Activate"}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button className="rounded-md p-1.5 text-muted-foreground hover:bg-accent transition-colors">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Create Territory Modal ──────────────────────────────────────── */}
      {showCreateModal && (
        <CreateTerritoryModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
          currency={currency}
          locale={locale}
        />
      )}
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={cn("mt-1 text-lg font-bold tracking-tight", valueClassName)}>{value}</p>
    </div>
  );
}

function TerritoryCard({
  territory,
  currency,
  locale,
  onDelete,
}: {
  territory: Territory;
  currency: string;
  locale: string;
  onDelete: (id: string) => void;
}) {
  const t = territory;
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold leading-tight">{t.name}</h3>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {t.region} &middot; {t.subRegion}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              TYPE_COLORS[t.type]
            )}
          >
            {TYPE_LABELS[t.type]}
          </span>
          <button
            onClick={() => onDelete(t.id)}
            className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Owner & Counts */}
      <div className="mt-3 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{t.owner}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t.repCount} reps</span>
          <span>{t.accountCount} accounts</span>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MetricCell label="Pipeline" value={formatCurrency(t.pipelineValue, currency, locale)} />
        <MetricCell label="Revenue" value={formatCurrency(t.revenue, currency, locale)} />
        <MetricCell label="Win Rate" value={`${t.winRate}%`} />
        <MetricCell label="Coverage" value={`${t.accountCoverage}%`} />
      </div>

      {/* Quota & Attainment */}
      <div className="mt-4 border-t pt-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Quota: {formatCurrency(t.quota, currency, locale)}
          </span>
          <span className={cn("font-bold", attainmentColor(t.attainment))}>
            {t.attainment}% attainment
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", attainmentBg(t.attainment))}
            style={{ width: `${Math.min(t.attainment, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function CreateTerritoryModal({
  onClose,
  onCreate,
  currency,
  locale,
}: {
  onClose: () => void;
  onCreate: (data: {
    name: string;
    region: string;
    type: TerritoryType;
    owner: string;
    quota: number;
  }) => void;
  currency: string;
  locale: string;
}) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("North America");
  const [type, setType] = useState<TerritoryType>("enterprise");
  const [owner, setOwner] = useState("");
  const [quota, setQuota] = useState("");

  const canSubmit = name.trim() && owner.trim() && Number(quota) > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onCreate({
      name: name.trim(),
      region,
      type,
      owner: owner.trim(),
      quota: Number(quota),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Territory</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Territory Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. US Northeast Enterprise"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Region */}
          <div>
            <label className="mb-1 block text-sm font-medium">Region</label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {REGIONS.filter((r) => r !== "All Regions").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-sm font-medium">Territory Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TerritoryType)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="enterprise">Enterprise</option>
              <option value="mid-market">Mid-Market</option>
              <option value="smb">SMB</option>
              <option value="growth">Growth</option>
            </select>
          </div>

          {/* Owner */}
          <div>
            <label className="mb-1 block text-sm font-medium">Owner</label>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Assign a territory owner"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Quota */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Quota ({currency})
            </label>
            <input
              type="number"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              placeholder="e.g. 5000000"
              min="0"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Create Territory
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
