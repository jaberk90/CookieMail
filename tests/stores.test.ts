import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { atomic, documents, type MailStore } from '../src/store.js';
import { sqliteStore } from '../src/sqlite.js';
async function contract(store: MailStore) {
  const t = 'test-' + randomUUID();
  await atomic(store, t, async (tx) => {
    assert.equal(await tx.get('item-1'), null);
    tx.put('item-1', { count: 0 });
  });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      atomic(store, t, async (tx) => {
        const v = await tx.get('item-1');
        tx.put('item-1', { count: Number(v!.count) + 1 });
      }),
    ),
  );
  assert.equal((await store.read(t, 'item-1'))?.value.count, 4);
  assert.equal(await store.read(t + '-other', 'item-1'), null);
  for (const n of [2, 3])
    await atomic(store, t, async (tx) => {
      await tx.get('item-' + n);
      tx.put('item-' + n, { count: n });
    });
  const first = await store.page(t, 'item-', undefined, 2);
  assert.equal(first.items.length, 2);
  assert.ok(first.cursor);
  assert.equal((await store.page(t, 'item-', first.cursor, 2)).items.length, 1);
  let count = 0;
  for await (const _ of documents(store, t, 'item-')) count++;
  assert.equal(count, 3);
  assert.equal(
    await store.commit(
      t,
      [{ key: 'item-1', revision: 'wrong' }],
      [{ key: 'item-1', revision: randomUUID(), value: { count: -1 } }],
    ),
    false,
  );
  assert.equal((await store.read(t, 'item-1'))?.value.count, 4);
}
test('SQLite store contract', async () => {
  const store = sqliteStore(':memory:');
  try {
    await contract(store);
  } finally {
    await store.close?.();
  }
});
test('PostgreSQL store contract', { skip: !process.env.COOKIE_MAIL_TEST_POSTGRES }, async () => {
  const { Pool } = await import('pg');
  const { postgresStore } = await import('../src/postgres.js');
  const pool = new Pool({ connectionString: process.env.COOKIE_MAIL_TEST_POSTGRES });
  try {
    const store = postgresStore(pool);
    await store.initialize();
    await contract(store);
  } finally {
    await pool.end();
  }
});
test('DynamoDB Local store contract', { skip: !process.env.COOKIE_MAIL_TEST_DYNAMO }, async () => {
  const { DynamoDBClient, CreateTableCommand, DeleteTableCommand } =
    await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const { dynamodbStore } = await import('../src/dynamodb.js');
  const client = new DynamoDBClient({
    endpoint: process.env.COOKIE_MAIL_TEST_DYNAMO,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const TableName = 'cookiemail-' + randomUUID();
  await client.send(
    new CreateTableCommand({
      TableName,
      KeySchema: [
        { AttributeName: 'tenant', KeyType: 'HASH' },
        { AttributeName: 'key', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'tenant', AttributeType: 'S' },
        { AttributeName: 'key', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  try {
    await contract(dynamodbStore(DynamoDBDocumentClient.from(client), TableName));
  } finally {
    await client.send(new DeleteTableCommand({ TableName }));
    client.destroy();
  }
});
test(
  'Firestore emulator store contract',
  { skip: !process.env.FIRESTORE_EMULATOR_HOST },
  async () => {
    const { Firestore } = await import('@google-cloud/firestore');
    const { firestoreStore } = await import('../src/firestore.js');
    const db = new Firestore({ projectId: 'cookiemail-test' });
    try {
      await contract(firestoreStore(db, 'contract_' + randomUUID().replaceAll('-', '')));
    } finally {
      await db.terminate();
    }
  },
);
test(
  'Cosmos DB disposable database contract',
  { skip: !process.env.COOKIE_MAIL_TEST_COSMOS },
  async () => {
    const { CosmosClient } = await import('@azure/cosmos');
    const { cosmosStore } = await import('../src/cosmos.js');
    const client = new CosmosClient(process.env.COOKIE_MAIL_TEST_COSMOS!);
    const { database } = await client.databases.create({ id: 'cookiemail-test-' + randomUUID() });
    try {
      const { container } = await database.containers.create({
        id: 'documents',
        partitionKey: '/tenant',
      });
      await contract(cosmosStore(container));
    } finally {
      await database.delete();
      client.dispose();
    }
  },
);
