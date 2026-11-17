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
    const plan = await page.evaluate(async () => {
      const [devs, links, simOverview] = await Promise.all([
        fetch('/api/v1/devices').then(r => r.json()) as Promise<Array<{ id: string | number; name: string; dtype: string; floor: number }>>,
        fetch('/api/v1/topology/links').then(r => r.json()) as Promise<Array<{ id: string | number; source_device_id: string | number; target_device_id: string | number }>>,
        fetch('/api/v1/simulate/impact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ down_device_ids: [], down_link_ids: [], include_spof: true }),
        }).then(r => r.json()),
      ]);

      const devById = new Map(devs.map(d => [String(d.id), d]));
      const floorById = new Map(devs.map(d => [String(d.id), d.floor]));
      const edgeKeys = new Set(
        links.map(l => {
          const a = String(l.source_device_id);
          const b = String(l.target_device_id);
          return a < b ? `${a}::${b}` : `${b}::${a}`;
        }),
      );
      const intraFloorCount = new Map<string, number>();
      for (const link of links) {
        const a = String(link.source_device_id);
        const b = String(link.target_device_id);
        const da = devById.get(a);
        const db = devById.get(b);
        if (da && db && da.floor === db.floor) {
          intraFloorCount.set(a, (intraFloorCount.get(a) ?? 0) + 1);
          intraFloorCount.set(b, (intraFloorCount.get(b) ?? 0) + 1);
        }
      }

      const hubCandidate =
        devs.find(d => d.name === 'Switch-Core' && (intraFloorCount.get(String(d.id)) ?? 0) >= 2) ??
        devs.reduce<(typeof devs)[number] | undefined>((best, cur) => {
          const curCnt = intraFloorCount.get(String(cur.id)) ?? 0;
          const bestCnt = best ? (intraFloorCount.get(String(best.id)) ?? 0) : -1;
          return curCnt > bestCnt ? cur : best;
        }, undefined);

      let cascadeCheck: { rootId: string; parentId: string; childId: string; floor: number } | null = null;
      const candidateRoots: string[] = [
        ...(simOverview.spof_ranking ?? []).map((s: { device_id: string }) => String(s.device_id)),
        ...devs.filter(d => d.dtype === 'router' || d.dtype === 'switch').map(d => String(d.id)),
      ];
      const tested = new Set<string>();
      for (const rootId of candidateRoots) {
        if (tested.has(rootId)) continue;
        tested.add(rootId);
        const sim = await fetch('/api/v1/simulate/impact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ down_device_ids: [rootId], down_link_ids: [], include_spof: false }),
        }).then(r => r.json());
        for (const imp of sim.device_impacts ?? []) {
          const path: string[] = (imp.dependency_path ?? []).map(String);
          if (path.length >= 3 && (imp.impact_state === 'unreachable' || imp.impact_state === 'degraded')) {
            const parentId = path[path.length - 2];
            const childId = path[path.length - 1];
            const pair = parentId < childId ? `${parentId}::${childId}` : `${childId}::${parentId}`;
            const pFloor = floorById.get(parentId);
            const cFloor = floorById.get(childId);
            if (edgeKeys.has(pair) && pFloor && pFloor === cFloor) {
              cascadeCheck = { rootId, parentId, childId, floor: pFloor };
              break;
            }
          }
        }
        if (cascadeCheck) break;
      }

      return {
        hubId: hubCandidate ? String(hubCandidate.id) : null,
        hubFloor: hubCandidate?.floor ?? 1,
        hubIntraLinks: hubCandidate ? (intraFloorCount.get(String(hubCandidate.id)) ?? 0) : 0,
        cascadeCheck,
      };
    });

    expect(plan.hubId).toBeTruthy();
    expect(plan.hubIntraLinks).toBeGreaterThanOrEqual(2);
    const hubId = plan.hubId!;
    const hubFloor = plan.hubFloor;

    await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();
    await page.getByRole('button', { name: /^2D$/i }).click();
    await page.getByRole('tab', { name: new RegExp(`ชั้น ${hubFloor}|Floor ${hubFloor}`, 'i') }).click();

    await page.getByTestId('toggle-sim-btn').click();
    const drawer = page.getByTestId('impact-drawer');
    await expect(drawer).toBeVisible();

    // Simulate the chosen hub going down
    await drawer.locator('select').selectOption(hubId);
    const svgLayer = page.locator('svg[aria-label="Network topology links"]');

    // Links directly connected to the hub must flow outward from hubId -> neighbor
    const flowFromHub = svgLayer.locator(`line[data-flow-dir^="${hubId}->"]`);
    await expect(flowFromHub.first()).toBeVisible({ timeout: 5000 });
    expect(await flowFromHub.count()).toBeGreaterThanOrEqual(2);

    const animInfo = await flowFromHub.first().evaluate(el => {
      const cs = getComputedStyle(el);
      return { animName: cs.animationName, strokeWidth: parseFloat(cs.strokeWidth) };
    });
    expect(animInfo.animName).not.toBe('none');
    expect(animInfo.strokeWidth).toBeGreaterThanOrEqual(2.5);

    // Directional flow chevron should also be visible on failure lines
    expect(await svgLayer.locator('g[class*="flowArrow"]').count()).toBeGreaterThanOrEqual(2);

    if (plan.cascadeCheck) {
      await drawer.locator('select').selectOption(plan.cascadeCheck.rootId);
      await page.getByRole('tab', { name: new RegExp(`ชั้น ${plan.cascadeCheck.floor}|Floor ${plan.cascadeCheck.floor}`, 'i') }).click();
      await expect(svgLayer.locator(`line[data-flow-dir="${plan.cascadeCheck.parentId}->${plan.cascadeCheck.childId}"]`)).toBeVisible();
    }

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
      const [patchRes] = await Promise.all([
        page.waitForResponse(
          res => res.url().includes('/api/v1/devices/1') && res.request().method() === 'PATCH',
          { timeout: 15000 },
        ),
        editor.locator('button[type="submit"]').click(),
      ]);
      expect(patchRes.ok()).toBe(true);
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

  test('TC-SIM-07: Light Theme preserves outage red border on Server Room and toolbar status pills never wrap', async ({ page }) => {
    await page.getByRole('tab', { name: /แผนผัง|Floor Plan/i }).click();
    await page.getByRole('button', { name: /^2D$/i }).click();

    // Switch to Light Theme if currently dark
    const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (currentTheme !== 'light') {
      await page.locator('nav button[title*="สว่าง"], nav button[title*="Light"]').click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Collapse sidebar so compact status pills render in toolbarCenter
    const sidebarBtn = page.locator('button[class*="sidebarToggle"]');
    await sidebarBtn.click();
    const pills = page.locator('button[class*="floorStatusPill"]');
    if ((await pills.count()) > 0) {
      const pillStats = await pills.evaluateAll(els =>
        els.map(el => {
          const cs = getComputedStyle(el);
          const span = el.querySelector('span:last-child');
          const spanRect = span?.getBoundingClientRect();
          return {
            whiteSpace: cs.whiteSpace,
            height: Math.round(el.getBoundingClientRect().height),
            spanHeight: spanRect ? Math.round(spanRect.height) : 0,
          };
        }),
      );
      for (const s of pillStats) {
        expect(s.whiteSpace).toBe('nowrap');
        expect(s.height).toBeLessThanOrEqual(28);
        expect(s.spanHeight).toBeLessThanOrEqual(22);
      }
    }

    // Re-expand sidebar and simulate Switch-Core (id 1 in Server Room on Floor 1) going down
    await sidebarBtn.click();
    await page.getByRole('tab', { name: /ชั้น 1|Floor 1/i }).click();
    await page.getByTestId('toggle-sim-btn').click();
    const drawer = page.getByTestId('impact-drawer');
    await drawer.locator('select').selectOption('1');

    const outageServerRoom = page.locator('[data-zone-state="outage"][class*="roomServer"]').first();
    await expect(outageServerRoom).toBeVisible({ timeout: 5000 });
    await expect(outageServerRoom).toHaveCSS('border-top-color', 'rgb(239, 68, 68)');

    await drawer.getByRole('button', { name: /เสร็จสิ้น|Done/i }).click();
  });

  test('TC-SIM-08: Live view auto-highlights impacted rooms from real offline devices and silent background sync updates outage UI', async ({ page }) => {
    let forceCoreOffline = false;
    await page.route('**/api/v1/devices', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const json = (await response.json()) as Array<{ id: string; status: string }>;
      if (forceCoreOffline) {
        const patched = json.map(d => (String(d.id) === '1' ? { ...d, status: 'offline' } : d));
        await route.fulfill({ response, json: patched });
      } else {
        await route.fulfill({ response, json });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /^2D$/i }).click();
    await page.getByRole('tab', { name: /ชั้น 1|Floor 1/i }).click();

    // Confirm ImpactDrawer is NOT open (pure live monitoring mode)
    await expect(page.getByTestId('impact-drawer')).not.toBeVisible();

    // Flip live DB payload via backend poll route and trigger tab-visibility background sync
    forceCoreOffline = true;
    const [pollRes] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/v1/devices') && r.request().method() === 'GET', { timeout: 10000 }),
      page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
    ]);
    expect(pollRes.ok()).toBe(true);

    // Server Room automatically highlights red without opening Outage Simulator
    const liveServerOutage = page.locator('[data-zone-state="outage"][class*="roomServer"]').first();
    await expect(liveServerOutage).toBeVisible({ timeout: 5000 });
    await page.unroute('**/api/v1/devices');
  });
});
