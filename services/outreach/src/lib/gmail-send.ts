/**
 * Send email via Gmail API using a stored OAuth access token.
 *
 * Security:
 *  - Access tokens are decrypted only in memory, never logged.
 *  - All headers are built server-side — no client-supplied header values.
 *  - List-Unsubscribe header is injected on all outbound emails.
 */

import { google } from "googleapis";

export interface SendEmailOptions {
  accessToken:  string;
  from:         string;
  to:           string[];
  cc?:          string[];
  bcc?:         string[];
  subject:      string;
  bodyText:     string;
  inReplyTo?:   string;
  /** Injected automatically — the unsubscribe route in this service */
  unsubscribeUrl: string;
}

export interface GmailSendResult {
  messageId: string;
  threadId:  string;
}

/**
 * Reject header values containing CR/LF or other control characters.
 * Prevents SMTP/RFC-2822 header injection (e.g. a crafted `subject` smuggling
 * an extra `Bcc:` header or a forged body) when values flow into the raw
 * header block below.
 */
function sanitizeHeaderValue(name: string, value: string): string {
  // Reject CR, LF and other C0/DEL control characters to prevent
  // RFC-2822 header injection (e.g. a crafted subject smuggling a Bcc).
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      throw new Error(`Illegal control character in email ${name} header`);
    }
  }
  return value;
}

/**
 * Build an RFC-2822 message and send it via the Gmail API.
 * Returns the Gmail messageId and threadId for storage.
 */
export async function sendViaGmail(opts: SendEmailOptions): Promise<GmailSendResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: opts.accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const headers: Record<string, string> = {
    From:    sanitizeHeaderValue("From", opts.from),
    To:      sanitizeHeaderValue("To", opts.to.join(", ")),
    Subject: sanitizeHeaderValue("Subject", opts.subject),
    "Content-Type": "text/plain; charset=UTF-8",
    "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  if (opts.cc?.length)    headers["Cc"]          = sanitizeHeaderValue("Cc", opts.cc.join(", "));
  if (opts.bcc?.length)   headers["Bcc"]         = sanitizeHeaderValue("Bcc", opts.bcc.join(", "));
  if (opts.inReplyTo)     headers["In-Reply-To"] = sanitizeHeaderValue("In-Reply-To", opts.inReplyTo);

  const headerStr = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");

  const raw = Buffer.from(`${headerStr}\r\n\r\n${opts.bodyText}`)
    .toString("base64url");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  if (!res.data.id) throw new Error("Gmail API did not return a message ID");
  return {
    messageId: res.data.id,
    threadId:  res.data.threadId ?? res.data.id,
  };
}
