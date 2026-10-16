/* global window, document */
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';

const { chromium } = await import(process.env.TRACCAR_AUDIT_PLAYWRIGHT || 'playwright');
const fixturePlugin = {
  name: 'proximity-audit',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source.endsWith('/MapView') && importer?.includes('/map/')) return '\0proximity-map';
  },
  load(id) {
    if (id === '\0proximity-map')
      return `import { createProximityAuditMap } from '/scripts/proximity-map.fixture.js';
        export const map = createProximityAuditMap();`;
  },
  configureServer(server) {
    server.middlewares.use('/__proximity_audit__', async (_request, response, next) => {
      try {
        const html = await server.transformIndexHtml(
          '/__proximity_audit__',
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="margin:0;font:14px sans-serif"><div id="audit-map" style="height:75vh"></div><div id="root"></div><script type="module" src="/scripts/proximity-browser-audit.fixture.jsx"></script></body></html>',
        );
        response.setHeader('Content-Type', 'text/html');
        response.end(html);
      } catch (error) {
        next(error);
      }
    });
  },
};
const server = await createServer({
  configFile: false,
  plugins: [react(), fixturePlugin],
  optimizeDeps: { entries: ['scripts/proximity-browser-audit.fixture.jsx'] },
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  channel: process.env.TRACCAR_AUDIT_BROWSER_CHANNEL,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const mobile of [false, true]) {
    console.log(`Checking ${mobile ? 'mobile' : 'desktop'} proximity map behavior...`);
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 },
      isMobile: mobile,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__proximity_audit__`);
    await page.waitForFunction(() => Boolean(window.proximityAudit));
    await page.evaluate(() => window.proximityAudit.circle());
    await page.waitForFunction(() =>
      document.getElementById('circle-label').textContent.includes('2 players, 1 supporter'),
    );
    assert.equal(
      await page.evaluate(() => window.proximityMapLayers[0].paint['fill-color']),
      '#2e7d32',
    );
    const minimum = mobile ? 48 : 36;
    await page.waitForFunction(
      (size) => Math.abs(window.proximityDiameter() - size) < 0.01,
      minimum,
    );
    const label = await page.evaluate(
      () => window.proximityMapLayers.find((layer) => layer.type === 'symbol').layout,
    );
    assert.equal(label['text-size'], 12);
    assert.equal(label['text-allow-overlap'], true);
    assert.equal(label['text-ignore-placement'], false);
    await page.evaluate(() => window.proximityMap.jumpTo({ zoom: 17 }));
    await page.waitForFunction(
      () => window.proximityDiameter() > 100 && window.proximityDiameter() < 10000,
    );
    const closeDiameter = await page.evaluate(() => window.proximityDiameter());
    await page.evaluate(() => window.proximityMap.jumpTo({ zoom: 5.5 }));
    await page.waitForFunction(
      (size) => Math.abs(window.proximityDiameter() - size) < 0.01,
      minimum,
    );
    await page.evaluate(() => window.proximityAudit.iconScale(1.5));
    await page.waitForFunction(() => Math.abs(window.proximityDiameter() - 72) < 0.01);
    await page.evaluate(() => window.proximityMap.jumpTo({ zoom: 17 }));
    await page.waitForFunction(
      (size) => Math.abs(window.proximityDiameter() - size) < 0.01,
      closeDiameter,
    );
    await page.evaluate(() => window.proximityMap.resize());
    await page.evaluate(() => window.proximityAudit.mountMap(false));
    await page.waitForFunction(
      () =>
        window.proximityMap.listenerCount('move') === 0 &&
        window.proximityMap.listenerCount('resize') === 0,
    );
    await page.evaluate(() => {
      window.proximityMap.jumpTo({ zoom: 5 });
      window.proximityAudit.mountMap(true);
    });
    await page.waitForFunction(
      () =>
        window.proximityMap.listenerCount('move') === 1 &&
        window.proximityMap.listenerCount('resize') === 1,
    );
    await page.evaluate(() => window.proximityAudit.setRole('spectator'));
    await page.waitForFunction(() =>
      document.getElementById('circle-label').textContent.includes('2 players'),
    );
    await page.evaluate(() => window.proximityAudit.circle(1));
    await page.waitForFunction(() => document.getElementById('circle-label').textContent === '');
    await page.evaluate(() => window.proximityAudit.setRole('player'));
    await page.evaluate(() => window.proximityAudit.grant());
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="devices"]').textContent.includes('12'),
    );
    await page.evaluate(() => {
      window.proximityAudit.select(12);
      window.proximityAudit.offline();
    });
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="devices"]').textContent.includes('12'),
    );
    assert.equal(await page.locator('[data-testid="selected"]').textContent(), '');
    assert.equal(await page.locator('[data-testid="positions"]').textContent(), '11');
    await page.evaluate(() => window.proximityAudit.latePeerPacket());
    assert.equal(await page.locator('[data-testid="devices"]').textContent(), '11');
    assert.equal(await page.locator('[data-testid="positions"]').textContent(), '11');
    assert.equal(await page.locator('[data-testid="selected"]').textContent(), '');
    await page.evaluate(() => {
      window.proximityAudit.restore();
      window.proximityAudit.grant(2);
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="devices"]').textContent.includes('12'),
    );
    await page.evaluate(() => window.proximityAudit.rejectAccess());
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="devices"]').textContent.includes('12'),
    );
    await page.evaluate(() => {
      window.proximityAudit.restore();
      window.proximityAudit.grant(60);
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="devices"]').textContent.includes('12'),
    );
    await page.evaluate(() => window.proximityAudit.revoke());
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="devices"]').textContent.includes('12'),
    );
    assert.deepEqual(errors, []);
    await page.close();

    console.log(`Checking ${mobile ? 'mobile' : 'desktop'} real map rendering...`);
    const rendered = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 },
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
    });
    const renderErrors = [];
    rendered.on('pageerror', (error) => {
      renderErrors.push(error.message);
      console.error(error.message);
    });
    await rendered.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__proximity_audit__?render`,
    );
    await rendered.waitForFunction(() => Boolean(window.proximityAudit?.ready));
    await rendered.evaluate(() => window.proximityAudit.circle());
    await rendered.waitForFunction(
      (size) => Math.abs(window.proximityDiameter() - size) < 0.1,
      minimum,
    );
    const labelsVisible = () =>
      window.proximityMap
        .queryRenderedFeatures()
        .some(
          (feature) =>
            feature.layer.type === 'symbol' &&
            feature.properties.label?.includes('Participant proximity'),
        );
    await rendered.waitForFunction(labelsVisible);
    for (const zoom of [5, 17]) {
      await rendered.evaluate((value) => window.proximityMap.jumpTo({ zoom: value }), zoom);
      await rendered.waitForFunction(
        (value) =>
          value === 5
            ? window.proximityDiameter() < 50
            : window.proximityDiameter() > 100 && window.proximityDiameter() < 10000,
        zoom,
      );
      await rendered.waitForFunction(labelsVisible);
      await rendered.evaluate(
        () => new Promise((resolve) => window.proximityMap.once('idle', resolve)),
      );
      if (process.env.TRACCAR_AUDIT_SCREENSHOT_DIR) {
        await rendered.screenshot({
          path: path.join(
            process.env.TRACCAR_AUDIT_SCREENSHOT_DIR,
            `proximity-${mobile ? 'mobile' : 'desktop'}-zoom-${zoom}.png`,
          ),
        });
      }
    }
    await rendered.evaluate(() =>
      window.proximityMap.jumpTo({ zoom: 6.25, bearing: 35, pitch: 45 }),
    );
    await rendered.waitForFunction(
      (size) => Math.abs(window.proximityDiameter() - size) < 0.1,
      minimum,
    );
    await rendered.waitForFunction(labelsVisible);
    assert.deepEqual(renderErrors, []);
    await rendered.close();
  }
  console.log(
    'Desktop/mobile proximity audit passed: zoom sizing, icon preferences, readable labels, listener cleanup, real WebGL rendering, role isolation, expiry, and revoked cache cleanup.',
  );
} finally {
  await browser.close();
  await server.close();
}
