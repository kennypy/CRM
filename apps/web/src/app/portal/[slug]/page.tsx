"use client";

/**
 * Customer portal home — public help centre for a tenant, resolved by slug.
 * Browse published articles by category, or search. No auth required.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, BookOpen, LifeBuoy, ChevronRight, FileText, Loader2 } from "lucide-react";

interface Category { id: string; name: string; slug: string; description: string | null; articleCount: number }
interface Article { slug: string; title: string; excerpt: string | null; categoryId: string | null; categoryName: string | null }
interface PortalData { tenant: { name: string; slug: string }; categories: Category[]; articles: Article[] }

export default function PortalHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Article[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portal/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return; }
        const d = await r.json().catch(() => ({}));
        if (d?.success) setData(d.data);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/portal/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const d = await r.json().catch(() => ({}));
        if (!ctrl.signal.aborted) setResults(d?.data?.results ?? []);
      } catch { /* aborted or network */ } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [query, slug]);

  const visibleArticles = useMemo(() => {
    if (!data) return [];
    return activeCat ? data.articles.filter((a) => a.categoryId === activeCat) : data.articles;
  }, [data, activeCat]);

  const ArticleCard = useCallback(({ a }: { a: Article }) => (
    <Link
      href={`/portal/${encodeURIComponent(slug)}/articles/${encodeURIComponent(a.slug)}`}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/40"
    >
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium group-hover:text-primary">{a.title}</span>
        {a.excerpt && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{a.excerpt}</span>}
        {a.categoryName && <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{a.categoryName}</span>}
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
    </Link>
  ), [slug]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (notFound || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <LifeBuoy className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Help centre not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">This help centre doesn&apos;t exist or isn&apos;t available. Check the link and try again.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Hero */}
      <div className="border-b border-border bg-gradient-to-b from-primary/10 to-transparent">
        <div className="mx-auto max-w-4xl px-4 py-12 md:py-16">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <BookOpen className="h-4 w-4" /> {data.tenant.name} Help Centre
          </div>
          <h1 className="text-2xl font-bold md:text-3xl">How can we help?</h1>
          <div className="relative mt-5 max-w-xl">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles…"
              className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            {searching && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Search results take over when active */}
        {results !== null ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{results.length} result{results.length === 1 ? "" : "s"} for &ldquo;{query.trim()}&rdquo;</p>
            {results.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No articles matched your search.</p>
            ) : results.map((a) => <ArticleCard key={a.slug} a={a} />)}
          </div>
        ) : (
          <>
            {/* Category filter chips */}
            {data.categories.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveCat(null)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${activeCat === null ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                >
                  All ({data.articles.length})
                </button>
                {data.categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${activeCat === c.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                  >
                    {c.name} ({c.articleCount})
                  </button>
                ))}
              </div>
            )}

            {visibleArticles.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
                <BookOpen className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No published articles yet. Check back soon.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {visibleArticles.map((a) => <ArticleCard key={a.slug} a={a} />)}
              </div>
            )}
          </>
        )}
      </div>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Powered by NexCRM
      </footer>
    </div>
  );
}
