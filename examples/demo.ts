import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { createCookieMail } from '../src/index.js';
import { sqliteStore } from '../src/sqlite.js';
import type { MailMessage, MailProvider } from '../src/types.js';
const port = Number(process.env.PORT || 3177);
const people = [
  [
    'Maya Chen',
    'maya@northstar.example',
    'A small idea for our next collaboration',
    'Collaboration',
  ],
  ['Oliver Grant', 'oliver@fieldnotes.example', 'Your September creative round-up', 'Newsletter'],
  [
    'Sofia Martinez',
    'sofia@studio.example',
    'Re: Welcome to the early access list',
    'Conversation',
  ],
  ['Noah Williams', 'noah@foundry.example', 'Let’s make something good together', 'Partnership'],
  [
    'Isabella Park',
    'isabella@atelier.example',
    'A quick question about your new release',
    'Question',
  ],
  ['Ethan Brooks', 'ethan@wander.example', 'The details for Thursday’s catch-up', 'Meeting'],
  ['Amelia Reed', 'amelia@gather.example', 'Thanks for the thoughtful update!', 'Conversation'],
  ['Lucas Rivera', 'lucas@bloom.example', 'A fresh perspective on the next chapter', 'Ideas'],
];
const messages: MailMessage[] = Array.from({ length: 42 }, (_, i) => {
  const p = people[i % people.length];
  return {
    id: '1.' + (100 - i),
    fromName: p[0],
    from: p[1],
    replyTo: p[1],
    subject: i < 8 ? p[2] : p[2] + ' · ' + (i + 1),
    date: new Date(Date.now() - i * 5400000).toISOString(),
    unread: i < 4 || i % 7 === 0,
    preview:
      i % 2
        ? 'A few thoughts I wanted to share with you…'
        : 'Hope your week is off to a lovely start.',
    messageId: `<demo-${i}@example.com>`,
    text: `Hi there,\n\n${p[2]}. I’ve been following what you’re building and would love to hear more.\n\nA few thoughtful details can make all the difference. Shall we find a time to talk this week?\n\nAll the best,\n${p[0]}`,
  };
});
const delivered: unknown[] = [];
const provider: MailProvider = {
  async list({ limit, query, unread }) {
    return messages
      .filter(
        (m) =>
          (!unread || m.unread) &&
          (!query ||
            (m.subject + ' ' + m.from + ' ' + m.fromName)
              .toLowerCase()
              .includes(query.toLowerCase())),
      )
      .slice(0, limit);
  },
  async get(id) {
    const m = messages.find((m) => m.id === id);
    if (!m) throw new Error('Not found');
    return m;
  },
  async markRead(id) {
    const m = messages.find((m) => m.id === id);
    if (m) m.unread = false;
  },
  async trash(id) {
    const index = messages.findIndex((m) => m.id === id);
    if (index < 0) throw new Error('Not found');
    messages.splice(index, 1);
  },
  async send(m) {
    delivered.push(m);
  },
};
const kit = createCookieMail({
  store: sqliteStore(':memory:'),
  provider,
  auth: (req) =>
    req.get('x-demo-viewer')
      ? { id: 'viewer', name: 'Viewer', email: 'viewer@example.com', role: 'viewer' }
      : { id: 'demo', name: 'Alex Morgan', email: 'alex@yourworkspace.example', role: 'admin' },
  brand: 'The everyday studio',
  publicOrigin: `http://127.0.0.1:${port}`,
  logger: console,
});
for (let i = 0; i < people.length; i++)
  await kit.subscribe({
    firstName: people[i][0].split(' ')[0],
    lastName: people[i][0].split(' ')[1],
    email: people[i][1],
    tags: i % 2 ? ['Newsletter'] : ['Newsletter', 'Early access'],
    consent: true,
    source: 'demo seed',
  });
for (const [name, subject, title, body, button] of [
  [
    'A warm welcome',
    'Welcome, {{firstName}}',
    'You’re in good company.',
    'Hi {{firstName}},\n\nSo glad you’re here. A fresh perspective, a few good ideas, and a little inspiration — delivered thoughtfully.',
    'Make yourself at home',
  ],
  [
    'Something new',
    'Meet {{productName}}, {{firstName}}',
    'Good things are on the way.',
    'Hi {{firstName}},\n\nWe made something with you in mind. Meet {{productName}} — a small step toward something wonderful.',
    'Take a closer look',
  ],
  [
    'The weekly edit',
    'Your weekly edit, {{firstName}}',
    'A little inspiration for your week.',
    'Hi {{firstName}},\n\nHere are a few things that caught our eye. We hope they spark something for you, too.',
    'Read the full story',
  ],
])
  await kit.saveTemplate({
    name,
    subject,
    blocks: [
      { id: 'h', kind: 'heading', content: title },
      { id: 't', kind: 'text', content: body },
      { id: 'b', kind: 'button', content: button, url: 'https://example.com' },
      { id: 'd', kind: 'divider', content: '' },
      { id: 'f', kind: 'text', content: 'Made with care. Sent with a little optimism.' },
    ],
  });
await kit.recordSent({
  to: 'taylor@example.com',
  subject: '[CS-10041] Case received',
  text: 'Thanks Taylor. Your support case has been received. Reply to this email to continue the conversation.',
  messageId: '<demo-case-10041@example.com>',
  sentAt: new Date().toISOString(),
  source: 'CookieCaseKit',
});
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['examples/demo-client.tsx'],
  bundle: true,
  outfile: 'dist/demo.js',
  format: 'esm',
  jsx: 'automatic',
  platform: 'browser',
});
const app = express();
app.use(
  rateLimit({ windowMs: 60000, limit: 1000, standardHeaders: 'draft-8', legacyHeaders: false }),
);
app.use('/assets', express.static('dist'));
app.get('/assets/react.css', (_req, res) => res.sendFile('src/react.css', { root: process.cwd() }));
app.use('/api/mail', kit.router);
app.use('/mail-public', kit.publicRouter);
app.post('/subscribe', express.json({ limit: '4kb' }), async (req, res) => {
  try {
    await kit.subscribe({ ...req.body, tags: ['Newsletter'], source: 'demo subscription form' });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Check your details' });
  }
});
app.get('/{*path}', (_req, res) =>
  res
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CookieMail — a more human inbox</title><link rel="stylesheet" href="/assets/react.css"><style>body{margin:0;padding:26px;background:#090b0d;font:14px system-ui}.demo-bar{max-width:1440px;margin:0 auto 20px;display:flex;justify-content:space-between;align-items:center;color:#9299a3;font-size:11px;gap:14px}.demo-bar strong{color:#e0e3e8;font-size:12px}.demo-tag{border:1px solid #3a2c22;border-radius:20px;padding:6px 12px;color:#d78b60}#root{max-width:1440px;margin:auto}@media(max-width:600px){body{padding:10px}.demo-bar{padding:4px;font-size:9px}.demo-bar strong{font-size:10px}}</style></head><body><div class="demo-bar"><strong>✦ COOKIECOLLECTION / COOKIE MAIL</strong><span class="demo-tag">Local demo · no real emails sent</span></div><div id="root"></div><script type="module" src="/assets/demo.js"></script></body></html>`,
    ),
);
app.listen(port, '127.0.0.1', () =>
  console.log(`CookieMail demo: http://127.0.0.1:${port} (fake inbox and delivery)`),
);
