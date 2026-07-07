"use client";

/**
 * Knowledge Base management (internal). Authors create/edit articles and
 * categories; published articles appear on the public customer portal at
 * /portal/[tenant-slug]. Reps can read; managers+ can author (backend enforces).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenant } from "@/lib/tenant-context";
import { usePermissions } from "@/lib/permissions";
import { api } from "@/lib/api";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  BookOpen, Plus, Search, ExternalLink, FileText, Eye, EyeOff, Trash2,
  X, FolderPlus, Tag, Loader2, AlertCircle,
} from "lucide-react";

interface Category { id: string; name: string; slug: string; description: string | null; articleCount: number }
interface Article {
  id: string; title: string; slug: string; excerpt: string | null; body: string;
  status: "draft" | "published"; viewCount: number; categoryId: string | null;
  categoryName: string | null; updatedAt: string;
}

function ArticleEditor({ article, categories, onClose, onSaved }: {
  article: Article | null; categories: Category[]; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(article?.title ?? "");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? "");
  const [status, setStatus] = useState<"draft" | "published">(article?.status ?? "draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload = { title, excerpt: excerpt || null, body, categoryId: categoryId || null, status };
    try {
      const res = article
        ? await api.patch(`/api/v1/kb/${article.id}`, payload)
        : await api.post("/api/v1/kb", payload);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? "Couldn't save the article."); return; }
      onSaved();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-primary" /> {article ? "Edit article" : "New article"}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How to reset your password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Uncategorised</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "draft" | "published")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Excerpt</label>
            <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="Short summary shown in listings"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Write the article…"
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Cancel</button>
          <button onClick={save} disabled={saving || !title}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {saving ? "Saving…" : article ? "Save changes" : "Create article"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryManager({ categories, onClose, onChanged }: {
  categories: Category[]; onClose: () => void; onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/v1/kb/categories", { name: name.trim() });
      setName("");
      onChanged();
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this category? Its articles become uncategorised.")) return;
    await api.delete(`/api/v1/kb/categories/${id}`);
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><Tag className="h-4 w-4 text-primary" /> Categories</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-3 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="New category name"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={add} disabled={busy || !name.trim()}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">Add</button>
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No categories yet.</p>
          ) : categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/50">
              <span className="text-sm">{c.name} <span className="text-xs text-muted-foreground">· {c.articleCount}</span></span>
              <button onClick={() => remove(c.id)} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const { tenant } = useTenant();
  const { isManager } = usePermissions();

  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "published">("");
  const [editing, setEditing] = useState<Article | null | undefined>(undefined); // undefined = closed, null = new
  const [showCats, setShowCats] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, cRes] = await Promise.all([api.get("/api/v1/kb"), api.get("/api/v1/kb/categories")]);
      const aData = await aRes.json().catch(() => ({}));
      const cData = await cRes.json().catch(() => ({}));
      if (!aRes.ok) { setError(aData?.error?.message ?? "Couldn't load the knowledge base."); return; }
      setArticles(aData.data ?? []);
      setCategories(cData.data ?? []);
    } catch {
      setError("Network error — could not load the knowledge base.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => articles.filter((a) => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (search && !`${a.title} ${a.excerpt ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [articles, search, statusFilter]);

  const togglePublish = async (a: Article) => {
    const next = a.status === "published" ? "draft" : "published";
    setArticles((as) => as.map((x) => x.id === a.id ? { ...x, status: next } : x));
    await api.patch(`/api/v1/kb/${a.id}`, { status: next });
    load();
  };

  const remove = async (a: Article) => {
    if (!confirm(`Delete "${a.title}"? This can't be undone.`)) return;
    setArticles((as) => as.filter((x) => x.id !== a.id));
    await api.delete(`/api/v1/kb/${a.id}`);
    load();
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold"><BookOpen className="h-5 w-5 text-primary" /> Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">Author help articles. Published ones appear on your public customer portal.</p>
        </div>
        <div className="flex items-center gap-2">
          {tenant?.slug && (
            <a href={`/portal/${tenant.slug}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
              <ExternalLink className="h-3.5 w-3.5" /> View portal
            </a>
          )}
          {isManager && (
            <>
              <button onClick={() => setShowCats(true)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                <FolderPlus className="h-3.5 w-3.5" /> Categories
              </button>
              <button onClick={() => setEditing(null)} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" /> New article
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search articles…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | "draft" | "published")}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-border bg-card">
        {error ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <button onClick={load} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Retry</button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-16 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{articles.length === 0 ? "No articles yet. Create your first help article." : "No articles match these filters."}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <button onClick={() => isManager && setEditing(a)} className="min-w-0 flex-1 text-left" disabled={!isManager}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{a.title}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      a.status === "published" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600")}>{a.status}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {a.categoryName ? `${a.categoryName} · ` : ""}{a.viewCount} views · updated {formatRelativeTime(a.updatedAt)}
                  </div>
                </button>
                {isManager && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => togglePublish(a)} title={a.status === "published" ? "Unpublish" : "Publish"}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                      {a.status === "published" ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button onClick={() => remove(a)} title="Delete"
                      className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing !== undefined && (
        <ArticleEditor article={editing} categories={categories} onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); load(); }} />
      )}
      {showCats && (
        <CategoryManager categories={categories} onClose={() => setShowCats(false)} onChanged={load} />
      )}
    </div>
  );
}
