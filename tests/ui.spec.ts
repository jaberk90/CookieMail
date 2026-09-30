import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('inbox, responsive theme, template variables, editor and tagged campaign', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your inbox. A little more human.' }),
  ).toBeVisible();
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(25);
  await page.getByLabel('Inbox limit').selectOption('50');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(42);
  await page.getByLabel('Search', { exact: true }).fill('collaboration');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(6);
  await page.getByLabel('Search', { exact: true }).fill('');
  await expect(page.locator('.cm-table tbody tr')).toHaveCount(42);
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
