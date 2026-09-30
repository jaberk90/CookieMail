import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createCookieMail, renderTemplate } from '../src/index.js';
import { sqliteStore } from '../src/sqlite.js';
import { cleanHtml, previewDocument } from '../src/templates.js';
import type { MailProvider } from '../src/types.js';
function fixture(
  options: { fail?: boolean; workspace?: string; store?: ReturnType<typeof sqliteStore> } = {},
) {
  const sent: Parameters<MailProvider['send']>[0][] = [];
  const store = options.store || sqliteStore(':memory:');
  const provider: MailProvider = {
    async list() {
      return [];
    },
    async get(id) {
      return {
        id,
        from: 'hello@example.com',
        fromName: 'Sender',
        subject: 'Hello',
        date: new Date().toISOString(),
        unread: true,
        text: 'Safe',
        html: '<script>alert(1)</script><p>Safe</p>',
        messageId: '<original@example.com>',
      };
    },
    async markRead() {},
    async send(m) {
      if (options.fail) throw new Error('SMTP uncertain');
      sent.push(m);
    },
  };
  const kit = createCookieMail({
    store,
    workspace: options.workspace,
    provider,
    publicOrigin: 'https://mail.example.com',
    auth: (req) =>
      req.get('x-user')
        ? {
            id: '1',
            name: 'Operator',
            email: 'admin@example.com',
            role: req.get('x-user') === 'viewer' ? 'viewer' : 'admin',
          }
        : null,
  });
  const app = express();
  app.use('/mail', kit.router);
  app.use('/public', kit.publicRouter);
  const post = (path: string, body: object) =>
    request(app)
      .post('/mail' + path)
      .set('x-user', 'admin')
      .set('X-CookieMail', '1')
      .set('Origin', 'https://mail.example.com')
      .send(body);
  return { kit, app, post, sent, store };
}
const subscriber = {
  firstName: 'Alex',
  lastName: 'Morgan',
  email: 'alex@example.com',
  tags: ['Newsletter'],
  consent: true,
  source: 'explicit form opt-in',
};
const template = {
  name: 'Welcome',
  subject: 'Hello {{firstName}}',
  blocks: [
    { id: 'h', kind: 'heading' as const, content: 'Welcome {{firstName}}' },
    { id: 't', kind: 'text' as const, content: 'Your invitation is {{code}}.' },
  ],
};
test('authentication and origin checks protect all administrative mutations', async () => {
  const f = fixture();
  try {
    await request(f.app).get('/mail/subscribers').expect(401);
    await request(f.app)
      .post('/mail/subscribers')
      .set('x-user', 'viewer')
      .set('X-CookieMail', '1')
      .send(subscriber)
      .expect(403);
    await request(f.app)
      .post('/mail/subscribers')
      .set('x-user', 'admin')
      .send(subscriber)
      .expect(403);
    await f.post('/subscribers', subscriber).set('Origin', 'https://evil.example').expect(403);
    await f.post('/subscribers', subscriber).set('Sec-Fetch-Site', 'cross-site').expect(403);
    await f.post('/subscribers', subscriber).set('Host', 'internal.firebase.example').expect(201);
  } finally {
    await f.kit.close();
  }
});
test('subscriber capture requires consent, deduplicates emails and keeps unsubscribe tokens private', async () => {
  const f = fixture();
  try {
    await f.post('/subscribers', { ...subscriber, consent: false }).expect(400);
    await f.kit.subscribe(subscriber);
    await f.kit.subscribe({ ...subscriber, email: 'ALEX@example.com', tags: ['Early access'] });
    const r = await request(f.app).get('/mail/subscribers').set('x-user', 'admin').expect(200);
    assert.equal(r.body.length, 1);
    assert.deepEqual(r.body[0].tags, ['Newsletter', 'Early access']);
    assert.equal(r.body[0].token, undefined);
  } finally {
    await f.kit.close();
  }
});
test('tag sends personalize each recipient, include opt-out, and suppress unsubscribe before delivery', async () => {
  const f = fixture();
  try {
    const a = await f.kit.subscribe(subscriber);
    await f.kit.subscribe({ ...subscriber, firstName: 'Maya', email: 'maya@example.com' });
    const t = await f.kit.saveTemplate(template);
    await f
      .post('/send', {
        idempotencyKey: randomUUID(),
        tag: 'Newsletter',
        templateId: t.id,
        values: {},
      })
      .expect(400);
    await f.kit.queue({
      idempotencyKey: randomUUID(),
      tag: 'Newsletter',
      templateId: t.id,
      values: { code: 'HELLO' },
    });
    await request(f.app)
      .patch('/mail/subscribers/' + a.id)
      .set('x-user', 'admin')
      .set('X-CookieMail', '1')
      .send({ status: 'unsubscribed' })
      .expect(200);
    await f.kit.flush();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].to, 'maya@example.com');
    assert.equal(f.sent[0].subject, 'Hello Maya');
    assert.ok(f.sent[0].text.includes('HELLO'));
    assert.ok(f.sent[0].unsubscribeUrl);
    const token = new URL(f.sent[0].unsubscribeUrl!).searchParams.get('token')!;
    await request(f.app)
      .get('/public/unsubscribe?token=' + token)
      .expect(200);
    assert.equal(
      (await request(f.app).get('/mail/subscribers').set('x-user', 'admin')).body.find(
        (s: any) => s.email === 'maya@example.com',
      ).status,
      'subscribed',
    );
    await request(f.app)
      .post('/public/unsubscribe?token=' + token)
      .type('form')
      .send({ 'List-Unsubscribe': 'One-Click' })
      .expect(200);
    await assert.rejects(
      f.kit.subscribe({ ...subscriber, email: 'maya@example.com' }),
      /Previously unsubscribed/,
    );
  } finally {
    await f.kit.close();
  }
});
test('idempotent queue and concurrent workers send a message only once', async () => {
  const f = fixture();
  try {
    const payload = {
      idempotencyKey: randomUUID(),
      to: 'to@example.com',
      subject: 'Hi',
      text: 'A full message',
    };
    await Promise.all([f.kit.queue(payload), f.kit.queue(payload)]);
    await assert.rejects(f.kit.queue({ ...payload, text: 'Changed' }), /Idempotency/);
    await Promise.all([f.kit.flush(), f.kit.flush()]);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].text, payload.text);
  } finally {
    await f.kit.close();
  }
});
test('ambiguous transport failures are not automatically resent', async () => {
  const f = fixture({ fail: true });
  try {
    await f.kit.queue({
      idempotencyKey: randomUUID(),
      to: 'to@example.com',
      subject: 'Hello',
      text: 'Test',
    });
    await f.kit.flush();
    await f.kit.flush();
    const r = await request(f.app).get('/mail/outbox').set('x-user', 'admin');
    assert.equal(r.body[0].status, 'uncertain');
  } finally {
    await f.kit.close();
  }
});
test('templates escape variables, reject unsafe links, and strip executable HTML', () => {
  const r = renderTemplate(template.subject, template.blocks, {
    firstName: '<img src=x onerror=alert(1)>',
    code: '<script>x</script>',
  });
  assert.ok(r.html.includes('&lt;img'));
  assert.ok(!r.html.includes('<script>'));
  assert.throws(
    () => renderTemplate(template.subject, template.blocks, { firstName: 'Alex' }),
    /Missing variable/,
  );
  assert.throws(
    () =>
      renderTemplate('Hi', [{ id: 'x', kind: 'button', content: 'Go', url: '{{url}}' }], {
        url: 'javascript:alert(1)',
      }),
    /HTTP/,
  );
  const clean = cleanHtml(
    '<img src="https://tracker.example/i" onerror="x"><script>x</script><a href="javascript:x">link</a>',
  );
  assert.ok(!clean.includes('onerror'));
  assert.ok(!clean.includes('javascript:'));
  assert.ok(previewDocument(clean).includes("img-src 'none'"));
});
test('workspaces isolate subscribers and templates in shared storage', async () => {
  const store = sqliteStore(':memory:');
  const a = fixture({ store, workspace: 'one' }),
    b = fixture({ store, workspace: 'two' });
  try {
    await a.kit.subscribe(subscriber);
    assert.equal(
      (await request(b.app).get('/mail/subscribers').set('x-user', 'admin')).body.length,
      0,
    );
    const t = await a.kit.saveTemplate(template);
    await assert.rejects(
      b.kit.queue({
        idempotencyKey: randomUUID(),
        templateId: t.id,
        to: 'a@example.com',
        values: { firstName: 'Alex', code: 'x' },
      }),
      /not found/,
    );
  } finally {
    await store.close?.();
  }
});
test('reply metadata is taken from the original mail, never trusted from the browser', async () => {
  const f = fixture();
  try {
    await f
      .post('/send', {
        idempotencyKey: randomUUID(),
        to: 'other@example.com',
        subject: 'Re: hello',
        text: 'Hi',
        replyToId: '1.1',
      })
      .expect(400);
    await f.kit.queue({
      idempotencyKey: randomUUID(),
      to: 'hello@example.com',
      subject: 'Re: hello',
      text: 'Hi',
      replyToId: '1.1',
    });
    await f.kit.flush();
    assert.equal(f.sent[0].inReplyTo, '<original@example.com>');
  } finally {
    await f.kit.close();
  }
});

test('worker batch limit includes failed delivery attempts', async () => {
  const f = fixture({ fail: true });
  try {
    for (let i = 0; i < 3; i++)
      await f.kit.queue({
        idempotencyKey: randomUUID(),
        to: 'to@example.com',
        subject: 'Message ' + i,
        text: 'Hello',
      });
    await f.kit.flush(1);
    const jobs = (await request(f.app).get('/mail/outbox').set('x-user', 'admin')).body;
    assert.equal(jobs.filter((j: any) => j.status === 'uncertain').length, 1);
    assert.equal(jobs.filter((j: any) => j.status === 'queued').length, 2);
  } finally {
    await f.kit.close();
  }
});
