/* global window, document */
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
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
      return `const sources = new Map(); const layers = new Map();
      const show = (data) => { window.proximityMapData = data; const label = document.getElementById('circle-label');
        if (label) label.textContent = data.features.filter(feature => feature.geometry.type === 'Point').map(feature => feature.properties.label).join('; '); };
      export const map = { getStyle: () => ({ glyphs: '' }), addSource(id, source) { sources.set(id, { setData: show }); show(source.data); },
        getSource: (id) => sources.get(id), removeSource: (id) => sources.delete(id), addLayer(layer) { layers.set(layer.id, layer); window.proximityMapLayers = [...layers.values()]; },
        getLayer: (id) => layers.get(id), removeLayer: (id) => layers.delete(id) };`;
  },
  configureServer(server) {
    server.middlewares.use('/__proximity_audit__', async (_request, response, next) => {
      try {
        const html = await server.transformIndexHtml(
          '/__proximity_audit__',
          '<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/proximity-browser-audit.fixture.jsx"></script></body></html>',
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
});
try {
  for (const mobile of [false, true]) {
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
  }
  console.log(
    'Desktop/mobile proximity audit passed: count circles, role isolation, local expiry, offline access removal, and revoked cache cleanup.',
  );
} finally {
  await browser.close();
  await server.close();
}
