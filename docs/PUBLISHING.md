# Publishing CookieMail

No release is published automatically by local setup. Check that the npm name `cookiemail` is available/owned by your account before the first release; if not, choose an owned scoped name and update package metadata, README and installation examples.

1. Run `npm ci`, `npm run check`, `npm run test:ui`, `npm audit`, and `npm pack --dry-run`.
2. Complete live IMAP/SMTP and cloud acceptance checks in [CLOUD.md](CLOUD.md).
3. Set the same version in `package.json` and `package-lock.json`; write release notes.
4. Merge reviewed changes, tag the tested commit `v0.1.0` (or the selected version), and create a GitHub release.
5. The `Publish npm release` workflow verifies the tag/version, reruns tests/build/audit, and publishes with provenance.

Use npm trusted publishing (OIDC) for GitHub repository `jaberk90/CookieMail`, workflow `publish.yml`, environment `npm`. Configure this in npm package settings and create the GitHub `npm` environment. Add required reviewers if you want a release approval gate. First publication may require your interactive `npm login` / account 2FA flow before trusted publishing can be configured. The optional GitHub environment/repository secret `NPM` supports your existing token-based setup where npm account policy permits it; no token is included here. Stage-only tokens cannot directly publish a package.

Nightly `Security` audits and daily Dependabot PRs run once the workflows are on the default branch. Enable Dependabot security updates/alerts and private security reporting in the repository settings. Private repositories need appropriate GitHub Code Security eligibility for CodeQL; this workflow does not purchase/enable that service.

Do not merge security upgrade PRs blindly. Let CI validate Node 22/24, Windows/Linux, UI flows and database contracts. The SQLite contract always runs; PostgreSQL, DynamoDB Local and Firestore emulator contracts run in CI. Cosmos live testing uses a disposable database and explicit credentials, so it is opt-in. A green local run with cloud tests skipped is not proof of live cloud correctness.
