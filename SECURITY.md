# Security

CookieMail is a server library, not an authentication service. Your host verifies identities, roles, MFA, workspace selection and subscriber consent. Never mount the private router with a development/mock auth callback in production. Only the token-based unsubscribe router is public; implement subscription capture in your host with bot controls, fixed tags, explicit opt-in and rate limits.

The package enforces exact configured-origin checks, a custom write header, JSON content types, viewer/admin permissions, bounded input sizes, HTML sanitization and sandboxed previews. Preview images are blocked to avoid tracking. Remote image URLs in final email are fetched by recipients' mail clients, not this server. IMAP source reads are capped at 2 MB; attachments are not exposed.

Mail credentials are server-only. The official SMTP adapter disables remote/local attachment resolution, verifies TLS and uses bounded connection/socket timeouts. Custom MailProvider implementations must complete calls within a minute. Library instance configuration is trusted; do not let a browser choose mail hosts, credentials, database partitions or sender identities.

Rate limiting is per process. Use gateway/shared limits for multi-instance deployments and your host CAPTCHA for public capture. Native double opt-in, bounce/complaint suppression, anti-abuse scoring and high-volume campaign analytics are not included. Configure those in the host/provider before using such workflows.

Storage is partitioned by the server-selected workspace. Client database access must be denied. Records are not encrypted by the package; use provider encryption, least-privilege access, backups and retention controls. Unsubscribe tokens are bearer capabilities and should not be logged or exposed in subscriber-list responses.

No automatic retry occurs after an ambiguous send; inspect your provider before sending replacements. Worker crashes can leave an uncertain delivery. Stable Message-IDs help reconcile but do not guarantee deduplication at SMTP servers.

Report vulnerabilities privately to the repository owner using GitHub security reporting when enabled. Do not post credentials, inbox content or subscriber addresses in public issues. Nightly audits and daily Dependabot cover dependencies; passing audits does not guarantee absence of vulnerabilities.
