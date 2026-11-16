import { test, expect } from '@playwright/test';

test.describe('Device-to-Device Failure Impact Simulation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=NetMonitor').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-SIM-01: Open simulator, pick a core device with 1 click, inspect dependency chains, reset, and close', async ({ page }) => {
    // 1. Open Outage Simulator
    const simBtn = page.getByTestId('toggle-sim-btn');
    await expect(simBtn).toBeVisible();
    await simBtn.click();

    const drawer = page.getByTestId('impact-drawer');
    await expect(drawer).toBeVisible();

    // 2. Click the first top-impact quick candidate chip (1-click)
    const quickBtn = drawer.locator('button[class*="quickBtn"]').first();
    await expect(quickBtn).toBeVisible();
    await quickBtn.click();

    // Verify fault chip and hop-by-hop dependency chains appear immediately
    await expect(drawer.locator('button[class*="faultChip"]')).toHaveCount(1);
    const listRows = drawer.locator('button[class*="listRow"]');
    expect(await listRows.count()).toBeGreaterThan(1);
    await expect(drawer.getByTestId('dependency-chain').first()).toBeVisible();

    // 3. Reset clears faults
    await drawer.getByRole('button', { name: /ล้างค่า|Reset/i }).click();
    await expect(drawer.locator('button[class*="faultChip"]')).toHaveCount(0);

    // 4. Close simulator via Done button
    await drawer.getByRole('button', { name: /เสร็จสิ้น|Done/i }).click();
    await expect(drawer).not.toBeVisible();
  });

  test('TC-SIM-02: Link Edit Mode toggles simplified bar and 2D Canvas renders aligned topology SVG links', async ({ page }) => {
    await page.getByRole('button', { name: /2D/i }).click();

    const linkEditBtn = page.getByTestId('toggle-link-edit-btn');
    await linkEditBtn.click();
    await expect(page.getByTestId('link-edit-bar')).toBeVisible();

    const svgLayer = page.locator('svg[aria-label="Network topology links"]');
    await expect(svgLayer).toBeVisible();
    await expect(svgLayer.locator('g[class*="crossFloorPill"]')).toHaveCount(0);

    const firstPinWidth = await page.locator('div[class*="_device_"][role="button"]').first().evaluate(el => el.getBoundingClientRect().width);
    expect(Math.round(firstPinWidth)).toBeLessThanOrEqual(30);

    await linkEditBtn.click();
    await expect(page.getByTestId('link-edit-bar')).not.toBeVisible();
  });

  test('TC-SIM-03: Device Detail page displays affected downstream device chips, navigates to Reports, and outage row opens full DeviceDetailPage', async ({ page }) => {
    await page.getByRole('tab', { name: /รายการอุปกรณ์|Device List/i }).click();
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await firstRow.click();

    const blastCard = page.getByTestId('device-blast-card');
    await expect(blastCard).toBeVisible({ timeout: 5000 });

    await blastCard.getByRole('button', { name: /ดูบนแผนผัง|View on Map/i }).click();
    await expect(page.getByTestId('impact-drawer')).toBeVisible();

    // Navigate to Reports page and verify outage impact section and dependency chains are displayed
    await page.getByRole('tab', { name: /รายงาน|Reports/i }).click();
    const outageSection = page.getByTestId('reports-outage-section');
    await expect(outageSection).toBeVisible();
    await expect(outageSection.getByTestId('report-dependency-chain').first()).toBeVisible();

    // Clicking an outage row opens full DeviceDetailPage (#/detail?id=...)
    const firstOutageRow = outageSection.locator('button[class*="outageRow"]').first();
    await expect(firstOutageRow).toBeVisible();
    await firstOutageRow.click();
    await expect(page).toHaveURL(/.*#\/detail\?id=/);
  });
});
