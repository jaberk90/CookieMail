# CookieMail

**Your inbox. A little more human.**

An embeddable email workspace for Node.js and React: a private inbox, tagged subscribers, a visual template studio, and a durable send queue. Bring your own authentication and mailbox. CookieStocks-inspired Carbon & Copper themes follow your app’s light/dark setting.

![CookieMail inbox in dark mode](docs/screenshots/inbox-dark-desktop.png)

## What you can do

- Fetch the latest **25 or 50** matching inbox messages. Search subject/sender, filter unread, read, reply and move emails to Trash.
- View saved per-recipient sent emails and resend a copy with confirmation.
- Schedule emails or tag campaigns, change their send time, or cancel before delivery starts.
- Compact summary cards leave more room for your inbox on desktop and mobile.
- Compose plain text, sanitized HTML, or a saved template. Review the recipient/audience before queuing.
- Collect first name, last name and email with explicit consent; organize subscribers with custom tags.
- Send separate personalized messages to everyone subscribed to a tag. Subscriber addresses are never exposed in a shared To/CC field.
- Build templates with draggable **heading, text, button, image, divider and spacer** blocks. Keyboard/touch move buttons provide the same ordering controls.
- Use `{{firstName}}`, `{{productName}}`, or other named variables. The composer automatically creates the required input fields. Tag campaigns fill `firstName`, `lastName`, and `email` from subscribers.
- Use SQLite locally or **Firestore (Firebase/Google Cloud), DynamoDB (AWS), Cosmos DB (Azure), PostgreSQL** in production.

CookieMail 2.0 provides an embeddable mail workspace with host-owned authentication. Automated tests cover the core with a fake mailbox and database contracts. Real IMAP/SMTP delivery, cloud IAM and deployed cloud databases require your environment’s acceptance checks before production use.

## Run the demo

Node **22.13+** (22 or 24 recommended).

```sh
npm ci
npm run check
npm run demo
```

Open **http://127.0.0.1:3177**. The demo binds only to loopback, signs in a fake operator, and uses in-memory data and fake email delivery. It **never sends real email**. Restarting resets the demo. `/subscribe` demonstrates the embeddable subscription section.

## Install in your Node app

Install from npm:

```sh
npm install cookiemail@2.1.0
```

For local package development, build and install a tarball:

```sh
# In CookieMail
npm pack
# In your Node app, use the resulting absolute path
npm install /absolute/path/to/cookiemail-2.0.0.tgz
```

React is an optional peer; install it only for the UI. Install only the database SDK you use. Import the server API only in server code, never a browser bundle.

```ts
import express from 'express';
import { createCookieMail, imapSmtpProvider } from 'cookiemail';
import { sqliteStore } from 'cookiemail/sqlite';

const app = express();
const mail = createCookieMail({
  store: sqliteStore('./data/mail.sqlite'), // create ./data first
  workspace: 'my-company', // stable partition, not a browser parameter
  publicOrigin: 'https://your-app.example', // exact browser-facing origin, even behind a proxy
  publicBasePath: '/mail-public',
  brand: 'Your company',
  auth: async (req) => {
    const user = await yourVerifiedSession(req); // your existing auth middleware/SDK
    if (!user?.canManageMail) return null;
    return { id: user.id, name: user.name, email: user.email, role: 'admin' };
  },
  provider: imapSmtpProvider({
    from: 'Your Company <hello@your-domain.example>',
    imap: {
      host: process.env.IMAP_HOST!,
      trashMailbox: process.env.IMAP_TRASH_MAILBOX, // optional; otherwise detects IMAP \\Trash
      auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASS! },
    },
    smtp: {
      host: process.env.SMTP_HOST!,
      port: 587,
      secure: false,
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    },
  }),
  logger: console,
});
app.use('/api/mail', mail.router); // private, host-authenticated operator API
app.use('/mail-public', mail.publicRouter); // ONLY token-based unsubscribe endpoints
```

`role: 'viewer'` permits read-only access to inbox/audience/templates/outbox/sent; only `admin` can write or send. Mount the private React page behind your host’s authorization too. Credentials remain in server environment/secret manager configuration. No public inbox or subscriber-list route is created.

`auth` must verify session cookies or bearer tokens, permissions and any MFA policy itself. Do not trust a supplied user ID, tenant or role. One configured instance connects one mailbox and one trusted `workspace` partition. For multiple tenants, select instances using a verified server-side tenant mapping.

The IMAP adapter uses TLS on port 993. SMTP requires verified TLS (465 implicit TLS or 587 STARTTLS). An OAuth access token can be passed as IMAP `auth.accessToken`; the host owns token refresh and provider consent. Native Gmail API / Microsoft Graph OAuth onboarding is not included. Receiving means fetching the connected mailbox on page load/Refresh; there is no background push listener.

## Embed the panel in React

```tsx
import { CookieMail } from 'cookiemail/react';
import 'cookiemail/react.css';

export function MailPage() {
  const [theme, setTheme] = useYourAppTheme();
  return (
    <CookieMail
      key={currentUser.uid} // unmount private state when the signed-in identity changes
      basePath="/api/mail"
      theme={theme}
      onThemeChange={setTheme}
      getToken={() => currentUser.getIdToken()}
      onUnauthorized={() => navigate('/login')}
    />
  );
}
```

Omit `getToken` for same-origin cookie sessions. Omit theme props for an independent locally remembered theme (dark by default). A controlled theme without `onThemeChange` hides the local toggle. Styles use `cm-` class names and `--cm-` variables to avoid host toolbar/brand collisions. Requests use same-origin paths; set `publicOrigin` to your browser URL, including the port locally.

![Light inbox](docs/screenshots/inbox-light-desktop.png)

## Add a subscription section

**The visitor never calls the private mailbox API.** Add a small host endpoint that performs your CAPTCHA/bot checks and fixes the tags on the server. The reusable [integration example](examples/integration.ts) includes origin checks, rate limiting, body limits and an injected signup verifier.

```ts
// After your body parser, rate limiter and signup verification:
await mail.subscribe({
  firstName: req.body.firstName,
  lastName: req.body.lastName,
  email: req.body.email,
  consent: req.body.consent, // must be literal true from an explicit checkbox
  source: 'homepage-newsletter',
  tags: ['Newsletter', 'Website'], // chosen by your SERVER, never spread req.body
});
res.json({ ok: true });
```

```tsx
import { SubscribeForm } from 'cookiemail/react';
import 'cookiemail/react.css';

<section>
  <h2>A few good things, in your inbox.</h2>
  <p>Join our newsletter. Leave whenever you like.</p>
  <SubscribeForm action="/subscribe" label="Join the newsletter" />
</section>;
```

The form posts `{ firstName, lastName, email, consent }` as JSON to your endpoint. For CAPTCHA, use your own form to collect the provider token and verify it in your server endpoint, or use your existing verified-session signup flow. This helper does not invent a CAPTCHA bypass.

Email addresses are normalized/deduplicated within the workspace; repeated signups merge tags. Subscriber consent/source/time are recorded. Unsubscribed addresses are **not silently reactivated** by another form submission; a separately verified re-consent process is needed. Double opt-in confirmation emails are not implemented yet. Do not import an audience without their permission.

### Put the signup form in your footer (or any page)

Use a shared layout to show it across your whole website. The form is independent of the private mail panel: visitors do not need operator access, and no inbox UI appears on the public page.

```tsx
import { SubscribeForm } from 'cookiemail/react';
import 'cookiemail/react.css';

export function SiteLayout({ children }) {
  return (
    <>
      <main>{children}</main>
      <footer className="cm-signup-footer" data-theme="dark">
        <div className="cm-signup-copy">
          <span className="cm-signup-label">LET’S KEEP IN TOUCH</span>
          <h2>
            A few good things.
            <br />
            Straight to your inbox.
          </h2>
          <p>Product news and thoughtful updates. Unsubscribe any time.</p>
        </div>
        <div className="cm-signup-card">
          <h3>Join our newsletter</h3>
          <SubscribeForm action="/subscribe" label="Count me in →" />
        </div>
      </footer>
    </>
  );
}
```

Use `data-theme={yourAppTheme}` to match your website. Place the same `SubscribeForm` on a landing page, article page, sidebar or modal. A complete styled component is in [examples/footer-signup.tsx](examples/footer-signup.tsx); change its local source import to `cookiemail/react` when copying it to your host app.

**Wire `/subscribe` to the Node route shown above.** The footer sends names, email and the consent checkbox; the server assigns `tags: ['Newsletter', 'Website']`. If you need separate audiences, create `/subscribe/product-updates` and `/subscribe/events` host routes with their own fixed tags, then set the form’s `action` accordingly. Never let a public visitor supply arbitrary tags or bypass consent/bot validation.

After submitting, open the private **Subscribers** panel to see the person and tags. To email this group: **Compose email → Subscriber tag → Newsletter**, then choose free text, HTML or a template. **Confirm & queue** creates the campaign; the scheduled worker (or operator’s **Process next 10**) sends it.

Preview this footer locally at **http://127.0.0.1:3177/subscribe** after `npm run demo`.

![Public footer signup section](docs/screenshots/footer-signup-desktop.png)

### Tags and campaigns

In **Subscribers**, add a person or click an existing subscriber to edit comma-separated tags. In **Compose email**, choose **Subscriber tag**, then select a tag. Only subscribed members are included. They are checked again just before delivery, so an opt-out after queuing suppresses delivery. Current limits: 12 tags/subscriber, 500 recipients/campaign, 5,000 records per workspace collection scan.

Each campaign email includes an unsubscribe link and List-Unsubscribe headers. The link’s GET displays confirmation; POST unsubscribes, including the standard one-click request. Deploy `publicRouter` at the configured `publicBasePath`, publicly reachable over HTTPS. It never exposes subscription records or tokens in the admin list API.

## Build and use a template

1. Open **Templates → Create template**. Give it a name and subject.
2. Click a widget or drag it onto the canvas. Click a block to edit text/URL in Block details.
3. Reorder by dragging a block or using its ↑/↓ controls. Both work with keyboard/touch.
4. Add variables such as `Hello {{firstName}}` or `Meet {{productName}}`. Names use letters, numbers and underscores, starting with a letter.
5. Preview with sample values and save.
6. Compose → **Saved template**. Choose the template and fill the generated variable inputs. For tag sends, name/email fields come from the subscriber; custom fields are shared across the campaign.
7. Review, then **Confirm & queue**.

![Visual template studio](docs/screenshots/studio-desktop.png)

Variable values are escaped as text, and links must resolve to HTTP(S). Blank/missing variables prevent queuing. Images use HTTPS URLs you own; uploads, arbitrary custom widgets and an image library are not included. Reader/preview iframes are sandboxed and remote images blocked, while the sent email contains the actual image URL. Rich email layout support is intentionally restricted for security and client compatibility.

## Schedule, view, resend and remove email

**Schedule:** Compose an email (text, HTML or template), choose **Delivery time → Schedule for later**, enter a date/time, review and **Confirm schedule**. Times are entered in the browser’s displayed time zone and stored as UTC. In **Outbox**, use **Change schedule** or **Cancel send** before sending starts. **Send now** means the next worker run; **Process next 10** also respects future schedules.

**Sent:** Open **Sent**, select a message, then **Resend email → Confirm resend** to queue a new copy to the same recipient. You can schedule the resend too. The saved subject/body preserve the original personalized content; resending does not re-render an edited template or use a subscriber’s changed name. Campaign unsubscribe checks still run before queueing and immediately before delivery. Each resend receives a new Message-ID and its own history record. Provider acceptance is not an inbox-delivery/read receipt.

**Remove from inbox:** Open an email, choose **Move to Trash**, then confirm. The IMAP adapter uses the provider’s special-use Trash folder, or `imap.trashMailbox` (for example a provider-specific path passed through `IMAP_TRASH_MAILBOX`). If no Trash folder is available, configure an existing folder; CookieMail never falls back to permanent deletion. Recover moved messages in your provider’s mailbox UI. Custom providers can implement `trash(id)`; without it the button stays hidden and the API returns 501.

![Schedule an email](docs/screenshots/schedule-desktop.png)
![View a saved sent email](docs/screenshots/sent-reader-desktop.png)

[Mobile scheduling](docs/screenshots/schedule-mobile.png) · [Mobile sent history](docs/screenshots/sent-mobile.png) · [Trash confirmation](docs/screenshots/trash-confirm-desktop.png) · [Scheduled outbox](docs/screenshots/outbox-scheduled-desktop.png)

### Call directly from Node

```ts
const job = await mail.queue({
  idempotencyKey: crypto.randomUUID(),
  to: 'alex@example.com',
  subject: 'A note for later',
  text: 'The full message.',
  scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
});
await mail.reschedule(String(job.id), new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());
// await mail.cancel(String(job.id)); // only before sending starts
// await mail.reschedule(String(job.id), null); // queue for the next worker run

const sent = await mail.listSent();
if (sent.length) {
  const copy = await mail.getSent(String(sent[0].id));
  console.log(copy.subject, copy.text);
  // Explicitly request another copy, using the same UUID when retrying this request:
  await mail.resend(copy.id, { idempotencyKey: crypto.randomUUID() });
}
// await mail.trash(inboxMessage.id); // moves an inbox email to Trash
```

Scheduling accepts ISO timestamps with a time-zone offset, in the future and within 366 days. The worker may run later than the requested time; it never intentionally sends before it. Missing/stopped workers do not deliver mail. Browser tabs need not remain open. The same queue and worker work with all five store adapters; see [cloud worker setup](docs/CLOUD.md#scheduled-email-workers).

### Private API additions

Paths below are relative to your mounted private router. All reads require an authenticated operator; mutations require an admin and the existing origin/JSON/`X-CookieMail` protections.

| Method | Path                   | Purpose                                                            |
| ------ | ---------------------- | ------------------------------------------------------------------ |
| DELETE | `/inbox/:id`           | Move an inbox email to Trash                                       |
| GET    | `/sent`                | List accepted per-recipient snapshots                              |
| GET    | `/sent/:id`            | Read a saved subject/body                                          |
| POST   | `/sent/:id/resend`     | Queue another copy; body: `idempotencyKey`, optional `scheduledAt` |
| POST   | `/send`                | Existing queue API; now accepts optional `scheduledAt`             |
| PATCH  | `/outbox/:id/schedule` | Body: `scheduledAt` ISO string, or `null` for the next worker run  |
| DELETE | `/outbox/:id`          | Cancel an unstarted job; does not recall delivered mail            |

## Deliver queued email

```ts
// Trusted scheduled worker; execute with the same workspace/store/provider configuration.
const result = await mail.flush(10);
// result = { sent, skipped }
```

There are no process timers. Schedule a worker every minute, or let an authorized operator click **Process next 10**. `sent` means your provider accepted the email, not guaranteed inbox delivery. Native bounce/complaint tracking is not included. Use your mail provider’s reputation and suppression tools.

The durable outbox claims work using atomic store transactions. Requests require an idempotency UUID; retries of the same payload use the same key, preventing duplicate enqueueing. Each recipient has a stable Message-ID. If SMTP outcome is uncertain or a worker dies during delivery, the job stops as **uncertain** rather than automatically sending duplicates. Reconcile with your provider before creating a replacement campaign. Exactly-once SMTP delivery cannot be guaranteed. The transport must finish within its configured timeout; custom providers must also implement bounded calls. Worker concurrency is protected by leases, but run one scheduled worker per workspace for predictable provider rate limits.

Direct code works too:

```ts
await mail.queue({
  idempotencyKey: crypto.randomUUID(),
  to: 'customer@example.com',
  subject: 'Hello',
  text: 'A thoughtful note.',
});
await mail.queue({
  idempotencyKey: crypto.randomUUID(),
  tag: 'Newsletter',
  templateId: savedTemplate.id,
  values: { productName: 'Our new release' },
});
await mail.flush(10);
```

No REST call is required from Node. The UI’s HTTP router is optional.

## Cloud deployments

See [Cloud setup](docs/CLOUD.md) for Firebase Functions, Cloud Run, AWS and Azure configuration, database schemas, scheduling and secrets. **Do not deploy SQLite to ephemeral/serverless disks.** Use the appropriate shared store and the same workspace for API and worker. SDK clients and credentials are caller-owned.

## Security, limits and release

See [Security](SECURITY.md) and [Publishing](docs/PUBLISHING.md). The repository includes CI, nightly dependency audit, daily Dependabot PRs and tag-based npm publishing with provenance. No mailbox credentials or cloud accounts are shipped.

Current scope: one inbox folder with safe move-to-Trash; no permanent deletion, attachment download/upload, arbitrary folder moves, sent-folder IMAP append, native OAuth onboarding, double opt-in, analytics/open tracking or provider webhooks. “Sent” contains per-recipient copies accepted through CookieMail v2, not the provider’s entire Sent folder. Version 1 sends remain in Outbox activity, but cannot be retroactively reconstructed as exact sent copies. Search is subject/sender through IMAP and a local filter for the loaded audience/templates. Receiving from an existing mailbox is supported; operating an email server is not.

## Develop

```sh
npm run check                  # type checks, backend tests, package build
npx playwright install chromium
npm run test:ui                # desktop/mobile flows; refreshes README screenshots
npm pack --dry-run             # inspect publish contents
```

[IMAP transport reference](https://imapflow.com/docs/api/imapflow-client/) · [SMTP transport reference](https://nodemailer.com/smtp)

## Server environment variables

Map these into `createCookieMail()` / `imapSmtpProvider()` in your host app; CookieMail does not automatically load environment variables.

```env
MAIL_PUBLIC_ORIGIN=https://your-app.example
MAIL_PUBLIC_BASE_PATH=/mail-public
MAIL_WORKSPACE=my-company
MAIL_FROM=Your Company <hello@your-domain.example>
IMAP_HOST=imap.your-provider.example
IMAP_PORT=993
IMAP_USER=hello@your-domain.example
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=hello@your-domain.example
```

Store `IMAP_PASS` and `SMTP_PASS` as server secrets. Firestore uses your project identity, DynamoDB uses `AWS_REGION` / a table and IAM identity, Cosmos uses its configured database/container and credentials, and PostgreSQL uses `DATABASE_URL`. See [cloud configuration](docs/CLOUD.md).

For GitHub Actions, adapt the repository/environment to your deployment workflow:

```sh
gh variable set IMAP_HOST --repo OWNER/REPO --env production --body 'imap.your-provider.example'
gh secret set IMAP_PASS --repo OWNER/REPO --env production
```

`gh secret set` prompts for the secret. GitHub settings must also be forwarded by your host deployment workflow to the runtime. CookieStocks-specific commands, footer wiring and `/cookieCommunication` access are documented in its [CookieMail integration guide](https://github.com/jaberk90/CookieStocks/blob/main/docs/setup/16-cookiemail.md).

## Upgrading from 1.x

Upgrade the Node package, React component/CSS and every worker to **2.0.0** together. Existing subscriber, template and queue documents remain usable; no database schema migration is needed. New `sent-` documents keep per-recipient snapshots. Previously completed 1.x jobs remain activity entries in Outbox; their exact per-recipient content was not retained and is not backfilled. Sent history does not import your provider’s Sent folder.

Custom `MailProvider` implementations remain valid; implement optional `trash(id)` to enable inbox removal. Keep `flush` on a trusted scheduler and use the same store/workspace across API and workers. Sent snapshots contain private message bodies: protect them with the same server-only permissions, encryption and retention policy as the rest of your mailbox data. Collection scans remain limited to 5,000 records per prefix. Oversized rendered messages are rejected before queueing when their sent copy would exceed the portable 300 KB document budget.

See the [v2.0.0 release notes](docs/RELEASE-2.0.0.md) for changes, migration details and validation limits.

## 2.1.0 maintenance release

See the [release notes](docs/RELEASE-2.1.0.md) for dependency updates and build compatibility. Existing setup, APIs and screenshots remain applicable. Contributors run TypeScript 7 through `npm run typecheck`; tsup uses the compatible TypeScript 5.9 compiler API for package declarations.
