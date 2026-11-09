import { expect, test } from '@playwright/test';
import { ADMIN, signInFromStart } from './helpers';

const PAGES = [
  '/',
  '/reports/inventory',
  '/reports/purchasing',
  '/reports/sales',
  '/notifications',
  '/products',
  '/stock',
  '/purchase-orders',
  '/sales-orders',
  '/shipments',
  '/stock/transfers',
  '/stock/counts',
  '/stock/quarantine',
  '/customer-returns',
  '/audit-log',
];

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
]) {
  test(`key pages fit a ${viewport.name} screen without sideways scrolling`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signInFromStart(page, ADMIN);
    const overflowing: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Wide tables scroll inside their own container; the page itself must not.
      const extra = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (extra > 1) {
        // Name the outermost element that sticks out, to make the failure actionable.
        const culprit = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          const wide = [...document.querySelectorAll<HTMLElement>('main *')].find(
            (el) =>
              el.getBoundingClientRect().right > width + 1 &&
              !el.closest('[data-slot="table-container"]'),
          );
          return wide
            ? `${wide.tagName.toLowerCase()}.${[...wide.classList].slice(0, 4).join('.')} "${wide.textContent?.slice(0, 40)}"`
            : '';
        });
        overflowing.push(`${path} (+${extra}px) ${culprit}`);
      }
      if (process.env.SCREENSHOT_DIR) {
        await page.screenshot({
          path: `${process.env.SCREENSHOT_DIR}/${viewport.name}${path.replace(/\//g, '_') || '_home'}.png`,
          fullPage: true,
        });
      }
    }
    expect(overflowing).toEqual([]);
  });
}
