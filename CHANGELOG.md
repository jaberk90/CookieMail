# Changelog

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
