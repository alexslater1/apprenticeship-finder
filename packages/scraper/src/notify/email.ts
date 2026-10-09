import { createTransport } from 'nodemailer';
import type { Env } from '../env.ts';

export interface Mail {
  subject: string;
  html: string;
  text: string;
}

export function recipients(env: Env): string[] {
  return (env.DIGEST_TO ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /.+@.+\..+/.test(s));
}

export function canSend(env: Env): boolean {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && recipients(env).length);
}

/** Gmail SMTP with an app password (PLAN.md §9.3). */
export async function sendMail(env: Env, mail: Mail): Promise<string[]> {
  if (!canSend(env))
    throw new Error('Email not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, DIGEST_TO)');
  const port = Number(env.SMTP_PORT ?? 465);
  const transport = createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
  });
  const to = recipients(env);
  await transport.sendMail({
    from: { name: 'Apprenticeship Finder', address: env.SMTP_USER! },
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  return to;
}
