# CookieMail v2.0.0

CookieMail adds scheduled sending, a sent-email reader and resending, and safe inbox removal, with smaller summary cards that leave more room for messages.

## New features

- **Compact cards:** smaller counts and spacing, shorter labels, responsive dark/light themes.
- **Move to Trash:** open a received message and confirm removal. The IMAP adapter discovers the Trash folder or uses configured `imap.trashMailbox`. It validates UID validity and never falls back to permanent deletion.
- **Sent emails:** inspect the saved subject and body accepted by the mail provider for each recipient. Content is sanitized and rendered in a sandbox with remote images blocked.
- **Resend:** explicitly confirm another copy to the original recipient, immediately or later. Each resend gets a fresh Message-ID and queue record. Original personalized content is preserved, and campaign unsubscribe checks remain enforced.
- **Schedule:** choose a local date/time in the composer; the API stores UTC. The existing worker sends only when due, across Firebase/Firestore, Google Cloud, AWS/DynamoDB, Azure/Cosmos DB, PostgreSQL and SQLite.
- **Manage pending sends:** reschedule or cancel before delivery starts. Concurrent workers cannot both claim the same job; uncertain SMTP outcomes still require operator reconciliation.

## Screenshots

![Compact inbox](screenshots/inbox-dark-desktop.png)
![Schedule an email](screenshots/schedule-desktop.png)
![Sent email reader](screenshots/sent-reader-desktop.png)

[Light inbox](screenshots/inbox-light-desktop.png) · [Mobile inbox](screenshots/inbox-dark-mobile.png) · [Mobile schedule](screenshots/schedule-mobile.png) · [Sent history](screenshots/sent-desktop.png) · [Trash confirmation](screenshots/trash-confirm-mobile.png)

## Upgrade

```sh
npm install cookiemail@2.0.0
```

Update API, React/CSS and workers together. No store schema migration is required. Keep a trusted worker invoking `mail.flush(5)` every minute; scheduling does not provision or start a scheduler automatically. Optional `IMAP_TRASH_MAILBOX` can be passed to the provider if it does not advertise Trash. No new secret is required.

Custom providers can implement optional `trash(id)`; without it removal is hidden. Existing 1.x jobs remain visible in Outbox, but previously completed emails have no per-recipient snapshot to reconstruct. Sent history begins with messages processed by v2 and does not synchronize your provider’s full Sent folder. Scheduled delivery is at the first successful worker run after the requested time, not a guaranteed exact second.

## Validation and limits

Automated tests cover future-time validation, due-time enforcement, concurrent claims, cancellation races, immutable sent content, idempotent resends, unsubscribe suppression, tenant isolation, authorization and fake IMAP Trash operations. Desktop/mobile browser tests cover the new controls and produce these screenshots. Package checks verify ESM/CJS/React/SQLite exports; CI also runs storage contracts.

Live SMTP deliverability, Trash conventions, native provider behavior and deployed cloud IAM require a disposable mailbox and your cloud environment. Provider acceptance does not confirm inbox delivery. Collection scans remain bounded to 5,000 records per prefix. Protect private sent bodies with server-only database access and your host’s retention policy.
