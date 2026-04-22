"use client";

import { useRef, useState } from "react";
import { Paperclip, X, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface Attachment {
  url:      string;
  filename: string;
  size:     number;
}

interface Props {
  /** Currently attached files (the parent owns the list). */
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
}

const MAX_UPLOAD_MB = 25;

/**
 * File picker that uploads each selected file directly to S3 via a
 * pre-signed PUT URL minted by /api/v1/support-tickets/attachments. Files
 * never proxy through the Next.js server or the CRM API gateway, which
 * means (a) the gateway's bodyLimit doesn't apply, (b) the agent's
 * upload bandwidth is the only bottleneck, and (c) retries on a partial
 * upload are cheap.
 */
export function AttachmentUploader({ attachments, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError]         = useState<string | null>(null);

  async function uploadOne(file: File): Promise<Attachment> {
    // 1. Ask the gateway for a pre-signed URL. It validates size +
    //    content-type server-side so we don't rely on client-side checks.
    const presignRes = await api.post("/api/v1/support-tickets/attachments", {
      filename:    file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes:   file.size,
    });
    if (!presignRes.ok) {
      const body = await presignRes.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${presignRes.status}`);
    }
    const { uploadUrl, publicUrl } = await presignRes.json();

    // 2. PUT the file bytes directly to S3. The signed URL carries the
    //    content-type and content-length constraints the gateway committed
    //    to, so S3 rejects any mismatch — no need to trust the client.
    const putRes = await fetch(uploadUrl, {
      method:  "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body:    file,
    });
    if (!putRes.ok) {
      throw new Error(`S3 upload failed: HTTP ${putRes.status}`);
    }

    return { url: publicUrl, filename: file.name, size: file.size };
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setError(`${file.name} is larger than ${MAX_UPLOAD_MB}MB`);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const att = await uploadOne(file);
        onChange([...attachments, att]);
      } catch (e: any) {
        setError(`${file.name}: ${e?.message ?? "upload failed"}`);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(att: Attachment) {
    // Local-only remove — the S3 object stays until a lifecycle policy
    // expires it. Deleting on remove would be nice but risks races against
    // a reply the agent is about to send.
    onChange(attachments.filter((a) => a.url !== att.url));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Attach file
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(e) => onFiles(e.target.files)}
          className="hidden"
        />

        {attachments.map((att) => (
          <span
            key={att.url}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]"
            title={att.url}
          >
            <Paperclip className="h-3 w-3 text-muted-foreground" />
            <span className="max-w-[180px] truncate">{att.filename}</span>
            <span className="text-muted-foreground">{formatSize(att.size)}</span>
            <button
              type="button"
              onClick={() => remove(att)}
              disabled={disabled}
              className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {uploading.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="max-w-[180px] truncate">{name}</span>
          </span>
        ))}
      </div>

      {error && (
        <div className={cn("flex items-center gap-1.5 text-[11px] text-red-600")}>
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
