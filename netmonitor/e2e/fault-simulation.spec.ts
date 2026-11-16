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

  test('TC-SIM-04: Link Edit mode creates new link, rejects duplicate undirected pair, and deletes via SVG X badge with DB cleanup', async ({ page }) => {
    await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();
    await page.getByRole('button', { name: /^2D$/i }).click();

    const { devs, links } = await page.evaluate(async () => {
      const [dRes, lRes] = await Promise.all([
        fetch('/api/v1/devices').then(r => r.json()),
        fetch('/api/v1/topology/links').then(r => r.json()),
      ]);
      return { devs: dRes, links: lRes };
    });
    const f1Devs = devs.filter((d: { floor: number }) => d.floor === 1);
    const linkedPairs = new Set<string>(
      links.map((l: { source_device_id: string; target_device_id: string }) => {
        const a = String(l.source_device_id);
        const b = String(l.target_device_id);
        return a < b ? `${a}::${b}` : `${b}::${a}`;
      }),
    );

    let pairA: { id: string; name: string } | null = null;
    let pairB: { id: string; name: string } | null = null;
    for (let i = 0; i < f1Devs.length && !pairA; i++) {
      for (let j = i + 1; j < f1Devs.length; j++) {
        const a = String(f1Devs[i].id);
        const b = String(f1Devs[j].id);
        const key = a < b ? `${a}::${b}` : `${b}::${a}`;
        if (!linkedPairs.has(key)) {
          pairA = f1Devs[i];
          pairB = f1Devs[j];
          break;
        }
      }
    }
    expect(pairA).toBeTruthy();
    expect(pairB).toBeTruthy();

    const cleanA = pairA!.name.replace(/^["']+|["']+$/g, '').trim();
    const cleanB = pairB!.name.replace(/^["']+|["']+$/g, '').trim();
    const pinA = page.locator(`div[class*="_device_"][aria-label*="${cleanA}"]`).first();
    const pinB = page.locator(`div[class*="_device_"][aria-label*="${cleanB}"]`).first();

    let createdId: string | null = null;
    try {
      await page.getByTestId('toggle-link-edit-btn').click();
      await expect(page.getByTestId('link-edit-bar')).toBeVisible();

      const svgLayer = page.locator('svg[aria-label="Network topology links"]');
      const initialLines = await svgLayer.locator('line[class*="lineBase"]').count();

      // 1. Connect A -> B
      await pinA.click({ force: true });
      await pinB.click({ force: true });
      await expect(svgLayer.locator('line[class*="lineBase"]')).toHaveCount(initialLines + 1, { timeout: 5000 });

      const updatedLinks = await page.evaluate(() => fetch('/api/v1/topology/links').then(r => r.json()));
      const created = updatedLinks.find(
        (l: { id: string; auto_inferred: boolean; source_device_id: string; target_device_id: string }) =>
          !l.auto_inferred &&
          ((l.source_device_id === pairA!.id && l.target_device_id === pairB!.id) ||
            (l.source_device_id === pairB!.id && l.target_device_id === pairA!.id)),
      );
      expect(created).toBeTruthy();
      createdId = created.id;

      // 2. Clicking B -> A again prevents duplicate link creation
      await pinB.click({ force: true });
      await pinA.click({ force: true });
      await expect(svgLayer.locator('line[class*="lineBase"]')).toHaveCount(initialLines + 1);

      // 3. Delete via SVG X badge cleanly removes the link from UI and Postgres
      const deleteBadge = svgLayer.locator('g[class*="deleteBadge"]').last();
      await deleteBadge.click();
      await expect(svgLayer.locator('line[class*="lineBase"]')).toHaveCount(initialLines, { timeout: 5000 });

      const afterDeleteLinks = await page.evaluate(() => fetch('/api/v1/topology/links').then(r => r.json()));
      expect(afterDeleteLinks.some((l: { id: string }) => l.id === createdId)).toBe(false);
      createdId = null;

      await page.getByTestId('toggle-link-edit-btn').click();
    } finally {
      if (createdId) {
        await page.evaluate(id => fetch(`/api/v1/topology/links/${id}`, { method: 'DELETE' }), createdId);
      }
    }
  });

  test('TC-SIM-05: Red failure lines animate from outage origin toward affected downstream devices on 2D and Map', async ({ page }) => {
    await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();
    await page.getByRole('button', { name: /^2D$/i }).click();
    await page.getByRole('tab', { name: /ชั้น 2|Floor 2/i }).click();

    await page.getByTestId('toggle-sim-btn').click();
    const drawer = page.getByTestId('impact-drawer');
    await expect(drawer).toBeVisible();

    // Simulate Switch-Core (id 1 on Floor 2) going down
    await drawer.locator('select').selectOption('1');
    const svgLayer = page.locator('svg[aria-label="Network topology links"]');

    // Links connected to Switch-Core (1) on Floor 2 must flow outward from 1 -> leaf APs
    const flowFromCore = svgLayer.locator('line[data-flow-dir^="1->"]');
    expect(await flowFromCore.count()).toBeGreaterThanOrEqual(2);

    const animInfo = await flowFromCore.first().evaluate(el => {
      const cs = getComputedStyle(el);
      return { animName: cs.animationName, strokeWidth: parseFloat(cs.strokeWidth) };
    });
    expect(animInfo.animName).not.toBe('none');
    expect(animInfo.strokeWidth).toBeGreaterThanOrEqual(2.5);

    // Directional flow chevron should also be visible on Floor 2 failure lines
    expect(await svgLayer.locator('g[class*="flowArrow"]').count()).toBeGreaterThanOrEqual(2);

    // Check Floor 1 cascaded link (14 -> 10) flows downstream when RTR-CORE-01 (16) goes down
    await drawer.locator('select').selectOption('16');
    await page.getByRole('tab', { name: /ชั้น 1|Floor 1/i }).click();
    await expect(svgLayer.locator('line[data-flow-dir="14->10"]')).toBeVisible();

    // Switch to Satellite Map and check animated red Leaflet paths
    await page.getByRole('button', { name: /แผนที่|Map/i }).first().click();
    const mapRedPaths = page.locator('.leaflet-overlay-pane path[class*="mapTopoFlowRed"]');
    await expect(mapRedPaths.first()).toBeVisible({ timeout: 5000 });
    const mapAnim = await mapRedPaths.first().evaluate(el => getComputedStyle(el).animationName);
    expect(mapAnim).not.toBe('none');

    await drawer.getByRole('button', { name: /เสร็จสิ้น|Done/i }).click();
  });

  test('TC-SIM-06: Custom service tag persists in DB and appears across Floor room highlights, ImpactDrawer, and Reports', async ({ page }) => {
    try {
      await page.getByRole('tab', { name: /รายการอุปกรณ์|Device List/i }).click();
      const coreRow = page.locator('tbody tr', { hasText: 'Switch-Core' }).first();
      await expect(coreRow).toBeVisible({ timeout: 5000 });
      await coreRow.click();

      const editor = page.getByTestId('service-tags-editor');
      await expect(editor).toBeVisible({ timeout: 5000 });

      const input = editor.locator('input[type="text"]');
      await input.fill('ERP-CORE');
      await editor.locator('button[type="submit"]').click();
      await expect(editor.locator('[data-testid="active-service-tag"]', { hasText: 'ERP-CORE' })).toBeVisible({ timeout: 5000 });

      // Reload page to prove PostgreSQL persistence
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('service-tags-editor').locator('[data-testid="active-service-tag"]', { hasText: 'ERP-CORE' })).toBeVisible({ timeout: 10000 });

      // Navigate to Floor Plan 2D -> simulate Switch-Core (id 1) down -> check room highlights & drawer summary
      await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();
      await page.getByRole('button', { name: /^2D$/i }).click();
      await page.getByTestId('toggle-sim-btn').click();
      const drawer = page.getByTestId('impact-drawer');
      await drawer.locator('select').selectOption('1');

      const bizDrawer = page.getByTestId('sim-business-impact');
      await expect(bizDrawer).toBeVisible();
      await expect(bizDrawer).toContainText('ERP-CORE');
      expect(await page.locator('[data-zone-state]').count()).toBeGreaterThan(0);

      // Navigate to Reports -> verify business impact panel renders zones and custom service
      await page.getByRole('tab', { name: /รายงาน|Reports/i }).click();
      const bizReport = page.getByTestId('reports-business-impact');
      await expect(bizReport).toBeVisible();
      await expect(bizReport).toContainText('ERP-CORE');

      // Exit simulation cleanly
      await page.getByTestId('sim-sandbox-banner').getByRole('button', { name: /เสร็จสิ้น|Done/i }).click();
    } finally {
      await page.evaluate(() =>
        fetch('/api/v1/devices/1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ services: [] }),
        }),
      );
    }
  });
});
