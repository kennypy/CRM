import { NextRequest, NextResponse } from "next/server";

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";

/**
 * POST /api/start
 *
 * Auto-provision signup flow:
 *  1. User enters only their email
 *  2. We generate a workspace slug from the email domain
 *  3. We generate a secure random password
 *  4. We call the auth service to create the tenant + admin user
 *  5. We email them their credentials
 *
 * No login is performed — user must check email and log in.
 */
export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: { message: "A valid email address is required" } },
      { status: 400 }
    );
  }

  // Derive workspace name/slug from email
  const domain = email.split("@")[1].split(".")[0];
  const localPart = email.split("@")[0];
  const tenantName = `${domain.charAt(0).toUpperCase() + domain.slice(1)}'s Workspace`;
  // Make slug unique-ish by appending part of the local
  const slugBase = domain.replace(/[^a-z0-9]/g, "");
  const slugSuffix = localPart
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
  const tenantSlug = `${slugBase}-${slugSuffix}`;

  // Generate a random password that meets requirements
  const password = generatePassword();

  // Derive first/last name from email
  const nameParts = localPart.split(/[._-]/);
  const firstName =
    nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1);
  const lastName =
    nameParts.length > 1
      ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1)
      : "User";

  // Register via auth service
  let upstream: Response;
  try {
    upstream = await fetch(`${AUTH_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantName,
        tenantSlug,
        firstName,
        lastName,
        email,
        password,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: { message: "Service temporarily unavailable. Please try again." } },
      { status: 503 }
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!upstream.ok) {
    const errMsg =
      (data?.error as any)?.message ?? "Registration failed. Please try again.";
    // If slug is taken, retry with a random suffix
    if (upstream.status === 409) {
      return retryWithRandomSlug(
        AUTH_URL,
        tenantName,
        slugBase,
        firstName,
        lastName,
        email,
        password
      );
    }
    return NextResponse.json(
      { error: { message: errMsg } },
      { status: upstream.status }
    );
  }

  // Send credentials email via auth service's welcome email
  // The auth service already sends a welcome email, but we need to send credentials too
  // We'll call a separate endpoint or handle it here
  await sendCredentialsEmail(email, firstName, tenantSlug, password);

  return NextResponse.json({
    success: true,
    data: { message: "Workspace created. Check your email for login credentials." },
  });
}

async function retryWithRandomSlug(
  authUrl: string,
  tenantName: string,
  slugBase: string,
  firstName: string,
  lastName: string,
  email: string,
  password: string
): Promise<NextResponse> {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const tenantSlug = `${slugBase}-${randomSuffix}`;

  try {
    const upstream = await fetch(`${authUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantName,
        tenantSlug,
        firstName,
        lastName,
        email,
        password,
      }),
    });

    if (!upstream.ok) {
      const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
      return NextResponse.json(
        { error: { message: (data?.error as any)?.message ?? "Registration failed" } },
        { status: upstream.status }
      );
    }

    await sendCredentialsEmail(email, firstName, tenantSlug, password);

    return NextResponse.json({
      success: true,
      data: { message: "Workspace created. Check your email for login credentials." },
    });
  } catch {
    return NextResponse.json(
      { error: { message: "Service temporarily unavailable" } },
      { status: 503 }
    );
  }
}

/** Generate a password that meets the auth service's requirements */
function generatePassword(): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const special = "!@#$%&*";
  const all = lower + upper + digits + special;

  // Guarantee at least one of each required type
  let pw = "";
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += special[Math.floor(Math.random() * special.length)];

  // Fill to 16 chars
  for (let i = pw.length; i < 16; i++) {
    pw += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle
  return pw
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/** Send an email with login credentials using the internal email service or direct Resend */
async function sendCredentialsEmail(
  to: string,
  firstName: string,
  tenantSlug: string,
  password: string
): Promise<void> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const loginUrl = `${appUrl}/login`;

  // Try Resend directly if API key is available
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "NexCRM <noreply@nexcrm.io>";

  const subject = `Your NexCRM workspace is ready, ${firstName}!`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#0f172a">Your NexCRM workspace is ready!</h1>
      <p>Hi ${firstName}, your free trial workspace has been created.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:24px 0">
        <p style="margin:0 0 8px"><strong>Workspace:</strong> ${tenantSlug}</p>
        <p style="margin:0 0 8px"><strong>Email:</strong> ${to}</p>
        <p style="margin:0"><strong>Password:</strong> ${password}</p>
      </div>
      <p style="color:#ef4444;font-size:13px">Change your password after your first login.</p>
      <p style="margin:32px 0">
        <a href="${loginUrl}"
           style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Log in to NexCRM
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">
        Your 14-day free trial starts now. No credit card required.
      </p>
    </div>`;

  const text = `Your NexCRM workspace is ready!\n\nWorkspace: ${tenantSlug}\nEmail: ${to}\nPassword: ${password}\n\nLog in: ${loginUrl}\n\nChange your password after first login.`;

  if (resendKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, html, text }),
      });
    } catch (err) {
      console.error("[start] Failed to send credentials email:", err);
    }
  } else {
    // Dev mode: log to console
    console.log(`\n[start:dev] ──────────────────────────────────────────`);
    console.log(`  To:        ${to}`);
    console.log(`  Subject:   ${subject}`);
    console.log(`  Workspace: ${tenantSlug}`);
    console.log(`  Password:  ${password}`);
    console.log(`──────────────────────────────────────────────────────\n`);
  }
}
