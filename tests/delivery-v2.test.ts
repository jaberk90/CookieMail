import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { ImapFlow } from 'imapflow';
import { createCookieMail, imapSmtpProvider } from '../src/index.js';
import { sqliteStore } from '../src/sqlite.js';
import type { MailProvider } from '../src/types.js';
function fixture(
  options: {
    store?: ReturnType<typeof sqliteStore>;
    workspace?: string;
    fail?: boolean;
    send?: MailProvider['send'];
    trash?: boolean;
  } = {},
) {
  const sent: Parameters<MailProvider['send']>[0][] = [],
    deleted: string[] = [];
  const provider: MailProvider = {
    list: async () => [],
    get: async (id) => ({
      id,
      from: 'a@example.com',
      fromName: 'A',
      subject: 'Hello',
      date: new Date().toISOString(),
      unread: false,
      text: 'Hello',
    }),
    markRead: async () => {},
    send:
      options.send ||
      (async (m) => {
        sent.push(m);
        if (options.fail) throw Error('ambiguous');
      }),
    ...(options.trash === false
      ? {}
      : {
          trash: async (id: string) => {
            deleted.push(id);
          },
        }),
  };
  const store = options.store || sqliteStore(':memory:');
  const kit = createCookieMail({
    provider,
    store,
    workspace: options.workspace,
    publicOrigin: 'https://mail.example.com',
    auth: (req) =>
      req.get('x-user')
        ? {
            id: 'staff',
            name: 'Staff',
            email: 'staff@example.com',
            role: req.get('x-user') === 'viewer' ? 'viewer' : 'admin',
          }
        : null,
  });
  const app = express();
  app.use('/mail', kit.router);
  const write = (path: string, body: object = {}, method: 'post' | 'patch' | 'delete' = 'post') =>
    request(app)
      [method]('/mail' + path)
      .set('x-user', 'admin')
      .set('X-CookieMail', '1')
      .set('Origin', 'https://mail.example.com')
      .send(body);
  return { kit, store, app, write, sent, deleted };
}
const message = () => ({
  idempotencyKey: randomUUID(),
  to: 'member@example.com',
  subject: 'A saved message',
  text: 'Original body',
});
test('scheduled jobs persist normalized UTC, wait until due, and concurrent workers send once', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T12:00:00Z') });
  const f = fixture();
  try {
    const payload = { ...message(), scheduledAt: '2026-10-01T15:00:00+02:00' };
    const queued = await f.kit.queue(payload);
    assert.equal(
      (await f.store.read('default', 'job-' + queued.id))?.value.scheduledAt,
      '2026-10-01T13:00:00.000Z',
    );
    assert.deepEqual(await f.kit.flush(), { sent: 0, skipped: 0 });
    assert.equal(f.sent.length, 0);
    t.mock.timers.setTime(Date.parse('2026-10-01T13:00:00Z'));
    await Promise.all([f.kit.flush(), f.kit.flush()]);
    assert.equal(f.sent.length, 1);
    assert.equal(
      (await f.kit.queue(payload)).id,
      queued.id,
      'idempotent retries still work after scheduled time passes',
    );
  } finally {
    await f.kit.close();
  }
});
test('invalid dates, past times and excessive future times cannot be queued', async () => {
  const f = fixture();
  try {
    for (const scheduledAt of [
      'tomorrow',
      '2026-01-01T12:00',
      '2000-01-01T00:00:00Z',
      new Date(Date.now() + 367 * 86400000).toISOString(),
    ])
      await assert.rejects(f.kit.queue({ ...message(), scheduledAt }));
  } finally {
    await f.kit.close();
  }
});
test('queued sends can be rescheduled or cancelled; completed sends cannot be changed', async () => {
  const f = fixture();
  try {
    const a = await f.kit.queue(message());
    await f.kit.reschedule(String(a.id), new Date(Date.now() + 3600000).toISOString());
    assert.equal((await f.kit.flush()).sent, 0);
    await f.kit.reschedule(String(a.id), null);
    await f.kit.flush();
    await assert.rejects(f.kit.cancel(String(a.id)), /not started/);
    await assert.rejects(f.kit.reschedule(String(a.id), null), /not started/);
    const b = await f.kit.queue(message());
    await f.kit.cancel(String(b.id));
    await f.kit.cancel(String(b.id));
    await f.kit.flush();
    assert.equal(f.sent.length, 1);
    await assert.rejects(f.kit.reschedule(String(b.id), null), /not started/);
  } finally {
    await f.kit.close();
  }
});
test('cancellation cannot race a claimed delivery', async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const f = fixture({
    send: async () => {
      started();
      await wait;
    },
  });
  let worker: Promise<unknown> | undefined;
  try {
    const job = await f.kit.queue(message());
    worker = f.kit.flush();
    await ready;
    await assert.rejects(f.kit.cancel(String(job.id)), /not started/);
    await assert.rejects(f.kit.reschedule(String(job.id), null), /not started/);
  } finally {
    release();
    await worker;
    await f.kit.close();
  }
});
test('sent copies preserve exact personalized content and resends use new IDs without duplicating opt-out links', async () => {
  const f = fixture();
  try {
    await f.kit.subscribe({
      firstName: 'Alex',
      email: 'alex@example.com',
      consent: true,
      source: 'test',
      tags: ['News'],
    });
    const template = await f.kit.saveTemplate({
      name: 'Hello',
      subject: 'Hi {{firstName}}',
      blocks: [{ id: 'text', kind: 'text', content: 'A personal note to {{firstName}}' }],
    });
    await f.kit.queue({ idempotencyKey: randomUUID(), tag: 'News', templateId: template.id });
    await f.kit.flush();
    const list = await f.kit.listSent();
    assert.equal(list.length, 1);
    const id = String(list[0].id);
    const original = await f.kit.getSent(id);
    assert.equal(original.subject, 'Hi Alex');
    assert.equal(original.text, f.sent[0].text);
    assert.equal(original.html, f.sent[0].html);
    await f.kit.subscribe({
      firstName: 'Changed',
      email: 'alex@example.com',
      consent: true,
      source: 'test',
      tags: ['News'],
    });
    const options = { idempotencyKey: randomUUID() };
    await Promise.all([f.kit.resend(id, options), f.kit.resend(id, options)]);
    await f.kit.flush();
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent[1].subject, f.sent[0].subject);
    assert.equal(f.sent[1].text, f.sent[0].text);
    assert.notEqual(f.sent[0].messageId, f.sent[1].messageId);
  } finally {
    await f.kit.close();
  }
});
test('resends preserve campaign suppression both at queue time and worker time', async () => {
  const f = fixture();
  try {
    const sub = await f.kit.subscribe({
      firstName: 'Alex',
      email: 'alex@example.com',
      consent: true,
      source: 'test',
      tags: ['News'],
    });
    await f.kit.queue({ ...message(), to: undefined, tag: 'News' });
    await f.kit.flush();
    const id = String((await f.kit.listSent())[0].id);
    await f.kit.resend(id, { idempotencyKey: randomUUID() });
    await f.write('/subscribers/' + sub.id, { status: 'unsubscribed' }, 'patch').expect(200);
    assert.deepEqual(await f.kit.flush(), { sent: 0, skipped: 1 });
    await assert.rejects(f.kit.resend(id, { idempotencyKey: randomUUID() }), /unsubscribed/);
    assert.equal(f.sent.length, 1);
  } finally {
    await f.kit.close();
  }
});
test('uncertain sends are not listed as sent or offered for resend', async () => {
  const f = fixture({ fail: true });
  try {
    const job = await f.kit.queue(message());
    await f.kit.flush();
    assert.deepEqual(await f.kit.listSent(), []);
    await assert.rejects(
      f.kit.resend(job.id + '.0', { idempotencyKey: randomUUID() }),
      /not found/,
    );
  } finally {
    await f.kit.close();
  }
});
test('sent content, resending and schedule changes stay within the workspace', async () => {
  const store = sqliteStore(':memory:'),
    a = fixture({ store, workspace: 'a' }),
    b = fixture({ store, workspace: 'b' });
  try {
    const job = await a.kit.queue(message());
    await a.kit.flush();
    const id = String((await a.kit.listSent())[0].id);
    assert.deepEqual(await b.kit.listSent(), []);
    await assert.rejects(b.kit.getSent(id), /not found/);
    await assert.rejects(b.kit.resend(id, { idempotencyKey: randomUUID() }), /not found/);
    await assert.rejects(b.kit.cancel(String(job.id)), /not found/);
  } finally {
    await store.close?.();
  }
});
test('new mutations require admin and same-origin checks; deletion capability is explicit', async () => {
  const f = fixture();
  try {
    const job = await f.kit.queue(message());
    await f.kit.flush();
    const id = String((await f.kit.listSent())[0].id);
    for (const [method, path, body] of [
      ['delete', '/inbox/1.1', {}],
      ['post', '/sent/' + id + '/resend', { idempotencyKey: randomUUID() }],
      ['patch', '/outbox/' + job.id + '/schedule', { scheduledAt: null }],
      ['delete', '/outbox/' + job.id, {}],
    ] as const) {
      await f.write(path, body, method).set('x-user', 'viewer').expect(403);
      await f.write(path, body, method).set('Origin', 'https://evil.example').expect(403);
    }
    await request(f.app)
      .get('/mail/sent/' + id)
      .expect(401);
    await request(f.app)
      .get('/mail/sent/' + id)
      .set('x-user', 'viewer')
      .expect(200);
    await f.write('/inbox/1.1', {}, 'delete').expect(200);
    assert.deepEqual(f.deleted, ['1.1']);
    const unsupported = fixture({ trash: false });
    try {
      await unsupported.write('/inbox/1.1', {}, 'delete').expect(501);
    } finally {
      await unsupported.kit.close();
    }
  } finally {
    await f.kit.close();
  }
});
test('IMAP deletion selects Trash and validates UID validity before moving', async (t) => {
  const moves: unknown[][] = [];
  t.mock.method(ImapFlow.prototype, 'connect', async () => {});
  t.mock.method(ImapFlow.prototype, 'getMailboxLock', async function (this: ImapFlow) {
    this.mailbox = { uidValidity: 123n, path: 'INBOX' } as any;
    return { release() {} };
  });
  t.mock.method(ImapFlow.prototype, 'list', async () => [{ path: 'Trash', specialUse: '\\Trash' }]);
  t.mock.method(ImapFlow.prototype, 'messageMove', async (...args: unknown[]) => {
    moves.push(args);
    return { uidMap: new Map() };
  });
  t.mock.method(ImapFlow.prototype, 'close', () => {});
  const provider = imapSmtpProvider({
    imap: { host: 'imap.example.com', auth: { user: 'test', pass: 'test' } },
    smtp: { host: 'smtp.example.com' },
    from: 'mail@example.com',
  });
  try {
    await provider.trash!('123.4');
    assert.deepEqual(moves[0], [4, 'Trash', { uid: true }]);
    await assert.rejects(provider.trash!('122.4'), /identifier expired/);
    assert.equal(moves.length, 1);
  } finally {
    await provider.close?.();
  }
});

test('scheduled delivery survives a store restart', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T12:00:00Z') });
  const dir = await mkdtemp(join(tmpdir(), 'cookiemail-schedule-'));
  const file = join(dir, 'mail.sqlite');
  try {
    const first = fixture({ store: sqliteStore(file) });
    await first.kit.queue({ ...message(), scheduledAt: '2026-10-01T13:00:00Z' });
    await first.kit.close();
    const second = fixture({ store: sqliteStore(file) });
    try {
      assert.equal((await second.kit.flush()).sent, 0);
      t.mock.timers.setTime(Date.parse('2026-10-01T13:00:00Z'));
      assert.equal((await second.kit.flush()).sent, 1);
      assert.equal((await second.kit.listSent()).length, 1);
    } finally {
      await second.kit.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('an expired lease cannot be converted back to confirmed sent by a late worker', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T12:00:00Z') });
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((r) => {
      started = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  let count = 0;
  const f = fixture({
    send: async () => {
      count++;
      started();
      await wait;
    },
  });
  let worker: Promise<unknown> | undefined;
  try {
    const job = await f.kit.queue(message());
    worker = f.kit.flush();
    await ready;
    t.mock.timers.setTime(Date.now() + 300001);
    await f.kit.flush();
    release();
    await worker;
    assert.equal((await f.store.read('default', 'job-' + job.id))?.value.status, 'uncertain');
    assert.deepEqual(await f.kit.listSent(), []);
    await f.kit.flush();
    assert.equal(count, 1);
  } finally {
    release();
    await worker;
    await f.kit.close();
  }
});

test('oversized rendered snapshots fail before a send is queued', async () => {
  const f = fixture();
  try {
    const t = await f.kit.saveTemplate({
      name: 'Large',
      subject: 'Large',
      blocks: Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        kind: 'text',
        content: 'x'.repeat(10000),
      })),
    });
    await assert.rejects(
      f.kit.queue({ idempotencyKey: randomUUID(), to: 'a@example.com', templateId: t.id }),
      /too large/,
    );
    assert.equal((await f.kit.flush()).sent, 0);
  } finally {
    await f.kit.close();
  }
});
