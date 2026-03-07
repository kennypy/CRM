"use client";

import { cn } from "@/lib/utils";

interface ConflictRecord {
  id: string;
  label: string;
  fields: Record<string, unknown>;
}

interface MergeConflict {
  entityType: string;
  sourceRecord: ConflictRecord;
  targetRecord: ConflictRecord;
  matchKey: string;
  conflictingFields: string[];
}

type Resolution = {
  entityType: string;
  matchKey: string;
  action: "keep_source" | "keep_target" | "merge_fields";
  fieldOverrides?: Record<string, "source" | "target">;
};

const ENTITY_LABELS: Record<string, string> = {
  user: "User",
  contact: "Contact",
  company: "Company",
  sequence: "Sequence",
  automation: "Automation",
  custom_object: "Custom Object",
  custom_field: "Custom Field",
};

export function MergeConflictRow({
  conflict,
  resolution,
  onResolve,
  sourceName,
  targetName,
}: {
  conflict: MergeConflict;
  resolution?: Resolution;
  onResolve: (res: Resolution) => void;
  sourceName: string;
  targetName: string;
}) {
  const allFields = Object.keys({
    ...conflict.sourceRecord.fields,
    ...conflict.targetRecord.fields,
  });

  const setAction = (action: Resolution["action"]) => {
    onResolve({
      entityType: conflict.entityType,
      matchKey: conflict.matchKey,
      action,
      fieldOverrides: action === "merge_fields" ? resolution?.fieldOverrides : undefined,
    });
  };

  const setFieldOverride = (field: string, choice: "source" | "target") => {
    const overrides = { ...resolution?.fieldOverrides, [field]: choice };
    onResolve({
      entityType: conflict.entityType,
      matchKey: conflict.matchKey,
      action: "merge_fields",
      fieldOverrides: overrides,
    });
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {ENTITY_LABELS[conflict.entityType] ?? conflict.entityType}
          </span>
          <span className="text-sm font-medium">{conflict.matchKey}</span>
        </div>
        {conflict.conflictingFields.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {conflict.conflictingFields.length} field{conflict.conflictingFields.length !== 1 ? "s" : ""} differ
          </span>
        )}
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 divide-x">
        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Source: {sourceName}</p>
          {allFields.map((field) => {
            const value = String(conflict.sourceRecord.fields[field] ?? "—");
            const isConflict = conflict.conflictingFields.includes(field);
            const isChosen = resolution?.action === "merge_fields" && resolution?.fieldOverrides?.[field] === "source";
            return (
              <div
                key={field}
                className={cn(
                  "flex justify-between py-1 px-2 rounded text-sm",
                  isConflict && "bg-amber-50",
                  isChosen && "ring-2 ring-primary/50"
                )}
              >
                <span className="text-muted-foreground">{field}</span>
                <span className={cn("font-medium", isConflict && "text-amber-700")}>
                  {value}
                  {isConflict && resolution?.action === "merge_fields" && (
                    <button
                      onClick={() => setFieldOverride(field, "source")}
                      className="ml-2 text-xs text-primary hover:underline"
                    >
                      use
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Target: {targetName}</p>
          {allFields.map((field) => {
            const value = String(conflict.targetRecord.fields[field] ?? "—");
            const isConflict = conflict.conflictingFields.includes(field);
            const isChosen = resolution?.action === "merge_fields" && resolution?.fieldOverrides?.[field] === "target";
            return (
              <div
                key={field}
                className={cn(
                  "flex justify-between py-1 px-2 rounded text-sm",
                  isConflict && "bg-amber-50",
                  isChosen && "ring-2 ring-primary/50"
                )}
              >
                <span className="text-muted-foreground">{field}</span>
                <span className={cn("font-medium", isConflict && "text-amber-700")}>
                  {value}
                  {isConflict && resolution?.action === "merge_fields" && (
                    <button
                      onClick={() => setFieldOverride(field, "target")}
                      className="ml-2 text-xs text-primary hover:underline"
                    >
                      use
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resolution actions */}
      <div className="flex items-center gap-2 px-5 py-3 border-t bg-muted/20">
        <span className="text-xs text-muted-foreground mr-2">Resolution:</span>
        {(["keep_source", "keep_target", "merge_fields"] as const).map((action) => {
          const labels = {
            keep_source: `Keep ${sourceName}`,
            keep_target: `Keep ${targetName}`,
            merge_fields: "Merge Fields",
          };
          return (
            <button
              key={action}
              onClick={() => setAction(action)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                resolution?.action === action
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {labels[action]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
