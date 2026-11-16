import { test, expect } from '@playwright/test';

test.describe('Device-to-Device Failure Impact Simulation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=NetMonitor').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-SIM-01: Enter What-If Sandbox, trigger Core Switch Down preset, inspect device dependency chains & SPOF, and reset', async ({ page }) => {
    // 1. Open What-If Outage Simulator
    const simBtn = page.getByTestId('toggle-sim-btn');
    await expect(simBtn).toBeVisible();
    await simBtn.click();

    // 2. Verify Sandbox Banner and Impact Drawer appear
    await expect(page.getByTestId('sim-sandbox-banner')).toBeVisible();
    const drawer = page.getByTestId('impact-drawer');
    await expect(drawer).toBeVisible();

    // 3. Click "Core Switch Down" preset
    await drawer.getByRole('button', { name: /Core Switch ล่ม|Core Switch Down/i }).click();

    // Verify impacted devices appear in drawer with hop-by-hop dependency chains (➔)
    await expect(drawer.locator('button[class*="faultChip"]')).toHaveCount(1);
    const listRows = drawer.locator('button[class*="listRow"]');
    expect(await listRows.count()).toBeGreaterThan(1);
    await expect(drawer.getByTestId('dependency-chain').filter({ hasText: '➔' }).first()).toBeVisible();

    // 4. Switch to SPOF tab and test Top SPOF
    await drawer.getByRole('tab', { name: /SPOF/i }).click();
    const firstTestBtn = drawer.getByRole('button', { name: /ทดสอบ|Test/i }).first();
    await expect(firstTestBtn).toBeVisible();
    await firstTestBtn.click();

    // 5. Verify Reset Sandbox clears faults
    await drawer.getByRole('button', { name: /รีเซ็ตจำลอง|Reset Sandbox/i }).click();
    await expect(drawer.locator('button[class*="faultChip"]')).toHaveCount(0);

    // 6. Exit simulation mode
    await page.getByTestId('sim-sandbox-banner').getByRole('button', { name: /ออกจากโหมดจำลอง|Exit Simulation/i }).click();
    await expect(page.getByTestId('sim-sandbox-banner')).not.toBeVisible();
  });

  test('TC-SIM-02: Link Edit Mode toggles toolbar bar and 2D Canvas renders topology SVG links', async ({ page }) => {
    await page.getByRole('button', { name: /2D/i }).click();

    const linkEditBtn = page.getByTestId('toggle-link-edit-btn');
    await linkEditBtn.click();
    await expect(page.getByTestId('link-edit-bar')).toBeVisible();

    await expect(page.locator('svg[aria-label="Network topology links"]')).toBeVisible();

    await linkEditBtn.click();
    await expect(page.getByTestId('link-edit-bar')).not.toBeVisible();
  });

  test('TC-SIM-03: Device Detail page displays affected downstream device chips and links into Simulator', async ({ page }) => {
    await page.getByRole('tab', { name: /รายการอุปกรณ์|Device List/i }).click();
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await firstRow.click();

    const blastCard = page.getByTestId('device-blast-card');
    await expect(blastCard).toBeVisible({ timeout: 5000 });

    await blastCard.getByRole('button', { name: /จำลองล่มบนแผนผัง|Simulate on Map/i }).click();
    await expect(page.getByTestId('sim-sandbox-banner')).toBeVisible();
    await expect(page.getByTestId('impact-drawer')).toBeVisible();

    // Navigate to Reports page and verify outage impact section and dependency chains are displayed
    await page.getByRole('tab', { name: /รายงาน|Reports/i }).click();
    const outageSection = page.getByTestId('reports-outage-section');
    await expect(outageSection).toBeVisible();
    await expect(outageSection.getByTestId('report-dependency-chain').first()).toBeVisible();
  });
});
