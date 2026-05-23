/**
 * HTML email templates.
 *
 * Inline-styled, table-based for client compatibility (Outlook/Gmail/Apple
 * Mail/iOS Mail). Light theme, blue brand accents to match the SaaS UI.
 */

export interface BrandedTemplate {
  appName?: string;
  appUrl?: string;
}

export interface VerifyEmailParams extends BrandedTemplate {
  displayName?: string | null;
  verifyUrl: string;
  expiresInHours: number;
}

export interface ResetEmailParams extends BrandedTemplate {
  displayName?: string | null;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface WelcomeEmailParams extends BrandedTemplate {
  displayName?: string | null;
  appUrl: string;
}

const DEFAULT_BRAND: Required<BrandedTemplate> = {
  appName: 'Fyphost',
  appUrl: 'https://fyphost.app',
};

function shell(brand: Required<BrandedTemplate>, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${brand.appName}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
            <tr>
              <td style="padding:28px 32px 16px 32px;">
                <a href="${brand.appUrl}" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:#0f172a;font-weight:600;font-size:16px;">
                  <span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);"></span>
                  ${brand.appName}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px;font-size:15px;line-height:1.55;color:#0f172a;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;color:#64748b;font-size:12px;">
                You're receiving this email because someone used this address on ${brand.appName}. If that wasn't you, you can safely ignore this message.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
    <tr><td align="center" style="border-radius:10px;background:#2563eb;">
      <a href="${url}" style="display:inline-block;padding:12px 22px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;">${label}</a>
    </td></tr>
  </table>`;
}

function greeting(name: string | null | undefined): string {
  return name ? `Hi ${escapeHtml(name)},` : 'Hi there,';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function urlFallback(url: string): string {
  return `<p style="margin:8px 0 0 0;color:#64748b;font-size:13px;">If the button doesn't work, paste this link into your browser:<br/><a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a></p>`;
}

// ─────────────────────────────────────────────────────────────────────────────

export function renderVerifyEmail(p: VerifyEmailParams): { subject: string; html: string; text: string } {
  const brand = { ...DEFAULT_BRAND, ...p };
  const html = shell(brand, `
    <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;letter-spacing:-0.01em;">Confirm your email</h1>
    <p style="margin:0;">${greeting(p.displayName)}</p>
    <p style="margin:12px 0 0 0;">Welcome to ${brand.appName}. Click the button below to verify your email address and finish creating your account.</p>
    ${button('Verify email', p.verifyUrl)}
    <p style="margin:0;color:#64748b;font-size:13px;">This link expires in ${p.expiresInHours} hours.</p>
    ${urlFallback(p.verifyUrl)}
  `);
  const text = `Verify your email for ${brand.appName}\n\nOpen this link to verify your account (expires in ${p.expiresInHours}h):\n${p.verifyUrl}`;
  return { subject: `Verify your email for ${brand.appName}`, html, text };
}

export function renderResetEmail(p: ResetEmailParams): { subject: string; html: string; text: string } {
  const brand = { ...DEFAULT_BRAND, ...p };
  const html = shell(brand, `
    <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;letter-spacing:-0.01em;">Reset your password</h1>
    <p style="margin:0;">${greeting(p.displayName)}</p>
    <p style="margin:12px 0 0 0;">We received a request to reset the password for your ${brand.appName} account. Use the button below to set a new password.</p>
    ${button('Reset password', p.resetUrl)}
    <p style="margin:0;color:#64748b;font-size:13px;">This link expires in ${p.expiresInMinutes} minutes. If you didn't request a reset, you can ignore this message.</p>
    ${urlFallback(p.resetUrl)}
  `);
  const text = `Reset your ${brand.appName} password\n\nOpen this link to reset (expires in ${p.expiresInMinutes} minutes):\n${p.resetUrl}`;
  return { subject: `Reset your ${brand.appName} password`, html, text };
}

export function renderWelcomeEmail(p: WelcomeEmailParams): { subject: string; html: string; text: string } {
  const brand = { ...DEFAULT_BRAND, ...p };
  const html = shell(brand, `
    <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;letter-spacing:-0.01em;">Welcome to ${brand.appName}</h1>
    <p style="margin:0;">${greeting(p.displayName)}</p>
    <p style="margin:12px 0 0 0;">Your account is ready. Paste a TeraBox link, stream instantly, and save what you want — no ads, no fake download buttons, no throttled cloud-host UX.</p>
    ${button('Open ' + brand.appName, p.appUrl)}
    <p style="margin:0;color:#64748b;font-size:13px;">Need help? Just reply to this email.</p>
  `);
  const text = `Welcome to ${brand.appName}.\n\nGet started: ${p.appUrl}`;
  return { subject: `Welcome to ${brand.appName}`, html, text };
}
