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
 * Build an RFC-2822 message and send it via the Gmail API.
 * Returns the Gmail messageId and threadId for storage.
 */
export async function sendViaGmail(opts: SendEmailOptions): Promise<GmailSendResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: opts.accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const headers: Record<string, string> = {
    From:    opts.from,
    To:      opts.to.join(", "),
    Subject: opts.subject,
    "Content-Type": "text/plain; charset=UTF-8",
    "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  if (opts.cc?.length)    headers["Cc"]          = opts.cc.join(", ");
  if (opts.bcc?.length)   headers["Bcc"]         = opts.bcc.join(", ");
  if (opts.inReplyTo)     headers["In-Reply-To"] = opts.inReplyTo;

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
