'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Block, BlockKind, MailMessage, MailSummary, Subscriber, Template } from './types.js';
export interface CookieMailProps {
  basePath?: string;
  getToken?: () => string | null | Promise<string | null>;
  theme?: 'dark' | 'light';
  onThemeChange?: (theme: 'dark' | 'light') => void;
  onUnauthorized?: () => void;
}
type View = 'inbox' | 'subscribers' | 'templates' | 'outbox';
const icons: Record<string, string> = {
  inbox: 'M4 4h16v16H4zM4 13h5l2 3h2l2-3h5',
  subscribers:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4',
  templates: 'M3 3h18v18H3zM3 9h18M9 9v12',
  outbox: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  search: 'M21 21l-5-5M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16',
  plus: 'M12 5v14M5 12h14',
  moon: 'M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 1.4 1.4M17 17l1.4 1.4M5.6 18.4 1.4-1.4M17 7l1.4-1.4M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  close: 'm6 6 12 12M6 18 18 6',
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] || icons.templates} />
    </svg>
  );
}
function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="36" height="29" rx="10" fill="currentColor" />
      <path
        d="m8 13 12 9 12-9"
        stroke="#171a1f"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="31" cy="7" r="6" fill="#171a1f" />
      <circle cx="30" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      className={`cm-modal ${wide ? 'cm-wide' : ''}`}
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="cm-modal-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="cm-icon" aria-label="Close dialog" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const initialBlocks: Block[] = [
  { id: 'welcome', kind: 'heading', content: 'A little something, just for you.' },
  {
    id: 'body',
    kind: 'text',
    content:
      'Hi {{firstName}},\n\nGood things start with a conversation. Here’s what we’ve been working on.',
  },
  { id: 'cta', kind: 'button', content: 'Take a look', url: 'https://example.com' },
];
const variableNames = (subject: string, blocks: Block[]) =>
  [
    ...new Set(
      (subject + ' ' + blocks.map((b) => b.content + ' ' + (b.url || '')).join(' '))
        .match(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)
        ?.map((s) => s.replace(/[{}\s]/g, '')) || [],
    ),
  ].sort();
const formatDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const initials = (s: string) =>
  s
    .split(/[ @]/)
    .slice(0, 2)
    .map((s) => s[0] || '')
    .join('')
    .toUpperCase();
function emailDocument(html: string) {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:15px/1.7 system-ui;padding:24px;color:#24262b;background:white;overflow-wrap:anywhere}a{color:#a75225}img{max-width:100%}</style>${html}`;
}
export function CookieMail({
  basePath = '/api/mail',
  getToken,
  theme: controlledTheme,
  onThemeChange,
  onUnauthorized,
}: CookieMailProps) {
  const [localTheme, setLocalTheme] = useState<'dark' | 'light'>('dark');
  const theme = controlledTheme || localTheme;
  useEffect(() => {
    try {
      const s = localStorage.getItem('cookiemail-theme');
      if (s === 'dark' || s === 'light') setLocalTheme(s);
    } catch {}
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    onThemeChange?.(next);
    if (!controlledTheme) {
      setLocalTheme(next);
      try {
        localStorage.setItem('cookiemail-theme', next);
      } catch {}
    }
  };
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const [boot, setBoot] = useState<any>(null),
    [view, setView] = useState<View>('inbox'),
    [items, setItems] = useState<any[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [query, setQuery] = useState(''),
    [unread, setUnread] = useState(false),
    [limit, setLimit] = useState(25),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [message, setMessage] = useState<MailMessage | null>(null),
    [subscriber, setSubscriber] = useState<Subscriber | 'new' | null>(null),
    [editor, setEditor] = useState<Template | 'new' | null>(null),
    [compose, setCompose] = useState<{ to?: string; subject?: string; replyToId?: string } | null>(
      null,
    );
  const base = basePath.replace(/\/+$/, '');
  const api = useCallback(
    async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
      if (!/^\/(?!\/)/.test(base) || /[?#\\]/.test(base))
        throw new Error('basePath must be a same-origin path');
      const token = await tokenRef.current?.();
      if (tokenRef.current && !token) {
        setBoot(null);
        setItems([]);
        setTemplates([]);
        setMessage(null);
        setSubscriber(null);
        setEditor(null);
        setCompose(null);
        unauthorizedRef.current?.();
        throw new Error('Sign in to continue');
      }
      const r = await fetch(base + path, {
        method,
        signal,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CookieMail': '1',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (r.status === 401) {
        setBoot(null);
        setItems([]);
        setTemplates([]);
        setMessage(null);
        setSubscriber(null);
        setEditor(null);
        setCompose(null);
        setItems([]);
        setMessage(null);
        unauthorizedRef.current?.();
      }
      const data = await r.json().catch((error) => {
        if (error.name === 'AbortError') throw error;
        throw new Error('Mailbox API did not return JSON. Check basePath.');
      });
      if (!r.ok) throw new Error(data.error || 'Request failed');
      return data;
    },
    [base],
  );
  const refresh = () => setRevision((n) => n + 1);
  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete action');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    api('/bootstrap', 'GET', undefined, controller.signal)
      .then(setBoot)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    api<Template[]>('/templates', 'GET', undefined, controller.signal)
      .then(setTemplates)
      .catch(() => {});
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setItems([]);
    const timer = setTimeout(() => {
      api<any[]>(
        view === 'inbox'
          ? `/inbox?limit=${limit}&q=${encodeURIComponent(query)}&unread=${unread}`
          : `/${view}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          if (!Array.isArray(data)) throw new Error('Invalid list response from mailbox API');
          setItems(data);
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, view, query, unread, limit, revision]);
  const admin = boot?.user.role === 'admin';
  const visible =
    view === 'inbox'
      ? items
      : items.filter((v) => JSON.stringify(v).toLowerCase().includes(query.toLowerCase()));
  const titles = {
    inbox: ['Your inbox. A little more human.', 'A clear space for your next great conversation.'],
    subscribers: ['Good people. Growing together.', 'A thoughtful audience, organized your way.'],
    templates: ['Make something worth opening.', 'Build once. Add a personal touch to every send.'],
    outbox: ['Every message, accounted for.', 'Track queued campaigns and individual deliveries.'],
  };
  return (
    <section className="cm" data-theme={theme} aria-label="CookieMail workspace">
      <aside className="cm-sidebar">
        <div className="cm-brand">
          <Logo />
          <span>
            Cookie<span>Mail</span>
            <small>YOUR EMAIL, AT HOME.</small>
          </span>
        </div>
        <div className="cm-workspace">
          <span className="cm-dot" />
          <div>
            {boot?.brand || 'Your workspace'}
            <small>Connected mail workspace</small>
          </div>
        </div>
        <div className="cm-nav-label">WORKSPACE</div>
        <nav aria-label="Mail navigation">
          {(['inbox', 'subscribers', 'templates', 'outbox'] as View[]).map((v) => (
            <button
              key={v}
              className={`cm-nav ${view === v ? 'cm-active' : ''}`}
              onClick={() => {
                setView(v);
                setQuery('');
                setError('');
              }}
            >
              <Icon name={v} />
              <span>{v === 'outbox' ? 'Sent & queued' : v[0].toUpperCase() + v.slice(1)}</span>
              {v === 'subscribers' && boot && <small>{boot.subscribers}</small>}
            </button>
          ))}
        </nav>
        <div className="cm-sidebar-note">
          <span className="cm-dot" /> Built for connection.
          <p>A small message can be the start of something good.</p>
          <span className="cm-note-art">✉</span>
        </div>
        <div className="cm-user">
          <span className="cm-avatar">{initials(boot?.user.name || 'CM')}</span>
          <div>
            {boot?.user.name || 'Connecting…'}
            <small>{boot?.user.email || 'Your app handles sign-in'}</small>
          </div>
        </div>
      </aside>
      <main className="cm-main">
        <header className="cm-top">
          <div>
            Workspace <span>/</span>{' '}
            <strong>
              {view === 'outbox' ? 'Sent & queued' : view[0].toUpperCase() + view.slice(1)}
            </strong>
          </div>
          {(!controlledTheme || onThemeChange) && (
            <button
              className="cm-icon"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
          )}
        </header>
        <div className="cm-content">
          <div className="cm-heading">
            <div>
              <p className="cm-eyebrow">A BETTER WAY TO KEEP IN TOUCH</p>
              <h1>{titles[view][0]}</h1>
              <p>{titles[view][1]}</p>
            </div>
            {admin && (
              <button
                className="cm-button cm-primary"
                onClick={() =>
                  view === 'templates'
                    ? setEditor('new')
                    : view === 'subscribers'
                      ? setSubscriber('new')
                      : setCompose({})
                }
              >
                <Icon name="plus" />
                {view === 'templates'
                  ? 'Create template'
                  : view === 'subscribers'
                    ? 'Add subscriber'
                    : 'Compose email'}
              </button>
            )}
          </div>
          <div className="cm-metrics">
            <div>
              <span>Mailbox window</span>
              <strong>
                {limit}
                <small>latest emails</small>
              </strong>
              <p>Fresh conversations, less clutter</p>
            </div>
            <div>
              <span>Subscribed people</span>
              <strong>
                {boot?.subscribers ?? '—'}
                <small>in your audience</small>
              </strong>
              <p>Permission to stay in touch</p>
            </div>
            <div>
              <span>Ready to personalize</span>
              <strong>
                {boot?.templates ?? '—'}
                <small>email templates</small>
              </strong>
              <p>A great starting point, every time</p>
            </div>
          </div>
          {notice && (
            <div className="cm-notice" role="status">
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          {error && (
            <div className="cm-error" role="alert">
              {error}
            </div>
          )}
          <section className="cm-panel">
            <div className="cm-panel-title">
              <div>
                <h2>
                  {view === 'inbox'
                    ? 'All conversations'
                    : view === 'subscribers'
                      ? 'Your audience'
                      : view === 'templates'
                        ? 'Template library'
                        : 'Delivery activity'}{' '}
                  <span className="cm-count">{visible.length}</span>
                </h2>
                <p>
                  {view === 'inbox'
                    ? 'The details that keep things moving.'
                    : view === 'templates'
                      ? 'Drag, drop and make it yours.'
                      : 'Small details. Meaningful connections.'}
                </p>
              </div>
              <button className="cm-button" onClick={refresh} disabled={loading}>
                <Icon name="refresh" />
                Refresh
              </button>
            </div>
            <div className="cm-toolbar">
              <label className="cm-search">
                <Icon name="search" />
                <input
                  aria-label="Search"
                  placeholder={
                    view === 'inbox' ? 'Search subject or sender…' : 'Search this collection…'
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {view === 'inbox' && (
                <>
                  <select
                    aria-label="Message filter"
                    value={unread ? 'unread' : 'all'}
                    onChange={(e) => setUnread(e.target.value === 'unread')}
                  >
                    <option value="all">All messages</option>
                    <option value="unread">Unread only</option>
                  </select>
                  <select
                    aria-label="Inbox limit"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  >
                    <option value="25">Latest 25</option>
                    <option value="50">Latest 50</option>
                  </select>
                </>
              )}
              {view === 'outbox' && admin && (
                <button
                  className="cm-button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const r = await api<any>('/flush', 'POST', {});
                      setNotice(
                        `${r.sent} messages accepted by provider. ${r.skipped} suppressed.`,
                      );
                      refresh();
                    })
                  }
                >
                  Process next 10
                </button>
              )}
            </div>
            {loading ? (
              <div className="cm-empty">Loading your workspace…</div>
            ) : view === 'templates' ? (
              <div className="cm-template-grid">
                {visible.map((t) => (
                  <button className="cm-template-card" key={t.id} onClick={() => setEditor(t)}>
                    <div className="cm-mini-email">
                      <div className="cm-mini-logo">✉</div>
                      <strong>
                        {t.blocks.find((b: Block) => b.kind === 'heading')?.content || t.name}
                      </strong>
                      <i />
                      <i />
                      <i />
                      <span>Discover more →</span>
                    </div>
                    <h3>{t.name}</h3>
                    <p>
                      {t.variables.length} variables · {formatDate(t.updatedAt)}
                    </p>
                  </button>
                ))}
                {admin && (
                  <button className="cm-template-new" onClick={() => setEditor('new')}>
                    <Icon name="plus" />
                    <strong>A fresh canvas</strong>
                    <span>Start with a few good building blocks</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="cm-table-wrap">
                <table className="cm-table">
                  <thead>
                    <tr>
                      {(view === 'inbox'
                        ? ['From', 'Subject', 'Received', '']
                        : view === 'subscribers'
                          ? ['Subscriber', 'Tags', 'Status', 'Added']
                          : ['Message', 'Audience', 'Status', 'Sent']
                      ).map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={item.id} className={item.unread ? 'cm-unread' : ''}>
                        {view === 'inbox' ? (
                          <>
                            <td>
                              <div className="cm-sender">
                                <span className="cm-avatar">
                                  {initials(item.fromName || item.from)}
                                </span>
                                <div>
                                  <strong>{item.fromName || item.from}</strong>
                                  <small>{item.from}</small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <button
                                className="cm-subject"
                                onClick={() =>
                                  void act(async () => {
                                    const m = await api<MailMessage>(
                                      '/inbox/' + encodeURIComponent(item.id),
                                    );
                                    setMessage(m);
                                    if (admin) {
                                      await api(
                                        '/inbox/' + encodeURIComponent(item.id) + '/read',
                                        'POST',
                                        {},
                                      );
                                      refresh();
                                    }
                                  })
                                }
                              >
                                {item.subject}
                                <small>{item.preview || 'Open conversation'}</small>
                              </button>
                            </td>
                            <td className="cm-date">{formatDate(item.date)}</td>
                            <td>
                              {item.unread && (
                                <span className="cm-unread-dot" aria-label="Unread" />
                              )}
                            </td>
                          </>
                        ) : view === 'subscribers' ? (
                          <>
                            <td>
                              <button className="cm-subject" onClick={() => setSubscriber(item)}>
                                {item.firstName} {item.lastName}
                                <small>{item.email}</small>
                              </button>
                            </td>
                            <td>
                              <div className="cm-tags">
                                {item.tags.map((t: string) => (
                                  <span key={t}>{t}</span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <span
                                className={`cm-badge ${item.status === 'subscribed' ? 'cm-green' : ''}`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="cm-date">{formatDate(item.createdAt)}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              <strong>{item.subject}</strong>
                              <small className="cm-muted">
                                {formatDate(item.createdAt)}
                                {item.error && ' · ' + item.error}
                              </small>
                            </td>
                            <td>
                              {item.tag ? '#' + item.tag : item.to}
                              <small className="cm-muted">
                                {item.recipients} recipient{item.recipients !== 1 ? 's' : ''}
                              </small>
                            </td>
                            <td>
                              <span
                                className={`cm-badge ${item.status === 'completed' ? 'cm-green' : ''}`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td>
                              {item.sent} / {item.recipients}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="cm-empty">
                    <Icon name={view} />
                    <h3>{query ? 'No matching results' : 'A little room for something new'}</h3>
                    <p>{query ? 'Try another search.' : 'Your ' + view + ' will appear here.'}</p>
                  </div>
                )}
              </div>
            )}
            <div className="cm-table-footer">
              <span>
                {view === 'inbox'
                  ? `Showing up to ${limit} latest matching messages`
                  : `${visible.length} records`}
              </span>
              <span>
                Made for a more human inbox. <span className="cm-copper">✦</span>
              </span>
            </div>
          </section>
          <footer className="cm-footer">
            <span>
              <Logo /> Small messages. Good connections.
            </span>
            <span>Powered by CookieMail</span>
          </footer>
        </div>
      </main>
      {message && (
        <Modal title={message.subject} onClose={() => setMessage(null)} wide>
          <div className="cm-modal-body">
            <div className="cm-message-meta">
              <span className="cm-avatar">{initials(message.fromName || message.from)}</span>
              <div>
                <strong>{message.fromName}</strong>
                <p>
                  {message.from} · {formatDate(message.date)}
                </p>
              </div>
            </div>
            {message.html ? (
              <>
                <p className="cm-help">Remote images are blocked for privacy.</p>
                <iframe
                  title="Email content"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  className="cm-email-frame"
                  srcDoc={emailDocument(message.html)}
                />
              </>
            ) : (
              <pre className="cm-message-text">{message.text}</pre>
            )}
            {admin && (
              <button
                className="cm-button cm-primary"
                onClick={() => {
                  setCompose({
                    to: message.replyTo || message.from,
                    subject: /^re:/i.test(message.subject)
                      ? message.subject
                      : 'Re: ' + message.subject,
                    replyToId: message.id,
                  });
                  setMessage(null);
                }}
              >
                <Icon name="outbox" />
                Reply to sender
              </button>
            )}
          </div>
        </Modal>
      )}
      {subscriber && (
        <SubscriberEditor
          item={subscriber}
          admin={admin}
          close={() => setSubscriber(null)}
          save={async (data) => {
            await api(
              subscriber === 'new' ? '/subscribers' : '/subscribers/' + subscriber.id,
              subscriber === 'new' ? 'POST' : 'PATCH',
              data,
            );
            setSubscriber(null);
            refresh();
            setNotice('Subscriber saved.');
          }}
        />
      )}
      {editor && (
        <TemplateEditor
          item={editor}
          admin={admin}
          close={() => setEditor(null)}
          api={api}
          saved={() => {
            setEditor(null);
            refresh();
            setNotice('Template saved. Ready for a personal touch.');
          }}
        />
      )}
      {compose && (
        <Composer
          initial={compose}
          templates={templates}
          tags={boot?.tags || []}
          close={() => setCompose(null)}
          api={api}
          sent={() => {
            setCompose(null);
            setView('outbox');
            setQuery('');
            refresh();
            setNotice(
              'Email queued. Your configured worker will deliver it; use Process next 10 to send now.',
            );
          }}
        />
      )}
    </section>
  );
}
function SubscriberEditor({
  item,
  admin,
  close,
  save,
}: {
  item: Subscriber | 'new';
  admin: boolean;
  close: () => void;
  save: (v: unknown) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={item === 'new' ? 'A new connection' : 'Subscriber details'} onClose={close}>
      <form
        className="cm-modal-body cm-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await save(
              item === 'new'
                ? {
                    firstName: f.get('firstName'),
                    lastName: f.get('lastName'),
                    email: f.get('email'),
                    tags: String(f.get('tags'))
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                    consent: f.get('consent') === 'on',
                    source: 'operator entry',
                  }
                : {
                    tags: String(f.get('tags'))
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                    ...(f.get('unsubscribe') === 'on' ? { status: 'unsubscribed' } : {}),
                  },
            );
          } catch (e) {
            setError(String((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="cm-form-grid">
          <label>
            First name
            <input
              name="firstName"
              required
              defaultValue={item === 'new' ? '' : item.firstName}
              disabled={item !== 'new'}
              maxLength={80}
            />
          </label>
          <label>
            Last name
            <input
              name="lastName"
              defaultValue={item === 'new' ? '' : item.lastName}
              disabled={item !== 'new'}
              maxLength={80}
            />
          </label>
        </div>
        <label>
          Email address
          <input
            type="email"
            name="email"
            required
            defaultValue={item === 'new' ? '' : item.email}
            disabled={item !== 'new'}
          />
        </label>
        <label>
          Tags
          <input
            name="tags"
            placeholder="Newsletter, Early access"
            defaultValue={item === 'new' ? '' : item.tags.join(', ')}
            disabled={!admin}
          />
          <small>Separate your custom tags with commas.</small>
        </label>
        {item === 'new' ? (
          <label className="cm-check">
            <input name="consent" type="checkbox" required />
            This person explicitly opted in to these emails.
          </label>
        ) : (
          <label className="cm-check">
            <input
              name="unsubscribe"
              type="checkbox"
              disabled={!admin || item.status === 'unsubscribed'}
              defaultChecked={item.status === 'unsubscribed'}
            />
            Unsubscribe from campaigns
          </label>
        )}
        {error && (
          <p role="alert" className="cm-error">
            {error}
          </p>
        )}
        <div className="cm-actions">
          <button className="cm-button" type="button" onClick={close}>
            Cancel
          </button>
          {admin && (
            <button className="cm-button cm-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save subscriber'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
type Api = <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
function TemplateEditor({
  item,
  admin,
  close,
  api,
  saved,
}: {
  item: Template | 'new';
  admin: boolean;
  close: () => void;
  api: Api;
  saved: () => void;
}) {
  const [name, setName] = useState(item === 'new' ? 'A warm welcome' : item.name),
    [subject, setSubject] = useState(item === 'new' ? 'Welcome, {{firstName}} ✨' : item.subject),
    [blocks, setBlocks] = useState<Block[]>(item === 'new' ? initialBlocks : item.blocks),
    [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState('');
  const dragging = useRef<number | null>(null);
  const names = variableNames(subject, blocks);
  const add = (kind: BlockKind) => {
    setBlocks((b) => [
      ...b,
      {
        id: crypto.randomUUID(),
        kind,
        content: {
          heading: 'Your next great idea',
          text: 'A few thoughtful words go a long way.',
          button: 'Find out more',
          image: 'Describe your image',
          divider: '',
          spacer: '',
        }[kind],
        ...(['image', 'button'].includes(kind) ? { url: 'https://example.com' } : {}),
      },
    ]);
    setSelected(blocks.length);
  };
  const move = (from: number, to: number) => {
    if (!admin || to < 0 || to >= blocks.length) return;
    setBlocks((b) => {
      const next = [...b];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
    setSelected(to);
  };
  const update = (patch: Partial<Block>) =>
    setBlocks((b) => b.map((v, i) => (i === selected ? { ...v, ...patch } : v)));
  return (
    <Modal title="Email studio" onClose={close} wide>
      <div className="cm-studio-header">
        <div>
          <input
            aria-label="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!admin}
            maxLength={100}
          />
          <p>Start with a block. Make it feel like you.</p>
        </div>
        <div className="cm-actions">
          <button
            className="cm-button"
            disabled={busy}
            onClick={async () => {
              setError('');
              try {
                const r = await api<any>('/preview', 'POST', {
                  name,
                  subject,
                  blocks,
                  values: Object.fromEntries(
                    names.map((n) => [
                      n,
                      n === 'firstName'
                        ? 'Alex'
                        : n.toLowerCase().includes('url')
                          ? 'https://example.com'
                          : 'Sample ' + n,
                    ]),
                  ),
                });
                setPreview(r.document);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Preview
          </button>
          {admin && (
            <button
              className="cm-button cm-primary"
              disabled={busy || !blocks.length}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(
                    item === 'new' ? '/templates' : '/templates/' + item.id,
                    item === 'new' ? 'POST' : 'PUT',
                    { name, subject, blocks },
                  );
                  saved();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save template
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="cm-error" role="alert">
          {error}
        </p>
      )}
      <div className="cm-studio">
        <aside className="cm-widgets">
          <p className="cm-eyebrow">BUILDING BLOCKS</p>
          <div>
            {(['heading', 'text', 'button', 'image', 'divider', 'spacer'] as BlockKind[]).map(
              (kind) => (
                <button
                  key={kind}
                  aria-label={`Add ${kind} block`}
                  draggable={admin}
                  disabled={!admin || blocks.length >= 50}
                  onDragStart={(e) => {
                    dragging.current = null;
                    e.dataTransfer.setData('text/plain', kind);
                  }}
                  onClick={() => add(kind)}
                >
                  <span>
                    {
                      {
                        heading: 'H₁',
                        text: '¶',
                        button: '↗',
                        image: '▧',
                        divider: '―',
                        spacer: '↕',
                      }[kind]
                    }
                  </span>
                  {kind[0].toUpperCase() + kind.slice(1)}
                </button>
              ),
            )}
          </div>
          <p className="cm-help">
            Click to add, or drag onto the canvas. Move buttons work with keyboard and touch.
          </p>
          <p className="cm-eyebrow">PERSONAL TOUCHES</p>
          <p className="cm-help">
            Write <code>{'{{firstName}}'}</code> or any custom variable in text, subjects or URLs.
          </p>
          <div className="cm-tags">
            {names.map((n) => (
              <span key={n}>{'{{' + n + '}}'}</span>
            ))}
          </div>
        </aside>
        <div className="cm-canvas-area">
          <label className="cm-subject-line">
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!admin}
              maxLength={200}
            />
          </label>
          <div
            className="cm-canvas"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging.current === null) {
                const kind = e.dataTransfer.getData('text/plain') as BlockKind;
                if (
                  admin &&
                  blocks.length < 50 &&
                  ['heading', 'text', 'button', 'image', 'divider', 'spacer'].includes(kind)
                )
                  add(kind);
              }
            }}
          >
            <div className="cm-letter-brand">
              <Logo /> YOUR BRAND
            </div>
            {blocks.map((block, index) => (
              <div
                key={block.id}
                draggable={admin}
                onDragStart={(e) => {
                  dragging.current = index;
                  e.dataTransfer.setData('text/plain', 'move');
                }}
                onDragEnd={() => {
                  dragging.current = null;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  if (dragging.current !== null) {
                    e.preventDefault();
                    e.stopPropagation();
                    move(dragging.current, index);
                    dragging.current = null;
                  }
                }}
                className={`cm-block ${selected === index ? 'cm-selected' : ''}`}
              >
                <button
                  className="cm-block-select"
                  aria-label={`Edit ${block.kind} block ${index + 1}`}
                  onClick={() => setSelected(index)}
                >
                  {block.kind === 'heading' ? (
                    <h2>{block.content}</h2>
                  ) : block.kind === 'text' ? (
                    <p>{block.content}</p>
                  ) : block.kind === 'button' ? (
                    <span className="cm-email-cta">{block.content} →</span>
                  ) : block.kind === 'image' ? (
                    <div className="cm-image-placeholder">
                      ▧<small>{block.content || 'Your image here'}</small>
                    </div>
                  ) : block.kind === 'divider' ? (
                    <hr />
                  ) : (
                    <div className="cm-spacer">↕ breathing room</div>
                  )}
                </button>
                {admin && (
                  <div className="cm-block-controls">
                    <button
                      aria-label={`Move block ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move block ${index + 1} down`}
                      disabled={index === blocks.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`Delete block ${index + 1}`}
                      onClick={() => {
                        setBlocks((b) => b.filter((_, i) => i !== index));
                        setSelected(Math.max(0, index - 1));
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="cm-drop-hint">+ Drop a block here</div>
          </div>
          <p className="cm-help">
            Images are placeholders in the editor. The final email uses your image URL.
          </p>
        </div>
        <aside className="cm-properties">
          <p className="cm-eyebrow">BLOCK DETAILS</p>
          {blocks[selected] ? (
            <div className="cm-form">
              <strong>{blocks[selected].kind.toUpperCase()}</strong>
              {!['divider', 'spacer'].includes(blocks[selected].kind) && (
                <label>
                  {blocks[selected].kind === 'image' ? 'Alternative text' : 'Content'}
                  <textarea
                    rows={7}
                    value={blocks[selected].content}
                    onChange={(e) => update({ content: e.target.value })}
                    disabled={!admin}
                  />
                </label>
              )}
              {['image', 'button'].includes(blocks[selected].kind) && (
                <label>
                  HTTP(S) URL
                  <input
                    value={blocks[selected].url || ''}
                    onChange={(e) => update({ url: e.target.value })}
                    disabled={!admin}
                  />
                </label>
              )}
              <p className="cm-help">
                Your message, with a personal touch. Variables are requested when you compose.
              </p>
            </div>
          ) : (
            <p>Select a block to edit.</p>
          )}
        </aside>
      </div>
      {preview && (
        <div className="cm-preview-area">
          <div className="cm-actions">
            <strong>Sample email preview</strong>
            <button className="cm-button" onClick={() => setPreview('')}>
              Close preview
            </button>
          </div>
          <iframe title="Template preview" sandbox="" srcDoc={preview} className="cm-email-frame" />
        </div>
      )}
    </Modal>
  );
}
function Composer({
  initial,
  templates,
  tags,
  close,
  api,
  sent,
}: {
  initial: { to?: string; subject?: string; replyToId?: string };
  templates: Template[];
  tags: string[];
  close: () => void;
  api: Api;
  sent: () => void;
}) {
  const [mode, setMode] = useState('text'),
    [audience, setAudience] = useState('person'),
    [to, setTo] = useState(initial.to || ''),
    [chosenTag, setChosenTag] = useState(tags[0] || ''),
    [subject, setSubject] = useState(initial.subject || ''),
    [body, setBody] = useState(''),
    [templateId, setTemplateId] = useState(templates[0]?.id || ''),
    [values, setValues] = useState<Record<string, string>>({}),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const template = templates.find((t) => t.id === templateId);
  const names = (template?.variables || []).filter(
    (n) => audience !== 'tag' || !['firstName', 'lastName', 'email'].includes(n),
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!review) {
      setReview(true);
      return;
    }
    setBusy(true);
    try {
      await api('/send', 'POST', {
        idempotencyKey: key.current,
        ...(audience === 'tag' ? { tag: chosenTag } : { to }),
        ...(mode === 'template'
          ? { templateId, values }
          : { subject, ...(mode === 'html' ? { html: body } : { text: body }) }),
        ...(initial.replyToId ? { replyToId: initial.replyToId } : {}),
      });
      sent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={initial.replyToId ? 'Reply to conversation' : 'A little note, a big connection'}
      onClose={close}
    >
      <form className="cm-modal-body cm-form" onSubmit={submit}>
        {review ? (
          <>
            <div className="cm-review">
              <Icon name="outbox" />
              <h3>Ready to queue this email?</h3>
              <p>
                {audience === 'tag'
                  ? `One personalized email to each subscribed person tagged “${chosenTag}”.`
                  : `To: ${to}`}
              </p>
              <strong>{mode === 'template' ? template?.name : subject}</strong>
              <p>
                Campaigns include unsubscribe links. Delivery runs through your configured worker.
              </p>
            </div>
            <button
              type="button"
              className="cm-button"
              onClick={() => {
                setReview(false);
                key.current = crypto.randomUUID();
              }}
            >
              Back to editing
            </button>
          </>
        ) : (
          <>
            <div className="cm-segment" aria-label="Audience">
              <button
                type="button"
                className={audience === 'person' ? 'cm-on' : ''}
                onClick={() => setAudience('person')}
              >
                One person
              </button>
              <button
                type="button"
                disabled={!!initial.replyToId}
                className={audience === 'tag' ? 'cm-on' : ''}
                onClick={() => setAudience('tag')}
              >
                Subscriber tag
              </button>
            </div>
            {audience === 'person' ? (
              <label>
                To
                <input
                  type="email"
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  readOnly={!!initial.replyToId}
                  placeholder="hello@example.com"
                />
              </label>
            ) : (
              <label>
                Send to tag
                <select required value={chosenTag} onChange={(e) => setChosenTag(e.target.value)}>
                  <option value="">Choose an audience</option>
                  {tags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <small>Only active subscribers receive the campaign.</small>
              </label>
            )}
            <div className="cm-segment" aria-label="Email format">
              {['text', 'html', 'template'].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? 'cm-on' : ''}
                  onClick={() => setMode(m)}
                >
                  {m === 'text' ? 'Free text' : m === 'html' ? 'HTML email' : 'Saved template'}
                </button>
              ))}
            </div>
            {mode === 'template' ? (
              <>
                <label>
                  Template
                  <select
                    required
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value);
                      setValues({});
                    }}
                  >
                    <option value="">Choose a template</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                {audience === 'tag' && (
                  <p className="cm-help">
                    firstName, lastName and email come from each subscriber.
                  </p>
                )}
                {names.map((n) => (
                  <label key={n}>
                    {n}
                    <input
                      required
                      value={values[n] || ''}
                      onChange={(e) => setValues({ ...values, [n]: e.target.value })}
                      placeholder={`Value for {{${n}}}`}
                      maxLength={4000}
                    />
                  </label>
                ))}
              </>
            ) : (
              <>
                <label>
                  Subject
                  <input
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                  />
                </label>
                <label>
                  {mode === 'html' ? 'HTML content' : 'Your message'}
                  <textarea
                    required
                    rows={9}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={mode === 'html' ? 60000 : 30000}
                    placeholder={mode === 'html' ? '<p>Hello there,</p>' : 'Hi there,\n\n'}
                  />
                </label>
                {mode === 'html' && (
                  <p className="cm-help">
                    Scripts, forms and unsafe markup are removed before sending.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {error && (
          <p className="cm-error" role="alert">
            {error}
          </p>
        )}
        <div className="cm-actions">
          <button type="button" className="cm-button" onClick={close}>
            Cancel
          </button>
          <button className="cm-button cm-primary" disabled={busy}>
            {busy ? 'Queuing…' : review ? 'Confirm & queue' : 'Review email'}
            <Icon name="arrow" />
          </button>
        </div>
      </form>
    </Modal>
  );
}
/** Host endpoint owns CAPTCHA, allowed tags, rate limits and consent policy. */
export function SubscribeForm({
  action,
  label = 'Keep me in the loop',
}: {
  action: string;
  label?: string;
}) {
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="cm-subscribe"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        try {
          if (!/^\/(?!\/)/.test(action) || /[?#\\]/.test(action))
            throw new Error('Use a same-origin subscription endpoint');
          const res = await fetch(action, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firstName: f.get('firstName'),
              lastName: f.get('lastName'),
              email: f.get('email'),
              consent: f.get('consent') === 'on',
            }),
          });
          if (!res.ok) throw new Error('Unable to subscribe. Please try again.');
          setStatus('Thanks! You’re on the list.');
          form.reset();
        } catch (e) {
          setStatus((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        First name
        <input name="firstName" required maxLength={80} />
      </label>
      <label>
        Last name
        <input name="lastName" maxLength={80} />
      </label>
      <label>
        Email
        <input type="email" name="email" required maxLength={254} />
      </label>
      <label>
        <input type="checkbox" name="consent" required />I agree to receive these emails. I can
        unsubscribe any time.
      </label>
      <button disabled={busy}>{busy ? 'Joining…' : label}</button>
      <p role="status">{status}</p>
    </form>
  );
}
