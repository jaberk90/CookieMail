import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { atomic, documents } from './store.js';
import {
  templateSchema,
  variables,
  renderTemplate,
  cleanHtml,
  escapeHtml,
  previewDocument,
} from './templates.js';
import type { CookieMailConfig, Subscriber, Template } from './types.js';
export { imapSmtpProvider } from './provider.js';
export { renderTemplate } from './templates.js';
export type * from './types.js';
export type { MailStore } from './store.js';
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const tag = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N} _-]+$/u);
const subscriberSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).default(''),
  email,
  tags: z.array(tag).max(12).default([]),
  consent: z.literal(true),
  source: z.string().trim().min(1).max(200),
});
const sendSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    to: email.optional(),
    tag: tag.optional(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s))
      .optional(),
    text: z.string().max(30000).optional(),
    html: z.string().max(60000).optional(),
    templateId: z.string().uuid().optional(),
    values: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), z.string().max(4000)).default({}),
    replyToId: z.string().max(100).optional(),
  })
  .refine((s) => Boolean(s.to) !== Boolean(s.tag), 'Choose one recipient or one tag');
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const rec = (v: unknown) => v as Record<string, unknown>;
function render(...args: Parameters<typeof renderTemplate>) {
  try {
    return renderTemplate(...args);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}
export function createCookieMail(config: CookieMailConfig) {
  const origin = new URL(config.publicOrigin);
  if (
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error('publicOrigin must be an exact HTTP(S) origin');
  const base = config.publicBasePath || '/mail-public';
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(base)) throw new Error('Invalid publicBasePath');
  const workspace = config.workspace || 'default';
  const store = config.store;
  let closed = false;
  const read = async (k: string) => (await store.read(workspace, k))?.value;
  async function all(prefix: string) {
    const out: Record<string, unknown>[] = [];
    for await (const d of documents(store, workspace, prefix)) {
      out.push(d.value);
      if (out.length > 5000)
        throw new HttpError(413, 'Workspace exceeds the first-version 5000-record list limit');
    }
    return out;
  }
  async function save(key: string, value: Record<string, unknown>) {
    return atomic(store, workspace, async (tx) => {
      await tx.get(key);
      tx.put(key, value);
      return value;
    });
  }
  const publicSubscriber = (v: Record<string, unknown>) =>
    ({
      id: v.id,
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      tags: v.tags,
      status: v.status,
      createdAt: v.createdAt,
    }) as Subscriber;
  async function subscribe(input: unknown) {
    const s = subscriberSchema.parse(input);
    const id = hash(s.email);
    return atomic(store, workspace, async (tx) => {
      const key = 'subscriber-' + id;
      const old = await tx.get(key);
      if (old?.status === 'unsubscribed')
        throw new HttpError(
          409,
          'Previously unsubscribed; verified re-consent is required outside this form',
        );
      const value = {
        ...old,
        ...s,
        id,
        tags: [...new Set([...((old?.tags as string[]) || []), ...s.tags])],
        status: 'subscribed',
        createdAt: old?.createdAt || new Date().toISOString(),
        consentAt: old?.consentAt || new Date().toISOString(),
        token: old?.token || randomBytes(32).toString('hex'),
      };
      if (value.tags.length > 12) throw new HttpError(400, 'At most 12 tags per subscriber');
      tx.put(key, value);
      return publicSubscriber(value);
    });
  }
  async function unsubscribe(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, 'Invalid unsubscribe link');
    const s = (await all('subscriber-')).find((s) => s.token === token);
    if (s)
      await atomic(store, workspace, async (tx) => {
        const key = 'subscriber-' + s.id;
        const current = await tx.get(key);
        if (current)
          tx.put(key, {
            ...current,
            status: 'unsubscribed',
            unsubscribedAt: new Date().toISOString(),
          });
      });
    return { ok: true };
  }
  async function saveTemplate(input: unknown, id: string = randomUUID()) {
    z.string().uuid().parse(id);
    const s = templateSchema.parse(input);
    if (new Set(s.blocks.map((b) => b.id)).size !== s.blocks.length)
      throw new HttpError(400, 'Duplicate block IDs');
    const item = {
      ...s,
      id,
      variables: variables(s.subject, s.blocks),
      updatedAt: new Date().toISOString(),
    };
    await save('template-' + id, item);
    return item;
  }
  async function queue(input: unknown) {
    const s = sendSchema.parse(input);
    const key = 'job-' + s.idempotencyKey;
    const fingerprint = hash(JSON.stringify(s));
    const existing = await read(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new HttpError(409, 'Idempotency key was used for a different message');
      return { id: existing.id, recipients: (existing.recipients as unknown[]).length };
    }
    const template = s.templateId
      ? ((await read('template-' + s.templateId)) as unknown as Template)
      : undefined;
    if (s.templateId && !template) throw new HttpError(404, 'Template not found');
    if (!template && (!s.subject || (!s.text && !s.html)))
      throw new HttpError(400, 'Subject and content required');
    let recipients = s.to
      ? [{ email: s.to }]
      : (await all('subscriber-'))
          .filter((v) => v.status === 'subscribed' && (v.tags as string[]).includes(s.tag!))
          .map((v) => ({ id: String(v.id), email: String(v.email) }));
    if (!recipients.length) throw new HttpError(400, 'This tag has no subscribed recipients');
    if (recipients.length > 500) throw new HttpError(413, 'At most 500 recipients per campaign');
    for (const r of recipients) {
      const sub = 'id' in r ? await read('subscriber-' + r.id) : undefined;
      if (template)
        render(template.subject, template.blocks, {
          ...s.values,
          ...(sub
            ? {
                firstName: String(sub.firstName),
                lastName: String(sub.lastName),
                email: String(sub.email),
              }
            : {}),
        });
    }
    let inReplyTo: string | undefined;
    if (s.replyToId) {
      if (s.tag) throw new HttpError(400, 'Cannot reply to a tag');
      const original = await config.provider.get(s.replyToId);
      const expected = original.replyTo || original.from;
      if (s.to !== expected.toLowerCase())
        throw new HttpError(400, 'Reply recipient must match the original sender');
      inReplyTo = original.messageId;
    }
    const job = {
      ...s,
      id: s.idempotencyKey,
      fingerprint,
      template: template || null,
      recipients,
      inReplyTo: inReplyTo || null,
      status: 'queued',
      cursor: 0,
      sent: 0,
      skipped: 0,
      createdAt: new Date().toISOString(),
      leaseUntil: 0,
    };
    return atomic(store, workspace, async (tx) => {
      const old = await tx.get(key);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new HttpError(409, 'Idempotency key conflict');
      } else tx.put(key, rec(job));
      return { id: job.id, recipients: recipients.length };
    });
  }
  /** Call from a trusted scheduled worker. No timers. Ambiguous sends stop for operator reconciliation. */
  async function flush(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be 1-50');
    let sent = 0,
      processed = 0,
      skipped = 0;
    for (const job of (await all('job-')).sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt)),
    )) {
      if (processed >= limit) break;
      const key = 'job-' + job.id;
      const owner = randomUUID();
      const claimed = await atomic(store, workspace, async (tx) => {
        const j = await tx.get(key);
        if (!j) return null;
        if (j.status === 'sending' && Number(j.leaseUntil) < Date.now()) {
          tx.put(key, {
            ...j,
            status: 'uncertain',
            error: 'Worker stopped during delivery. Check provider before resending.',
          });
          return null;
        }
        if (j.status !== 'queued') return null;
        const next = { ...j, status: 'sending', owner, leaseUntil: Date.now() + 300000 };
        tx.put(key, next);
        return next;
      });
      if (!claimed) continue;
      const j = claimed as any;
      try {
        while (j.cursor < j.recipients.length && processed < limit) {
          processed++;
          const recipient = j.recipients[j.cursor];
          const sub = recipient.id ? await read('subscriber-' + recipient.id) : undefined;
          if (recipient.id && sub?.status !== 'subscribed') {
            j.skipped++;
            skipped++;
          } else {
            const rendered = j.template
              ? render(j.template.subject, j.template.blocks, {
                  ...j.values,
                  ...(sub
                    ? {
                        firstName: String(sub.firstName),
                        lastName: String(sub.lastName),
                        email: String(sub.email),
                      }
                    : {}),
                })
              : {
                  subject: j.subject,
                  text: j.text || cleanHtml(j.html || '').replace(/<[^>]+>/g, ' '),
                  html: j.html ? cleanHtml(j.html) : undefined,
                };
            const unsubscribeUrl = sub
              ? `${origin.origin}${base}/unsubscribe?token=${sub.token}`
              : undefined;
            await config.provider.send({
              to: recipient.email,
              ...rendered,
              text: rendered.text + (unsubscribeUrl ? `\n\nUnsubscribe: ${unsubscribeUrl}` : ''),
              html: rendered.html
                ? rendered.html +
                  (unsubscribeUrl
                    ? `<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`
                    : '')
                : undefined,
              messageId: `<${hash(workspace).slice(0, 12)}.${j.id}.${j.cursor}@${origin.hostname}>`,
              inReplyTo: j.inReplyTo || undefined,
              unsubscribeUrl,
            });
            j.sent++;
            sent++;
          }
          j.cursor++;
          await atomic(store, workspace, async (tx) => {
            const current = await tx.get(key);
            if (current?.owner !== owner) throw new Error('Delivery lease lost');
            tx.put(key, {
              ...current,
              cursor: j.cursor,
              sent: j.sent,
              skipped: j.skipped,
              leaseUntil: Date.now() + 300000,
            });
          });
        }
        await atomic(store, workspace, async (tx) => {
          const current = await tx.get(key);
          if (current?.owner === owner)
            tx.put(key, {
              ...current,
              status: j.cursor === j.recipients.length ? 'completed' : 'queued',
              owner: null,
              leaseUntil: 0,
            });
        });
      } catch (e) {
        config.logger?.error('CookieMail delivery needs reconciliation', e);
        await atomic(store, workspace, async (tx) => {
          const current = await tx.get(key);
          if (current?.owner === owner)
            tx.put(key, {
              ...current,
              status: 'uncertain',
              owner: null,
              leaseUntil: 0,
              error:
                'Delivery could not be confirmed. Check your mail provider before creating a replacement send.',
            });
        });
      }
    }
    return { sent, skipped };
  }
  const router = express.Router();
  router.use((_req, res, next) => {
    if (closed) throw new HttpError(503, 'CookieMail closed');
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  router.use(
    rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  router.use(async (req, res, next) => {
    const user = await config.auth(req);
    if (!user || !['admin', 'viewer'].includes(user.role) || !user.id)
      throw new HttpError(401, 'Sign in with a mailbox operator account');
    res.locals.user = user;
    next();
  });
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (res.locals.user.role !== 'admin' && req.path !== '/preview')
        throw new HttpError(403, 'Administrator access required');
      if (req.get('X-CookieMail') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site')
        throw new HttpError(403, 'Write request rejected');
      const from = req.get('Origin');
      if (from !== undefined && from !== origin.origin)
        throw new HttpError(403, 'Origin does not match the configured publicOrigin');
      if (!req.is('application/json')) throw new HttpError(415, 'JSON required');
    }
    next();
  });
  router.use(express.json({ limit: '128kb' }));
  router.get('/bootstrap', async (_req, res) => {
    const subscribers = await all('subscriber-');
    res.json({
      user: res.locals.user,
      brand: config.brand || 'CookieMail',
      subscribers: subscribers.filter((s) => s.status === 'subscribed').length,
      tags: [...new Set(subscribers.flatMap((s) => s.tags as string[]))].sort(),
      templates: (await all('template-')).length,
    });
  });
  router.get('/inbox', async (req, res) =>
    res.json(
      await config.provider.list({
        limit: req.query.limit === '50' ? 50 : 25,
        query: z
          .string()
          .max(200)
          .parse(req.query.q || ''),
        unread: req.query.unread === 'true',
      }),
    ),
  );
  router.get('/inbox/:id', async (req, res) => {
    const m = await config.provider.get(String(req.params.id));
    res.json({ ...m, html: m.html ? cleanHtml(m.html) : undefined });
  });
  router.post('/inbox/:id/read', async (req, res) => {
    await config.provider.markRead(String(req.params.id));
    res.json({ ok: true });
  });
  router.get('/subscribers', async (_req, res) =>
    res.json((await all('subscriber-')).map(publicSubscriber)),
  );
  router.post('/subscribers', async (req, res) => res.status(201).json(await subscribe(req.body)));
  router.patch('/subscribers/:id', async (req, res) => {
    const data = z
      .object({
        tags: z.array(tag).max(12).optional(),
        status: z.literal('unsubscribed').optional(),
      })
      .strict()
      .parse(req.body);
    const key = 'subscriber-' + String(req.params.id);
    const result = await atomic(store, workspace, async (tx) => {
      const s = await tx.get(key);
      if (!s) throw new HttpError(404, 'Subscriber not found');
      const next = { ...s, ...data };
      tx.put(key, next);
      return next;
    });
    res.json(publicSubscriber(result));
  });
  router.get('/templates', async (_req, res) => res.json(await all('template-')));
  router.post('/templates', async (req, res) => res.status(201).json(await saveTemplate(req.body)));
  router.put('/templates/:id', async (req, res) =>
    res.json(await saveTemplate(req.body, String(req.params.id))),
  );
  router.post('/preview', async (req, res) => {
    const t = templateSchema.parse(req.body);
    const values = z.record(z.string(), z.string().max(4000)).parse(req.body.values || {});
    const rendered = render(t.subject, t.blocks, values);
    res.json({ ...rendered, document: previewDocument(rendered.html) });
  });
  router.post('/send', async (req, res) => res.status(202).json(await queue(req.body)));
  router.get('/outbox', async (_req, res) =>
    res.json(
      (await all('job-'))
        .map((j) => ({
          id: j.id,
          subject: (j.template as Template)?.subject || j.subject,
          tag: j.tag,
          to: j.to,
          recipients: (j.recipients as unknown[]).length,
          status: j.status,
          sent: j.sent,
          skipped: j.skipped,
          error: j.error,
          createdAt: j.createdAt,
        }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    ),
  );
  router.post('/flush', async (_req, res) => res.json(await flush(10)));
  const publicRouter = express.Router();
  publicRouter.use(
    rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  publicRouter.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  publicRouter.get('/unsubscribe', (req, res) => {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.query.token);
    res
      .type('html')
      .send(
        `<!doctype html><html><body style="font:18px system-ui;padding:40px"><h1>Unsubscribe from emails</h1><p>Confirm to stop receiving subscriber campaigns.</p><form method="post"><input type="hidden" name="token" value="${token}"><button>Unsubscribe</button></form></body></html>`,
      );
  });
  publicRouter.post(
    '/unsubscribe',
    express.urlencoded({ extended: false, limit: '2kb' }),
    async (req, res) => {
      await unsubscribe(String(req.query.token || req.body.token || ''));
      res.type('text').send('You have been unsubscribed.');
    },
  );
  const errors: express.ErrorRequestHandler = (e, _req, res, _next) => {
    const status = e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500;
    if (status === 500) config.logger?.error('CookieMail request failed', e);
    res.status(status).json({
      error:
        status === 500
          ? 'Unable to complete the request. Check server logs.'
          : e instanceof z.ZodError
            ? e.issues.map((i: any) => i.message).join('; ')
            : e.message,
    });
  };
  router.use(errors);
  publicRouter.use(errors);
  return {
    router,
    publicRouter,
    subscribe,
    unsubscribe,
    saveTemplate,
    queue,
    flush,
    async close() {
      closed = true;
      await config.provider.close?.();
      await store.close?.();
    },
  };
}
