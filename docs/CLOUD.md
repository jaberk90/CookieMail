# Cloud setup

CookieMail separates the mailbox (`MailProvider`) from durable application storage (`MailStore`). IMAP receives mail and SMTP sends it; cloud databases store subscribers, templates, sent-message snapshots and outbox state. Deploy the private API and a trusted scheduled worker using the same store, `workspace` and mailbox configuration. This repository does not provision resources or grant IAM permissions automatically.

| Platform         | Recommended store      | Runtime                                              | Worker                                     |
| ---------------- | ---------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Firebase         | Firestore Admin SDK    | Functions v2 Node 22/24 supported by your project    | `onSchedule` every minute                  |
| Google Cloud     | Firestore / PostgreSQL | Cloud Run Node 22/24 container                       | Cloud Scheduler authenticated endpoint/job |
| AWS              | DynamoDB / PostgreSQL  | Lambda via your Express adapter, or ECS              | EventBridge schedule                       |
| Azure            | Cosmos DB / PostgreSQL | App Service/container or Functions with host adapter | Timer trigger                              |
| Traditional Node | PostgreSQL / SQLite    | Persistent Node process                              | Your scheduler                             |

The adapters share optimistic concurrency and atomic multi-document commit semantics. Collection scans are deliberately bounded at 5,000 records; this is a small-workspace release, not a high-volume marketing service. There is no schema migration from CookieCaseKit; CookieMail owns separate tables/collections.

## Firebase / Google Cloud

```sh
npm install @google-cloud/firestore
```

```ts
import { Firestore } from '@google-cloud/firestore';
import { firestoreStore } from 'cookiemail/firestore';
const store = firestoreStore(new Firestore(), 'cookiemail');
```

Firebase Admin's `getFirestore()` is also usable as the caller-owned Firestore instance. Credentials use the server's application default identity; do not ship a service account JSON file to the browser. Give the runtime identity access to the dedicated collection/database. Firebase client security rules should deny direct access to CookieMail data; the private Node API enforces operator authorization.

```ts
// functions.ts: load config lazily inside handlers, after secrets become available.
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
const secrets = ['IMAP_PASS', 'SMTP_PASS'].map(defineSecret);
// getAppAndMail() returns a singleton { app, mail }, created using your host integration.
export const mailApi = onRequest({ secrets, timeoutSeconds: 120 }, async (req, res) => {
  const { app } = await getAppAndMail();
  app(req, res);
});
export const mailDelivery = onSchedule(
  {
    schedule: '* * * * *',
    secrets,
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async () => {
    const { mail } = await getAppAndMail();
    await mail.flush(5); // budget worst-case SMTP time against the function timeout
  },
);
```

Firebase Hosting must route both `/api/mail/**` and `/mail-public/**` to your function. The `/mail` UI page belongs to your host app. Set `publicOrigin` to the exact Hosting/custom domain URL, not the internal Cloud Run hostname. If you support multiple origins, create separately configured instances or canonicalize to one origin; do not reflect arbitrary Origin headers.

For Cloud Run, use the included container example as a starting point for your own host app. Deploy using an authenticated scheduler and least-privilege service account. The scheduler endpoint is a host responsibility and must never be anonymous.

## AWS DynamoDB

```sh
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dynamodbStore } from 'cookiemail/dynamodb';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const store = dynamodbStore(client, process.env.COOKIE_MAIL_TABLE!);
```

Create a table with **tenant** (String partition key) and **key** (String sort key), on-demand billing initially. Runtime IAM requires GetItem, Query, PutItem and transactional reads/writes through TransactWriteItems to that table; scope access to your application resources. Use a Lambda/ECS execution role and Secrets Manager for mailbox credentials. Lambda needs your host's Express-to-Lambda adapter; none is implicitly installed. EventBridge invokes a worker that calls `mail.flush(5)`. The SMTP provider can use SES SMTP credentials; inbox receiving still needs an IMAP mailbox (SES is not an IMAP inbox).

## Azure Cosmos DB

```sh
npm install @azure/cosmos
```

```ts
import { CosmosClient } from '@azure/cosmos';
import { cosmosStore } from 'cookiemail/cosmos';
const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING!);
const container = client.database('cookiemail').container('documents');
const store = cosmosStore(container);
```

Create a Cosmos DB **NoSQL** container with partition key **/tenant** and Session or stronger consistency. Keep its default indexing policy (the adapter queries `id`). Use managed identity/AAD with the SDK where possible; otherwise store the connection string in Key Vault. The runtime needs item read/query/create/replace and transactional batch permissions on this container. Use App Service/container for Express, or your Azure Functions host adapter. A Timer trigger calls `mail.flush(5)`. Mail delivery still uses your configured SMTP service/custom `MailProvider`; Azure storage alone does not provide an inbox.

## PostgreSQL (all clouds)

```sh
npm install pg
```

```ts
import { Pool } from 'pg';
import { postgresStore } from 'cookiemail/postgres';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = postgresStore(pool);
await store.initialize(); // once in a migration/setup process, with DDL permission
```

The adapter creates `cookiemail_documents (tenant, key, revision, value jsonb)` with a composite primary key. Runtime needs SELECT/INSERT/UPDATE, not schema ownership. Use provider-recommended verified TLS. Transactions use per-workspace advisory locking. Pool lifecycle remains caller-owned (`pool.end()` when your host shuts down).

## Environment and secrets

Non-secret server configuration:

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

Secrets: `IMAP_PASS` (or an OAuth access token supplied by your host), `SMTP_PASS`, and `DATABASE_URL` / Cosmos connection string only if you use password/connection-string authentication. Google/AWS SDKs normally use workload identity rather than static keys. No Gmail/Microsoft OAuth client IDs are needed for app-password IMAP/SMTP, but providers must permit the selected login method. Do not disable TLS verification.

## Production acceptance checklist

- Exercise inbox read/search and a real reply with a disposable mailbox.
- Verify sender domain, SMTP acceptance, spam-folder behavior and provider limits.
- Send a two-person tag campaign and verify personalized fields and unsubscribe URLs.
- Verify unsubscribe before delivery suppresses a queued recipient.
- Verify host auth rejects unauthenticated/non-operator access and proxy writes use the configured origin.
- Verify shared database permissions, backups, restart recovery and scheduled worker invocation.
- Reconcile an uncertain SMTP delivery without duplicate sends.
- Confirm API / worker deadlines accommodate the chosen batch size.

Local tests cannot establish real provider deliverability or deployed IAM correctness. Cloud store tests are opt-in via the contract test environment variables; see `tests/stores.test.ts`. Cosmos/cloud credentials are not included.

## Scheduled email workers

Scheduling in v2 is stored in your existing database. No extra queue product or browser timer is required. Upgrade both API and workers to v2 and run `await mail.flush(5)` every minute with the same workspace/store/mailbox configuration. The worker atomically claims only due jobs. Keep one scheduled worker per workspace for predictable provider limits; concurrent invocations are lease-protected. Choose a batch size and timeout that fit your SMTP provider.

- **Firebase:** keep the `onSchedule` handler above, with `schedule: 'every 1 minutes'`, SMTP secrets and Firestore server access.
- **Google Cloud:** Cloud Scheduler invokes a private Cloud Run worker/job using a dedicated service account. That handler calls `mail.flush(5)`; require authenticated invocation.
- **AWS:** EventBridge invokes a Lambda handler that obtains your configured mail instance and calls `mail.flush(5)`. Its execution role needs the DynamoDB table and mail-secret access.
- **Azure:** a Timer-triggered Function calls `mail.flush(5)` using the configured Cosmos/PostgreSQL store and mailbox credentials.

A future `scheduledAt` is never made due by clicking **Process next 10**. Outages deliver later, on the next successful worker run. Cancel/reschedule is allowed only before a worker claims the job and before any recipient is processed. Do not expose an anonymous flush endpoint. Keep the server clock synchronized.

The UI uses the browser’s time zone; API timestamps require an explicit offset and are normalized to UTC. Run acceptance tests with a disposable inbox: future send, cancel before due, restart before due, subscribed/unsubscribed tag recipients, and Trash recovery. New sent-copy records use the same tenant partition and atomic store contract, so no SQL/table/index migration is required. Their contents are private and need retention/backups configured by the host.
