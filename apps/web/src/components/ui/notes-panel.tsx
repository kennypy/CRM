"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { StickyNote, Plus, Pin, Trash2, Edit3, X, Check } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { api } from "@/lib/api";

interface Note {
  id: string;
  content: string;
  authorId: string | null;
  authorName: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface NotesPanelProps {
  entityType: string;
  entityId: string;
  readOnly?: boolean;
  className?: string;
}

export function NotesPanel({ entityType, entityId, readOnly, className }: NotesPanelProps) {
  const t = useTranslations("notes");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const fetchNotes = useCallback(async () => {
    try {
      const res = await api.get(`/api/v1/notes/${entityType}/${entityId}`);
      if (res.ok) {
        const json = await res.json();
        setNotes(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    setAdding(true);
    try {
      const res = await api.post(`/api/v1/notes/${entityType}/${entityId}`, { content: newContent.trim() });
      if (res.ok) {
        setNewContent("");
        fetchNotes();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editContent.trim()) return;
    await api.patch(`/api/v1/notes/${id}`, { content: editContent.trim() });
    setEditingId(null);
    fetchNotes();
  };

  const handleTogglePin = async (note: Note) => {
    await api.patch(`/api/v1/notes/${note.id}`, { pinned: !note.pinned });
    fetchNotes();
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/api/v1/notes/${id}`);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <span className="text-xs text-muted-foreground">({notes.length})</span>
      </div>

      {/* Add note */}
      {!readOnly && (
        <div className="flex gap-2">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={t("placeholder")}
            rows={2}
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newContent.trim()}
            className="self-end rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className={cn(
                "rounded-lg border p-3 text-sm",
                note.pinned && "border-primary/30 bg-primary/5",
              )}
            >
              {editingId === note.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button onClick={() => handleUpdate(note.id)} className="rounded p-1 hover:bg-muted">
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="rounded p-1 hover:bg-muted">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap">{note.content}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {note.authorName && <>{note.authorName} &middot; </>}
                      {formatRelativeTime(note.createdAt)}
                    </span>
                    {!readOnly && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleTogglePin(note)}
                          className={cn("rounded p-1 hover:bg-muted", note.pinned && "text-primary")}
                          title={note.pinned ? t("unpin") : t("pin")}
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => { setEditingId(note.id); setEditContent(note.content); }}
                          className="rounded p-1 hover:bg-muted"
                        >
                          <Edit3 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(note.id)}
                          className="rounded p-1 hover:bg-red-50 text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
