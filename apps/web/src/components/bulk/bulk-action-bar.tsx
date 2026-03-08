"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Trash2, Pencil, X, Loader2 } from "lucide-react";

interface BulkActionBarProps {
  entityType: "contact" | "company" | "deal" | "activity" | "task";
  selectedIds: string[];
  onClear: () => void;
  onComplete: () => void;
}

export function BulkActionBar({ entityType, selectedIds, onClear, onComplete }: BulkActionBarProps) {
  const t = useTranslations("bulk");
  const [showEdit, setShowEdit] = useState(false);
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  if (selectedIds.length === 0) return null;

  const handleBulkUpdate = async () => {
    if (!field) return;
    setLoading(true);
    try {
      await api.post("/api/v1/bulk/update", {
        entity_type: entityType,
        ids: selectedIds,
        changes: { [field]: value },
      });
      setShowEdit(false);
      setField("");
      setValue("");
      onComplete();
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  const handleBulkDelete = async () => {
    if (!confirm(t("deleteConfirm", { count: selectedIds.length, entity: entityType }))) return;
    setLoading(true);
    try {
      await api.post("/api/v1/bulk/delete", {
        entity_type: entityType,
        ids: selectedIds,
      });
      onComplete();
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-background px-5 py-3 shadow-lg">
      <span className="text-sm font-medium">{t("selected", { count: selectedIds.length })}</span>

      <button onClick={() => setShowEdit(!showEdit)}
        className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
        <Pencil className="h-3.5 w-3.5" /> {t("edit")}
      </button>

      <button onClick={handleBulkDelete} disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {t("deleteSelected")}
      </button>

      <button onClick={onClear} className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>

      {showEdit && (
        <div className="absolute bottom-full left-0 mb-2 rounded-lg border bg-background p-3 shadow-lg w-80">
          <p className="text-sm font-medium mb-2">{t("bulkEdit")}</p>
          <div className="space-y-2">
            <input placeholder={t("fieldName")} value={field}
              onChange={(e) => setField(e.target.value)}
              className="w-full rounded-lg border px-3 py-1.5 text-sm" />
            <input placeholder={t("newValue")} value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-lg border px-3 py-1.5 text-sm" />
            <button onClick={handleBulkUpdate} disabled={loading || !field}
              className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {loading ? t("updating") : t("updateCount", { count: selectedIds.length })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
