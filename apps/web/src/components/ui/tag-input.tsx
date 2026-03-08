"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface TagInputProps {
  entityType: string;
  entityId: string;
  readOnly?: boolean;
  className?: string;
}

export function TagInput({ entityType, entityId, readOnly, className }: TagInputProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showInput, setShowInput] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTags = useCallback(async () => {
    try {
      const res = await api.get(`/api/v1/tags/${entityType}/${entityId}`);
      if (res.ok) {
        const json = await res.json();
        setTags(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { fetchTags(); }, [fetchTags]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q) { setSuggestions([]); return; }
    try {
      const res = await api.get(`/api/v1/tags?entity_type=${entityType}`);
      if (res.ok) {
        const json = await res.json();
        setSuggestions(
          (json.data as string[])
            .filter((t: string) => t.includes(q.toLowerCase()) && !tags.includes(t))
            .slice(0, 5),
        );
      }
    } catch {
      setSuggestions([]);
    }
  }, [entityType, tags]);

  const addTag = async (tag: string) => {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || tags.includes(normalized)) return;
    const res = await api.post(`/api/v1/tags/${entityType}/${entityId}`, { tags: [normalized] });
    if (res.ok) {
      const json = await res.json();
      setTags(json.data ?? [...tags, normalized]);
    }
    setInput("");
    setSuggestions([]);
  };

  const removeTag = async (tag: string) => {
    await api.delete(`/api/v1/tags/${entityType}/${entityId}/${encodeURIComponent(tag)}`);
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === "Escape") {
      setShowInput(false);
      setInput("");
      setSuggestions([]);
    }
  };

  if (loading) {
    return <div className={cn("flex gap-1", className)}><div className="h-5 w-16 animate-pulse rounded bg-muted" /></div>;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {tag}
          {!readOnly && (
            <button onClick={() => removeTag(tag)} className="hover:text-red-500">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        showInput ? (
          <div className="relative">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); fetchSuggestions(e.target.value); }}
              onKeyDown={handleKeyDown}
              onBlur={() => { setTimeout(() => { setShowInput(false); setSuggestions([]); }, 200); }}
              placeholder="Add tag…"
              className="w-24 rounded border bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary/30"
              autoFocus
            />
            {suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border bg-card py-1 shadow-lg">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                    className="block w-full px-3 py-1 text-left text-xs hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="h-3 w-3" /> tag
          </button>
        )
      )}
    </div>
  );
}
