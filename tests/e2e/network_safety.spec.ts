import { test, expect } from './fixtures';

test.use({ grantGemini: false });

test('fixture browser blocks unexpected external requests while allowing explicit mocks', async ({ context }) => {
  const page = await context.newPage();
  await expect(page.goto('https://untrusted.invalid/')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);

  await page.route('https://fixture.invalid/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<main data-testid="fixture">Local browser fixture</main>',
  }));
  await page.goto('https://fixture.invalid/');
  await expect(page.getByTestId('fixture')).toHaveText('Local browser fixture');
});
