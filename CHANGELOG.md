# Changelog

## 2.2.0

- Add idempotent server-side imports of confirmed transactional sent messages and source labels in the UI.
- Support CookieCaseKit notification history/backfill and preserve original threading on explicit resend.
- Update docs and desktop/mobile screenshots. See [release notes](docs/RELEASE-2.2.0.md).

## 2.1.0

- Integrate all nine open dependency PRs, including current GitHub Actions and Node, Nodemailer and Supertest types.
- Run type checks with TypeScript 7 while retaining TypeScript 5.9 for tsup declaration generation.
- Preserve the existing Node/React API and stored data; no database migration or new secret is required.

## 2.0.0

- Compact workspace summary cards on desktop and mobile.
- Move inbox email to provider Trash with explicit confirmation and UID-validity checks.
- Per-recipient sent-message snapshots, a Sent reader, and idempotent resends preserving original content and campaign unsubscribe suppression.
- Durable future scheduling for individual emails and tag campaigns, UTC timestamps, rescheduling and cancellation before delivery starts.
- Atomic due-job claiming and conservative uncertain-delivery handling remain shared across all five storage adapters.
- Updated README, cloud-worker guidance, migration notes and desktop/mobile screenshots.

Upgrade API, React/CSS and workers together. Existing data stays compatible; sent snapshots begin with v2 deliveries and do not import historical/provider Sent mail. See [release notes](docs/RELEASE-2.0.0.md).

## 1.0.0

- Stable Node/React package API for the inbox, subscriber audience, template studio and durable delivery queue.
- npm discovery keywords, homepage and issue-reporting metadata.
- Publish to both npm (`cookiemail`) and GitHub Packages (`@jaberk90/cookiemail`) from a tagged stable GitHub release.
- Retryable, independent registry jobs skip versions already published.
- Updated installation, configuration and footer integration documentation.

Validation covers fake-mail flows and automated storage contracts; live SMTP/IMAP and Cosmos acceptance still depend on operator-owned resources.

## 0.1.0 — initial implementation

- Private embeddable Node/React inbox with latest 25/50 messages, search, unread filtering and replies.
- Carbon & Copper light/dark themes, responsive tables and accessible modal workflows.
- Consent-based subscriber capture, custom tags, personalization and unsubscribe handling.
- Drag-and-drop template studio with six block types and variable-driven compose forms.
- Durable, idempotent queue with isolated recipient messages and conservative uncertain-delivery handling.
- Firestore, DynamoDB, Cosmos DB, PostgreSQL and SQLite storage adapters.
- Local fake-mail demo, screenshots, integration guides and CI/security/release workflows.

Initial npm release. Live mail delivery and cloud deployment acceptance checks require operator-owned test resources.
