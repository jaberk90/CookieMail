import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { simpleParser } from 'mailparser';
import type { MailProvider, MailSummary } from './types.js';
import { cleanHtml } from './templates.js';
export function imapSmtpProvider(config: {
  imap: {
    host: string;
    port?: number;
    auth: { user: string; pass?: string; accessToken?: string };
    mailbox?: string;
  };
  smtp: SMTPTransport.Options;
  from: string;
}): MailProvider {
  const transport = nodemailer.createTransport({
    ...config.smtp,
    requireTLS: true,
    tls: { ...config.smtp.tls, rejectUnauthorized: true },
    connectionTimeout: 15000,
    socketTimeout: 45000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  async function inbox<T>(run: (client: ImapFlow) => Promise<T>) {
    const client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port || 993,
      secure: true,
      auth: config.imap.auth,
      logger: false,
      connectionTimeout: 15000,
      socketTimeout: 45000,
    });
    client.on('error', () => {});
    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.imap.mailbox || 'INBOX');
      try {
        return await run(client);
      } finally {
        lock.release();
      }
    } finally {
      client.close();
    }
  }
  const uid = (client: ImapFlow, id: string) => {
    const [validity, n] = id.split('.');
    if (
      !client.mailbox ||
      String(client.mailbox.uidValidity) !== validity ||
      !/^\d+$/.test(n) ||
      !Number.isSafeInteger(Number(n)) ||
      Number(n) < 1
    )
      throw new Error('Message identifier expired; refresh inbox');
    return Number(n);
  };
  const summary = (client: ImapFlow, m: any): MailSummary => ({
    id: `${client.mailbox && client.mailbox.uidValidity}.${m.uid}`,
    from: m.envelope?.from?.[0]?.address || '',
    fromName: m.envelope?.from?.[0]?.name || '',
    subject: m.envelope?.subject || '(No subject)',
    date: new Date(m.internalDate || Date.now()).toISOString(),
    unread: !m.flags?.has('\\Seen'),
  });
  return {
    async list({ limit, query, unread }) {
      return inbox(async (client) => {
        const found = await client.search(
          {
            ...(unread ? { seen: false } : {}),
            ...(query ? { or: [{ subject: query }, { from: query }] } : {}),
          },
          { uid: true },
        );
        const ids = (found || []).sort((a, b) => b - a).slice(0, limit);
        if (!ids.length) return [];
        const out: MailSummary[] = [];
        for await (const m of client.fetch(
          ids,
          { envelope: true, flags: true, internalDate: true },
          { uid: true },
        ))
          out.push(summary(client, m));
        return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      });
    },
    async get(id) {
      return inbox(async (client) => {
        const n = uid(client, id);
        const meta = await client.fetchOne(
          n,
          { size: true, envelope: true, flags: true, internalDate: true },
          { uid: true },
        );
        if (!meta) throw new Error('Message not found');
        if ((meta.size || 0) > 2_000_000) throw new Error('Message exceeds the 2 MB reader limit');
        const full = await client.fetchOne(n, { source: true }, { uid: true });
        if (!full || !full.source) throw new Error('Message unavailable');
        const mail = await simpleParser(full.source, {
          skipHtmlToText: true,
          skipTextToHtml: true,
        });
        return {
          ...summary(client, meta),
          text: mail.text || '',
          html: mail.html ? cleanHtml(mail.html) : undefined,
          messageId: mail.messageId,
          replyTo: mail.replyTo?.value[0]?.address || mail.from?.value[0]?.address,
        };
      });
    },
    async markRead(id) {
      await inbox(async (client) => {
        await client.messageFlagsAdd(uid(client, id), ['\\Seen'], { uid: true });
      });
    },
    async send(m) {
      const info = await transport.sendMail({
        from: config.from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        html: m.html,
        messageId: m.messageId,
        ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.inReplyTo } : {}),
        ...(m.unsubscribeUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${m.unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            }
          : {}),
      });
      if (info.rejected?.length) throw new Error('Recipient rejected by SMTP');
    },
    async close() {
      transport.close();
    },
  };
}
