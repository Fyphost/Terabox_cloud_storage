import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  renderResetEmail,
  renderVerifyEmail,
  renderWelcomeEmail,
} from './templates.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) {
    logger.warn('SMTP_HOST not configured; emails will be logged instead of sent.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
  return transporter;
}

export async function verifySmtpConnection(): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.verify();
    return true;
  } catch (err) {
    logger.error({ err }, 'SMTP connection verify failed');
    return false;
  }
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function send(args: SendArgs): Promise<void> {
  const t = getTransporter();
  if (!t) {
    logger.info({ to: args.to, subject: args.subject }, 'email (SMTP disabled): would send');
    return;
  }
  try {
    await t.sendMail({
      from: env.SMTP_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
  } catch (err) {
    logger.error({ err, to: args.to, subject: args.subject }, 'email send failed');
    // Don't throw — auth flows should not block on transient SMTP failures.
  }
}

export async function sendVerificationEmail(args: {
  to: string;
  displayName?: string | null;
  token: string;
}): Promise<void> {
  const url = `${env.WEB_BASE_URL}/auth/verify?token=${encodeURIComponent(args.token)}`;
  const expiresInHours = Math.round(env.EMAIL_TOKEN_TTL_SEC / 3600);
  const tpl = renderVerifyEmail({
    displayName: args.displayName ?? null,
    verifyUrl: url,
    expiresInHours,
    appUrl: env.WEB_BASE_URL,
  });
  await send({ to: args.to, ...tpl });
}

export async function sendPasswordResetEmail(args: {
  to: string;
  displayName?: string | null;
  token: string;
}): Promise<void> {
  const url = `${env.WEB_BASE_URL}/auth/reset?token=${encodeURIComponent(args.token)}`;
  const expiresInMinutes = Math.max(1, Math.round(env.EMAIL_TOKEN_TTL_SEC / 60));
  const tpl = renderResetEmail({
    displayName: args.displayName ?? null,
    resetUrl: url,
    expiresInMinutes,
    appUrl: env.WEB_BASE_URL,
  });
  await send({ to: args.to, ...tpl });
}

export async function sendWelcomeEmail(args: {
  to: string;
  displayName?: string | null;
}): Promise<void> {
  const tpl = renderWelcomeEmail({
    displayName: args.displayName ?? null,
    appUrl: env.WEB_BASE_URL,
  });
  await send({ to: args.to, ...tpl });
}
