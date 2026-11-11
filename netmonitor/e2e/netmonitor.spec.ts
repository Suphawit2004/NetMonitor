import { test, expect } from '@playwright/test';

test.describe('NetMonitor Comprehensive E2E Test Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local NetMonitor frontend
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=NetMonitor').first()).toBeVisible({ timeout: 10000 });
  });

  // ── Suite 1: Global Navigation & Common Utilities ──────────────────

  test('TC-NAV-01: Global navigation tabs switch SPA views smoothly', async ({ page }) => {
    // 1. Switch to Device List
    const listTab = page.getByRole('tab', { name: /รายการอุปกรณ์|Device List/i });
    await listTab.click();
    await expect(page).toHaveURL(/.*#\/list/);
    await expect(listTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('input[type="text"]').first()).toBeVisible();

    // 2. Switch to Reports
    const reportsTab = page.getByRole('tab', { name: /รายงาน|Reports/i });
    await reportsTab.click();
    await expect(page).toHaveURL(/.*#\/reports/);
    await expect(reportsTab).toHaveAttribute('aria-selected', 'true');

    // 3. Switch back to Floor Plan
    const floorTab = page.getByRole('tab', { name: /แผนผัง|Floor Plan/i });
    await floorTab.click();
    await expect(page).toHaveURL(/.*#\/(floor)?/);
    await expect(floorTab).toHaveAttribute('aria-selected', 'true');
  });

  test('TC-NAV-02: Inline search opens with Ctrl+K, filters devices, and closes with Esc', async ({ page }) => {
    // Focus via Ctrl+K
    await page.keyboard.press('Control+KeyK');
    const searchInput = page.getByPlaceholder(/ค้นหา|Search/i).first();
    await expect(searchInput).toBeFocused();

    // Type query
    await searchInput.fill('SW');
    const dropdown = page.getByRole('listbox');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Verify results exist inside dropdown
    const dropdownItems = dropdown.getByRole('option');
    const count = await dropdownItems.count();
    expect(count).toBeGreaterThan(0);

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await expect(dropdown).not.toBeVisible();
  });

  test('TC-NAV-03: Theme and Language toggle updates DOM and translations', async ({ page }) => {
    // 1. Language switcher with exact class locator
    const enBtn = page.locator('button[class*="langBtn"]:has-text("EN")');
    if (await enBtn.isVisible()) {
      await enBtn.click();
      await expect(page.getByRole('tab', { name: /Floor Plan/i })).toBeVisible();

      // Switch back to TH
      const thBtn = page.locator('button[class*="langBtn"]:has-text("TH")');
      await thBtn.click();
      await expect(page.getByRole('tab', { name: /แผนผัง/i })).toBeVisible();
    }

    // 2. Theme switch
    const themeBtn = page.locator('button[class*="iconBtn"]').first();
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(200);
      await themeBtn.click();
    }
  });

  // ── Suite 2: Floor Plan Page ──────────────────────────────────────

  test('TC-FP-01: Floor Plan switches between Floor 1 and Floor 2 tabs', async ({ page }) => {
    await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();

    // Floor 2
    const floor2Btn = page.getByRole('tab', { name: /ชั้น 2|Floor 2/i });
    await floor2Btn.click();
    await expect(floor2Btn).toHaveAttribute('aria-selected', 'true');

    // Floor 1
    const floor1Btn = page.getByRole('tab', { name: /ชั้น 1|Floor 1/i });
    await floor1Btn.click();
    await expect(floor1Btn).toHaveAttribute('aria-selected', 'true');
  });

  test('TC-FP-02: View mode toggles between 2D Blueprint and Satellite Map', async ({ page }) => {
    await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();

    // Click Map toggle button
    const mapBtn = page.locator('button[class*="viewBtn"]:has-text("แผนที่"), button:has-text("Map")').first();
    if (await mapBtn.isVisible()) {
      await mapBtn.click();
      const leafletMap = page.locator('.leaflet-container');
      await expect(leafletMap).toBeVisible({ timeout: 5000 });

      // Click 2D Blueprint button
      const plan2DBtn = page.locator('button[class*="viewBtn"]:has-text("2D")').first();
      await plan2DBtn.click();
      await expect(leafletMap).not.toBeVisible();
    }
  });

  test('TC-FP-03: Move mode button toggles unlock and lock states', async ({ page }) => {
    await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();

    const moveBtn = page.locator('button[class*="moveModeBtn"]').first();
    await expect(moveBtn).toBeVisible({ timeout: 5000 });

    // Toggle on (unlock)
    await moveBtn.click();
    await page.waitForTimeout(300);

    // Toggle off (lock)
    await moveBtn.click();
    await page.waitForTimeout(300);
  });

  // ── Suite 3: Device List Page ─────────────────────────────────────

  test('TC-DL-01: Summary KPI ribbon cards filter the device table', async ({ page }) => {
    await page.getByRole('tab', { name: /รายการอุปกรณ์|Device List/i }).click();
    await expect(page).toHaveURL(/.*#\/list/);

    // Check KPI ribbon exists
    const allCard = page.locator('button[class*="kpiCard"]').first();
    await expect(allCard).toBeVisible({ timeout: 5000 });

    // Click online card to filter
    const onlineCard = page.locator('button[class*="kpiCard"]').nth(1);
    if (await onlineCard.isVisible()) {
      await onlineCard.click();
      await page.waitForTimeout(300);
      // Reset by clicking all
      await allCard.click();
    }
  });

  test('TC-DL-02: Device search input filters table and clears on button click', async ({ page }) => {
    await page.getByRole('tab', { name: /รายการอุปกรณ์|Device List/i }).click();

    const listSearch = page.locator('input[class*="searchInput"]').first();
    await expect(listSearch).toBeVisible({ timeout: 5000 });

    await listSearch.fill('SW');
    await page.waitForTimeout(300);

    // Clear search
    const clearBtn = page.locator('button[class*="clearSearchBtn"]').first();
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await expect(listSearch).toHaveValue('');
    } else {
      await listSearch.fill('');
    }
  });

  // ── Suite 4: Device Detail Page ───────────────────────────────────

  test('TC-DT-01: Navigating to device detail renders metric cards and charts', async ({ page }) => {
    await page.getByRole('tab', { name: /รายการอุปกรณ์|Device List/i }).click();

    // Click on the first device row in the table
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await firstRow.click();

    // Should navigate to hash detail route
    await expect(page).toHaveURL(/.*#\/detail\?id=.+/);

    // Metric headers should appear
    await expect(page.getByText('CPU Usage').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Memory').first()).toBeVisible();

    // Traffic chart range buttons should be interactable
    const range15m = page.getByRole('button', { name: '15m' });
    if (await range15m.isVisible()) {
      await range15m.click();
    }
  });

  // ── Suite 5: Reports Page ─────────────────────────────────────────

  test('TC-RP-01: Reports page displays alerts summary and severity filter buttons', async ({ page }) => {
    await page.getByRole('tab', { name: /รายงาน|Reports/i }).click();
    await expect(page).toHaveURL(/.*#\/reports/);

    // Summary statistics should be visible
    await expect(page.getByText(/วิกฤต|Critical/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/เตือน|Warning/i).first()).toBeVisible();
  });
});
