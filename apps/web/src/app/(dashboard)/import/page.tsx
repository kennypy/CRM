"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Upload, FileSpreadsheet, ArrowRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type Step = "upload" | "mapping" | "preview" | "processing" | "done";

interface ImportJob {
  id: string;
  entityType: string;
  fileName: string;
  status: string;
  totalRows: number;
  processedRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

export default function ImportPage() {
  const t = useTranslations("import");
  const tc = useTranslations("common");
  const [step, setStep] = useState<Step>("upload");
  const [entityType, setEntityType] = useState("contact");
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [error, setError] = useState("");

  const entityTypes = ["contact", "company", "deal", "activity", "task"];
  const crmFields: Record<string, string[]> = {
    contact: ["first_name", "last_name", "email", "phone", "title", "company", "linkedin_url"],
    company: ["name", "domain", "industry", "employee_count", "revenue", "phone", "address"],
    deal: ["name", "value", "stage", "close_date", "company", "owner"],
    activity: ["type", "title", "description", "date", "contact", "company"],
    task: ["title", "description", "due_date", "priority", "status", "assignee"],
  };

  useEffect(() => {
    api.get("/api/v1/import").then((res) => setJobs(res.data ?? [])).catch(() => {});
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const format = file.name.endsWith(".xlsx") ? "xlsx" : file.name.endsWith(".json") ? "json" : "csv";

    // Parse file locally to extract columns
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let cols: string[] = [];
      let totalRows = 0;

      if (format === "csv") {
        const text = ev.target?.result as string;
        const lines = text.split("\n").filter(Boolean);
        totalRows = lines.length - 1;
        cols = lines[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      } else if (format === "json") {
        const data = JSON.parse(ev.target?.result as string);
        const arr = Array.isArray(data) ? data : data.data ?? data.records ?? [];
        totalRows = arr.length;
        if (arr.length > 0) cols = Object.keys(arr[0]);
      }

      setColumns(cols);

      // Auto-map columns to CRM fields
      const autoMap: Record<string, string> = {};
      const available = crmFields[entityType] ?? [];
      for (const col of cols) {
        const lower = col.toLowerCase().replace(/[\s_-]+/g, "_");
        const match = available.find((f) => f === lower || f.includes(lower) || lower.includes(f));
        if (match) autoMap[col] = match;
      }
      setMapping(autoMap);

      try {
        const res = await api.post("/api/v1/import/upload", {
          entity_type: entityType,
          file_name: file.name,
          file_format: format,
          total_rows: totalRows,
          columns: cols,
        });
        setJobId(res.data.id);
        setStep("mapping");
      } catch (err: any) {
        setError(err.message ?? "Upload failed");
      }
    };
    reader.readAsText(file);
  };

  const startProcessing = async () => {
    try {
      await api.post(`/api/v1/import/${jobId}/mapping`, {
        column_mapping: mapping,
      });
      setStep("processing");
      pollStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const pollStatus = async () => {
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/api/v1/import/${jobId}`);
        setJob(res.data);
        if (["completed", "failed", "cancelled"].includes(res.data.status)) {
          clearInterval(interval);
          setStep("done");
        }
      } catch {}
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {([
          { key: "upload", label: t("upload") },
          { key: "mapping", label: t("mapping") },
          { key: "processing", label: t("processing") },
          { key: "done", label: t("complete") },
        ] as const).map(({ key, label }, i) => (
          <div key={key} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            <span className={cn(
              step === key ? "text-primary font-medium" : "text-muted-foreground")}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Upload step */}
      {step === "upload" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {entityTypes.map((et) => (
              <button key={et} onClick={() => setEntityType(et)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                  entityType === et ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                {t(et as any)}
              </button>
            ))}
          </div>
          <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 cursor-pointer hover:bg-muted/50 transition-colors">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("dragDrop")}</p>
            <input type="file" accept=".csv,.xlsx,.json" className="hidden" onChange={handleFileSelect} />
          </label>
        </div>
      )}

      {/* Mapping step */}
      {step === "mapping" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("mapColumns", { fileName })}
          </p>
          <div className="rounded-lg border divide-y">
            {columns.map((col) => (
              <div key={col} className="flex items-center gap-4 px-4 py-3">
                <span className="w-1/3 text-sm font-medium">{col}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <select value={mapping[col] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                  className="flex-1 rounded-lg border px-3 py-1.5 text-sm">
                  <option value="">{t("skip")}</option>
                  {(crmFields[entityType] ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button onClick={startProcessing}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            {t("startImport")}
          </button>
        </div>
      )}

      {/* Processing step */}
      {step === "processing" && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("processingImport")}</p>
          {job && (
            <p className="text-xs text-muted-foreground">{t("rowProgress", { current: job.processedRows ?? 0, total: job.totalRows ?? 0 })}</p>
          )}
        </div>
      )}

      {/* Done step */}
      {step === "done" && job && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {job.status === "completed" ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            <p className="text-sm font-medium capitalize">{job.status}</p>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Created", value: job.createdRows },
              { label: "Updated", value: job.updatedRows },
              { label: "Skipped", value: job.skippedRows },
              { label: "Errors", value: job.errorRows },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border p-3 text-center">
                <p className="text-lg font-semibold">{value ?? 0}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <button onClick={() => { setStep("upload"); setJobId(""); setJob(null); setError(""); }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            {t("importMore")}
          </button>
        </div>
      )}

      {/* Recent imports */}
      {jobs.length > 0 && step === "upload" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("recentImports")}</p>
          <div className="rounded-lg border divide-y">
            {jobs.slice(0, 5).map((j: any) => (
              <div key={j.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{j.fileName}</p>
                  <p className="text-xs text-muted-foreground">{j.entityType} &middot; {j.status}</p>
                </div>
                <span className={cn("text-xs font-medium rounded-full px-2 py-0.5",
                  j.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400" :
                  j.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-400" :
                  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-400")}>
                  {j.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
