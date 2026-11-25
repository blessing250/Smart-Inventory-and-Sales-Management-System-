import { randomUUID } from 'node:crypto';
import { realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import nodemailer from 'nodemailer';
import { productionAuthOrigin } from './server-config';
import { recoveryEmail } from '../../shared/validation/recovery-input';

export function recoveryOrigin() {
  const url = new URL(process.env.NEXTAUTH_URL ?? '');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const secure = url.protocol === 'https:';
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (!secure && (process.env.NODE_ENV === 'production' || !loopback || url.protocol !== 'http:'))) {
    throw new Error('Invalid recovery origin.');
  }
  return productionAuthOrigin() ?? url.origin;
}

export function recoveryTransport() {
  const email = recoveryEmail.safeParse(process.env.BIZFLOW_VERIFIED_RECOVERY_EMAIL);
  if (!email.success) return;
  const mode = process.env.BIZFLOW_RECOVERY_TRANSPORT;
  if (mode === 'file' && process.env.NODE_ENV !== 'production') {
    const directory = process.env.BIZFLOW_RECOVERY_OUTBOX;
    if (!directory || !isAbsolute(directory)) return;
    return { email: email.data, async send(to: string, link: string) {
      const target = await realpath(directory);
      const scope = relative(await realpath(process.cwd()), target);
      if (!scope || (!isAbsolute(scope) && scope !== '..' && !scope.startsWith('..' + sep))) throw new Error('Use a private outbox.');
      if (process.platform !== 'win32' && ((await stat(target)).mode & 0o077)) throw new Error('Restrict outbox permissions.');
      await writeFile(join(target, randomUUID() + '.txt'), 'To: ' + to + '\n\n' + message(link),
        { flag: 'wx', mode: 0o600 });
    } };
  }
  if (mode !== 'smtp') return;
  const host = process.env.BIZFLOW_SMTP_HOST?.trim();
  const port = Number(process.env.BIZFLOW_SMTP_PORT ?? 587);
  const user = process.env.BIZFLOW_SMTP_USER;
  const pass = process.env.BIZFLOW_SMTP_PASSWORD;
  const from = recoveryEmail.safeParse(process.env.BIZFLOW_SMTP_FROM);
  if (!host || ![465, 587].includes(port) || !user || !pass || !from.success) return;

  return { email: email.data, async send(to: string, link: string) {
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: true, auth: { user, pass },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
      logger: false, debug: false,
    });
    const result = await transport.sendMail({
      from: { name: 'BizFlow Jewelry', address: from.data }, to,
      subject: 'Reset your BizFlow Jewelry password', text: message(link),
    });
    if (!result.accepted.length) throw new Error('Recovery delivery failed.');
  } };
}

function message(link: string) {
  return 'BizFlow Jewelry\n\nUse this link to reset your password:\n' + link +
    '\n\nThe link expires in 30 minutes. If you did not request a reset, ignore this email.';
}
