import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('inbox, responsive theme, template variables, editor and tagged campaign', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const inboxTotal = (await (await page.request.get('/api/mail/inbox?limit=50')).json()).length;
  await expect(
    page.getByRole('heading', { name: 'Your inbox. A little more human.' }),
  ).toBeVisible();
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(25);
  await page.getByLabel('Inbox limit').selectOption('50');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(inboxTotal);
  await page.getByLabel('Search', { exact: true }).fill('collaboration');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(6);
  await page.getByLabel('Search', { exact: true }).fill('');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(inboxTotal);
  await page.getByLabel('Inbox limit').selectOption('25');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(25);
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.cm')).toHaveAttribute('data-theme', 'light');
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({
    path: `docs/screenshots/inbox-light-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.screenshot({
    path: `docs/screenshots/inbox-dark-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole('button', { name: /A small idea for our next collaboration/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Reply to sender' }).click();
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('maya@northstar.example');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page
    .getByRole('navigation', { name: 'Mail navigation' })
    .getByRole('button', { name: 'Templates', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Make something worth opening.' })).toBeVisible();
  await page.getByRole('button', { name: 'Create template' }).click();
  await page.getByLabel('Template name').fill('Test welcome ' + info.project.name);
  await page.getByRole('button', { name: 'Add text block', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Content', exact: true })
    .fill('Your invitation: {{code}}');
  await page.getByRole('button', { name: 'Move block 4 up' }).click();
  await page.screenshot({
    path: `docs/screenshots/studio-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Mail navigation' })
    .getByRole('button', { name: 'Subscribers' })
    .click();
  await page.getByRole('button', { name: 'Add subscriber' }).click();
  await page.getByLabel('First name', { exact: true }).fill('Taylor');
  await page.getByLabel('Last name', { exact: true }).fill('Test');
  await page.getByLabel('Email address').fill(`taylor-${info.project.name}@example.com`);
  await page.getByLabel('Tags').fill('Test group');
  await page.getByLabel(/explicitly opted/).check();
  await page.getByRole('button', { name: 'Save subscriber' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Mail navigation' })
    .getByRole('button', { name: 'Inbox', exact: true })
    .click();
  await page.getByRole('button', { name: 'Compose email' }).click();
  await page.getByRole('button', { name: 'Subscriber tag', exact: true }).click();
  await page.getByLabel('Send to tag').selectOption('Test group');
  await page.getByRole('button', { name: 'Saved template' }).click();
  await page
    .getByRole('combobox', { name: 'Template', exact: true })
    .selectOption({ label: 'Test welcome ' + info.project.name });
  await expect(page.getByLabel('code', { exact: true })).toBeVisible();
  await page.getByLabel('code', { exact: true }).fill('WELCOME');
  await page.getByRole('button', { name: 'Review email' }).click();
  await page.getByRole('button', { name: 'Confirm & queue' }).click();
  await expect(page.getByRole('heading', { name: 'Every message, accounted for.' })).toBeVisible();
  await page.getByRole('button', { name: 'Process next 10' }).click();
  await expect(page.locator('.cm-table')).toContainText('completed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('subscription form captures names and explicit consent', async ({ page }, info) => {
  await page.goto('/subscribe');
  await page.getByLabel('First name', { exact: true }).fill('Join');
  await page.getByLabel('Last name', { exact: true }).fill('Example');
  await page
    .getByLabel('Email', { exact: true })
    .fill('join-' + info.project.name + '@example.com');
  await page.getByLabel(/I agree/).check();
  await page.getByRole('button', { name: 'Count me in →' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks!');
  await page.screenshot({
    path: `docs/screenshots/footer-signup-${info.project.name}.png`,
    fullPage: true,
  });
});

test('switching collections never renders rows from the previous view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(25);
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole('navigation', { name: 'Mail navigation' })
      .getByRole('button', { name: 'Templates', exact: true })
      .click();
    await expect(page.locator('.cm-template-card').first()).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Mail navigation' })
      .getByRole('button', { name: 'Inbox', exact: true })
      .click();
    await expect(page.locator('.cm-table tbody tr')).toHaveCount(25);
  }
  expect(errors).toEqual([]);
});

test('compact cards, schedule/change/cancel, sent reader/resend and Trash confirmation', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(25);
  const card = await page.locator('.cm-metrics > div').first().boundingBox();
  expect(card!.height).toBeLessThan(105);
  const name = 'Scheduled note ' + info.project.name;
  await page.getByRole('button', { name: 'Compose email' }).click();
  await page.getByLabel('To', { exact: true }).fill('release@example.com');
  await page.getByLabel('Subject', { exact: true }).fill(name);
  await page
    .getByLabel('Your message', { exact: true })
    .fill('The exact sent content for version two.');
  await page.getByLabel('Delivery time').selectOption('later');
  await page.getByRole('button', { name: 'Review email' }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/screenshots/schedule-${info.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Review email' }).click();
  await page.getByRole('button', { name: 'Confirm schedule' }).click();
  const row = page.locator('.cm-table tbody tr').filter({ hasText: name });
  await expect(row).toContainText('scheduled');
  await page.getByRole('button', { name: 'Process next 10' }).click();
  await expect(row).toContainText('scheduled');
  await page.screenshot({
    path: `docs/screenshots/outbox-scheduled-${info.project.name}.png`,
    fullPage: true,
  });
  await row.getByRole('button', { name: 'Change schedule' }).click();
  await page.getByLabel('Delivery time').selectOption('now');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(row).toContainText('queued');
  await page.getByRole('button', { name: 'Process next 10' }).click();
  await expect(row).toContainText('completed');
  const nav = page.getByRole('navigation', { name: 'Mail navigation' });
  await nav.getByRole('button', { name: 'Sent', exact: true }).click();
  await page.getByRole('button', { name: name + ' View sent email', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('The exact sent content for version two.');
  await page.screenshot({
    path: `docs/screenshots/sent-reader-${info.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Resend email', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm resend' }).click();
  await page.getByRole('button', { name: 'Process next 10' }).click();
  await expect(page.locator('.cm-table tbody tr').filter({ hasText: name })).toHaveCount(2);
  await nav.getByRole('button', { name: 'Sent', exact: true }).click();
  await expect(page.locator('.cm-table tbody tr').filter({ hasText: name })).toHaveCount(2);
  await page.screenshot({ path: `docs/screenshots/sent-${info.project.name}.png`, fullPage: true });
  const cancelled = 'Cancel me ' + info.project.name;
  const queued = await page.request.post('/api/mail/send', {
    headers: { 'X-CookieMail': '1' },
    data: {
      idempotencyKey: crypto.randomUUID(),
      to: 'release@example.com',
      subject: cancelled,
      text: 'Do not deliver',
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    },
  });
  expect(queued.status()).toBe(202);
  await nav.getByRole('button', { name: 'Outbox', exact: true }).click();
  const cancelRow = page.locator('.cm-table tbody tr').filter({ hasText: cancelled });
  await cancelRow.getByRole('button', { name: 'Cancel send' }).click();
  await page.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(cancelRow).toContainText('cancelled');
  const inbox = await (await page.request.get('/api/mail/inbox?limit=50')).json();
  const target = inbox.at(-1);
  await nav.getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.getByLabel('Search', { exact: true }).fill(target.subject);
  await page
    .getByRole('button', {
      name: target.subject + ' ' + (target.preview || 'Open conversation'),
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await page.screenshot({
    path: `docs/screenshots/trash-confirm-${info.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Confirm move to Trash' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shared case notifications appear in sent history with their source', async ({
  page,
}, info) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Mail navigation' })
    .getByRole('button', { name: 'Sent', exact: true })
    .click();
  const row = page.locator('.cm-table tbody tr').filter({ hasText: '[CS-10041] Case received' });
  await expect(row).toContainText('CookieCaseKit');
  await row
    .getByRole('button', { name: '[CS-10041] Case received View sent email', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('CookieCaseKit');
  await expect(page.getByRole('dialog')).toContainText(
    'Reply to this email to continue the conversation.',
  );
  await page.screenshot({
    path: `docs/screenshots/shared-case-email-${info.project.name}.png`,
    fullPage: false,
  });
});
