/**
 * Send email via Microsoft Graph API using a stored OAuth access token.
 *
 * Security:
 *  - Access tokens decrypted only in memory, never logged.
 *  - List-Unsubscribe header injected on all outbound emails.
 */

export interface OutlookSendOptions {
  accessToken:    string;
  to:             string[];
  cc?:            string[];
  bcc?:           string[];
  subject:        string;
  bodyText:       string;
  inReplyTo?:     string;   // itemId of the message being replied to
  unsubscribeUrl: string;
}

export interface OutlookSendResult {
  messageId: string;
}

/**
 * Send a message via the Microsoft Graph /sendMail endpoint.
 */
export async function sendViaOutlook(opts: OutlookSendOptions): Promise<OutlookSendResult> {
  const toRecipients  = opts.to.map(emailToGraphRecipient);
  const ccRecipients  = (opts.cc  ?? []).map(emailToGraphRecipient);
  const bccRecipients = (opts.bcc ?? []).map(emailToGraphRecipient);

  const message: Record<string, unknown> = {
    subject: opts.subject,
    body: {
      contentType: "Text",
      content: opts.bodyText,
    },
    toRecipients,
    ccRecipients:  ccRecipients.length  ? ccRecipients  : undefined,
    bccRecipients: bccRecipients.length ? bccRecipients : undefined,
    internetMessageHeaders: [
      { name: "List-Unsubscribe",      value: `<${opts.unsubscribeUrl}>` },
      { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    ],
  };

  // If replying, use the /reply endpoint instead to preserve thread
  if (opts.inReplyTo) {
    const replyRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${opts.inReplyTo}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, comment: opts.bodyText }),
      },
    );
    if (!replyRes.ok) {
      const text = await replyRes.text();
      throw new Error(`MS Graph reply failed: ${replyRes.status} ${text.slice(0, 200)}`);
    }
    return { messageId: opts.inReplyTo };
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MS Graph sendMail failed: ${res.status} ${text.slice(0, 200)}`);
  }

  // MS Graph /sendMail returns 202 with no body — extract ID from Location header
  const location = res.headers.get("Location") ?? "";
  const idMatch  = location.match(/messages\/([^/]+)$/);
  return { messageId: idMatch?.[1] ?? crypto.randomUUID() };
}

function emailToGraphRecipient(email: string) {
  return { emailAddress: { address: email } };
}
