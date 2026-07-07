"use client";

/**
 * Public article detail on the customer portal. Body is rendered as plain text
 * with preserved whitespace (no HTML injection) to stay XSS-safe.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Loader2, LifeBuoy } from "lucide-react";

interface Article {
  slug: string; title: string; excerpt: string | null; body: string;
  categoryName: string | null; publishedAt: string | null; updatedAt: string;
}

export default function ArticlePage({ params }: { params: Promise<{ slug: string; articleSlug: string }> }) {
  const { slug, articleSlug } = use(params);
  const [article, setArticle] = useState<Article | null>(null);
  const [tenantName, setTenantName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/${encodeURIComponent(slug)}/articles/${encodeURIComponent(articleSlug)}`)
      .then(async (r) => {
        if (!r.ok) { setNotFound(true); return; }
        const d = await r.json().catch(() => ({}));
        if (d?.success) { setArticle(d.data.article); setTenantName(d.data.tenant?.name ?? ""); }
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug, articleSlug]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (notFound || !article) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <LifeBuoy className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Article not found</h1>
        <Link href={`/portal/${encodeURIComponent(slug)}`} className="text-sm font-medium text-primary hover:underline">Back to help centre</Link>
      </div>
    );
  }

  const dateStr = article.publishedAt ?? article.updatedAt;

  return (
    <div>
      <div className="border-b border-border bg-gradient-to-b from-primary/10 to-transparent">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <Link href={`/portal/${encodeURIComponent(slug)}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> {tenantName || "Help Centre"}
          </Link>
          {article.categoryName && (
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
              <BookOpen className="h-3.5 w-3.5" /> {article.categoryName}
            </div>
          )}
          <h1 className="text-2xl font-bold md:text-3xl">{article.title}</h1>
          {dateStr && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last updated {new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <article className="mx-auto max-w-3xl px-4 py-8">
        {article.excerpt && <p className="mb-6 text-lg text-muted-foreground">{article.excerpt}</p>}
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
          {article.body || "This article has no content yet."}
        </div>
      </article>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Powered by NexCRM
      </footer>
    </div>
  );
}
