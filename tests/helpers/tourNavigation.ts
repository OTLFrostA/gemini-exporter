import type { Page } from 'playwright';

/** Reach the existing authorization lesson through the shared release introduction. */
export async function advancePlatformIntro(page: Page): Promise<void> {
    await page.getByRole('heading', { name: 'Multi-platform support (Beta)', exact: true }).waitFor();
    for (let i = 0; i < 3; i++) await page.locator('#tourNextBtn').click();
}
