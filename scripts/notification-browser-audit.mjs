// Run with Node 22 and Playwright installed (or TRACCAR_AUDIT_PLAYWRIGHT pointing
// to an existing Playwright index.mjs). No real accounts, uploads or pushes.
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';

const { chromium } = await import(process.env.TRACCAR_AUDIT_PLAYWRIGHT || 'playwright');
const fixturePlugin = {
  name: 'notification-audit-fixture',
  enforce: 'pre',
  resolveId(source, importer) {
    if (
      (source === '../core/MapView' || /\/map\/core\/MapView(\.jsx)?$/.test(source)) &&
      importer?.split('?')[0].endsWith('/map/control/MapNotification.jsx')
    ) {
      return '\0notification-audit-map';
    }
  },
  load(id) {
    if (id === '\0notification-audit-map')
      return `export const map = {
      addControl(control) { document.getElementById('audit-map').appendChild(control.onAdd()); },
      removeControl(control) { control.onRemove(); }
    };`;
  },
  configureServer(server) {
    server.middlewares.use('/__notification_audit__', async (_request, response, next) => {
      try {
        const html = await server.transformIndexHtml(
          '/__notification_audit__',
          '<!doctype html><html><body><div class="loader" style="display:none"></div><div id="root"></div><script type="module" src="/scripts/notification-browser-audit.fixture.jsx"></script></body></html>',
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
  optimizeDeps: { entries: ['scripts/notification-browser-audit.fixture.jsx'] },
  server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/build/**'] } },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.TRACCAR_AUDIT_BROWSER_CHANNEL,
  });
  const mobileManager = process.env.TRACCAR_AUDIT_MOBILE_MANAGER === '1';
  const page = await browser.newPage(
    mobileManager ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  if (mobileManager) {
    // Manager injects this bridge before the web document loads. Exercise the
    // native-environment path, not just a desktop page with a narrow viewport.
    await page.addInitScript(() => {
      window.appInterface = { postMessage() {} };
    });
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(`${server.resolvedUrls.local[0]}__notification_audit__`);
  await page.waitForFunction(() => window.notificationAudit?.sockets > 0);
  const banner = page.locator('.MuiSnackbar-anchorOriginTopCenter');
  const mapButton = page.locator('#audit-map button');
  const drawer = page.locator('.MuiDrawer-paper');
  const makeAlert = (id, caught = false) =>
    page.evaluate(
      ({ id, caught }) => {
        const occurredAt = new Date().toISOString();
        const time = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Zurich',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(occurredAt));
        return {
          id,
          type: caught ? 'playerCaught' : 'speedhunt',
          audience: caught ? 'session' : 'participants',
          occurredAt,
          timeZone: 'Europe/Zurich',
          message: `[${time}] ${caught ? `${id} was caught` : 'Speedhunt: Ping 1 out of 4 sent.'}`,
        };
      },
      { id, caught },
    );
  const emit = (alerts) =>
    page.evaluate((records) => window.notificationAudit.emit(records), alerts);
  const soundCount = () => page.evaluate(() => window.notificationAudit.sounds);
  const unreadCount = () =>
    page.evaluate(() => window.notificationAudit.history.items.filter((item) => !item.read).length);
  const historyIds = () =>
    page.evaluate(() => window.notificationAudit.history.items.map((item) => item.id));
  const dismiss = async () => {
    await banner.getByRole('button', { name: 'Dismiss notification' }).click();
    await page.mouse.move(10, 400);
    await page.clock.fastForward(400);
  };
  const openHistory = async () => {
    await mapButton.click();
    await drawer.waitFor();
  };
  const closeHistory = async () => {
    await drawer.getByRole('button', { name: 'Close notification history' }).click();
    await page.clock.fastForward(400);
  };

  // New arrivals preempt the real Snackbar and sound immediately in StrictMode.
  const first = await makeAlert('first');
  const second = await makeAlert('second', true);
  const third = await makeAlert('third', true);
  await emit([first]);
  await banner.getByText(first.message).waitFor();
  assert.equal(await soundCount(), 1);
  assert.equal(await unreadCount(), 1);
  assert.match(await mapButton.getAttribute('class'), /active/);
  await page.mouse.click(10, 400);
  await page.clock.fastForward(59000);
  assert.equal(await banner.getByText(first.message).count(), 1, 'banner remains for 60 seconds');
  await emit([first, second]);
  await banner.getByText(second.message).waitFor();
  assert.equal(await soundCount(), 2, 'new alert sounds without closing the previous banner');
  assert.equal(await banner.getByText(first.message).count(), 0);
  await page.clock.fastForward(2000);
  assert.equal(
    await banner.getByText(second.message).count(),
    1,
    'old timeout cannot close replacement',
  );
  await emit([third, first, second]);
  await banner.getByText(third.message).waitFor();
  assert.equal(await soundCount(), 3);
  await page.clock.fastForward(59000);
  assert.equal(
    await banner.getByText(third.message).count(),
    1,
    'replacement gets its own 60 seconds',
  );
  await page.clock.fastForward(1500);
  assert.equal(await banner.count(), 0, 'superseded banners never reappear');
  assert.equal(await unreadCount(), 3, 'banner close does not mark history read');
  await emit([first, second, third]);
  assert.equal(await soundCount(), 3, 'reconnect batch cannot replay');

  // Real drawer, date rendering, non-navigable game entries and unread semantics.
  await openHistory();
  await drawer.getByText(first.message).waitFor();
  assert.equal(await unreadCount(), 0);
  assert.doesNotMatch(await mapButton.getAttribute('class'), /active/);
  assert.ok(await drawer.getByText(/\d{2}\.\d{2}\.\d{4}.*\(Europe\/Zurich\)/).count());
  await drawer.getByText(first.message).click();
  assert.equal(await page.getByTestId('audit-route').textContent(), '/');
  const fourth = await makeAlert('fourth', true);
  await emit([fourth]);
  await drawer.getByText(fourth.message).waitFor();
  assert.equal(await unreadCount(), 0, 'arrivals in a visible drawer are read');
  assert.equal(await soundCount(), 4);
  assert.ok(
    await page.evaluate(
      () =>
        Number(
          getComputedStyle(document.querySelector('.MuiSnackbar-anchorOriginTopCenter')).zIndex,
        ) < Number(getComputedStyle(document.querySelector('.MuiDrawer-root')).zIndex),
    ),
    'banner must not cover drawer controls',
  );
  await page.evaluate(() => window.notificationAudit.setVisible(false));
  const hidden = await makeAlert('hidden', true);
  await emit([hidden]);
  await page.clock.fastForward(20000);
  assert.equal(await unreadCount(), 1, 'hidden drawer does not mark arrivals read');
  assert.equal(await soundCount(), 4);
  await page.evaluate(() => window.notificationAudit.setVisible(true));
  await page.clock.fastForward(300);
  assert.equal(await unreadCount(), 0);
  await banner.getByText(hidden.message).waitFor();
  assert.equal(await soundCount(), 5, 'newest hidden arrival sounds once on returning');
  await page.evaluate(() => window.notificationAudit.setVisible(false));
  await page.evaluate(() => window.notificationAudit.setVisible(true));
  await page.clock.fastForward(300);
  assert.equal(await soundCount(), 5, 'returning again does not replay the current alarm');
  if (process.env.TRACCAR_AUDIT_SCREENSHOT) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.TRACCAR_AUDIT_SCREENSHOT });
  }
  await drawer
    .locator('.MuiListItem-root')
    .filter({ hasText: first.message })
    .getByRole('button', { name: 'Delete history entry' })
    .click();
  await emit([first]);
  assert.ok(!(await historyIds()).includes('first'), 'deleted history is not restored by replay');
  assert.equal(await soundCount(), 5);
  // Existing native events keep their own server navigation and red-icon behavior.
  await page.evaluate(() =>
    window.notificationAudit.nativeEvent({
      id: 77,
      deviceId: 123,
      type: 'deviceOnline',
      eventTime: new Date().toISOString(),
      attributes: { message: 'Native example' },
    }),
  );
  const nativeRow = drawer.locator('.MuiListItemButton-root');
  await nativeRow.waitFor();
  await nativeRow.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="audit-route"]').textContent === '/event/77',
  );
  assert.equal(await page.getByTestId('audit-route').textContent(), '/event/77');
  assert.match(await mapButton.getAttribute('class'), /active/);
  await drawer.getByRole('button', { name: 'Clear event and notification history' }).click();
  assert.deepEqual(await historyIds(), []);
  assert.doesNotMatch(await mapButton.getAttribute('class'), /active/);
  await closeHistory();
  await banner.getByText(hidden.message).waitFor();
  assert.equal(await soundCount(), 5);
  await dismiss();
  assert.equal(await banner.count(), 0, 'dismissal does not bring back the preempted fourth alert');

  // Same-user refresh and native-token regression checks remain covered.
  const socketCount = await page.evaluate(() => window.notificationAudit.sockets);
  await page.evaluate(() => {
    window.notificationAudit.refreshUser();
    window.notificationAudit.malformed();
  });
  await page.clock.fastForward(500);
  assert.equal(await page.evaluate(() => window.notificationAudit.sockets), socketCount);
  await page.evaluate(() => window.updateNotificationToken('four'));
  await page.waitForFunction(() => window.notificationAudit.tokens === 'one,two,three,four');
  assert.equal(await page.evaluate(() => window.notificationAudit.sockets), socketCount);
  await page.evaluate(() =>
    window.handleNativeNotification({ notification: { body: 'Announcement' } }),
  );

  // Reload must restore history/read status, without sounding or replaying banners.
  const saved = await makeAlert('saved', true);
  await emit([saved]);
  await banner.getByText(saved.message).waitFor();
  await dismiss();
  await openHistory();
  await closeHistory();
  await page.evaluate(() => {
    window.localStorage.removeItem(`traccarToolHandledAlerts:${window.location.origin}:5`);
  });
  await page.reload();
  await page.waitForFunction(() => window.notificationAudit?.sockets > 0);
  assert.deepEqual(await historyIds(), ['saved']);
  assert.equal(await unreadCount(), 0);
  assert.equal(await soundCount(), 0, 'hydration is silent');
  await emit([saved]);
  await page.clock.fastForward(500);
  assert.equal(
    await banner.count(),
    0,
    'persisted history suppresses replay even without the old ID cache',
  );
  assert.equal(await soundCount(), 0);

  // History remains reachable with native events disabled; German labels are usable.
  await page.evaluate(() => window.notificationAudit.disableEvents(true));
  await mapButton.waitFor();
  await page.evaluate(() => window.notificationAudit.setLanguage('de'));
  await page.getByRole('button', { name: 'Ereignis', exact: true }).waitFor();
  await mapButton.click();
  await drawer.getByRole('button', { name: 'Benachrichtigungsverlauf schließen' }).click();
  await page.clock.fastForward(400);
  await page.evaluate(() => window.notificationAudit.setLanguage('en'));
  await mapButton.waitFor();

  // Hidden stale banners do not play; their already-received history stays for 24h.
  await page.evaluate(() => window.notificationAudit.setVisible(false));
  const expired = await makeAlert('expired', true);
  await emit([expired]);
  await page.clock.fastForward(16 * 60 * 1000);
  await page.evaluate(() => window.notificationAudit.setVisible(true));
  await page.clock.fastForward(500);
  assert.equal(await banner.count(), 0);
  assert.equal(await soundCount(), 0);
  assert.ok((await historyIds()).includes('expired'));
  await page.clock.fastForward(24 * 60 * 60 * 1000 + 1000);
  assert.deepEqual(await historyIds(), [], 'expiry timer prunes without another incoming event');
  assert.doesNotMatch(await mapButton.getAttribute('class'), /active/);

  // Permission/session changes and logout clear presentation, not another user's history.
  await page.evaluate(() => window.notificationAudit.setVisible(false));
  const revoked = await makeAlert('revoked');
  await emit([revoked]);
  await page.evaluate(() => window.notificationAudit.setRole('hunter'));
  await page.evaluate(() => window.notificationAudit.setVisible(true));
  await page.clock.fastForward(500);
  assert.equal(await banner.count(), 0);
  assert.equal(await soundCount(), 0);
  assert.deepEqual(await historyIds(), []);
  const catchAlert = await makeAlert('session-catch', true);
  await emit([catchAlert]);
  await banner.getByText(catchAlert.message).waitFor();
  await dismiss();
  await page.evaluate(() => window.notificationAudit.setSession(901));
  assert.deepEqual(await historyIds(), []);
  await page.evaluate(() => window.notificationAudit.setSession(900));
  assert.deepEqual(await historyIds(), ['session-catch']);
  await page.evaluate(() => window.notificationAudit.logout());
  await page.clock.fastForward(500);
  await emit([await makeAlert('after-logout', true)]);
  assert.deepEqual(await historyIds(), []);
  assert.equal(await banner.count(), 0);
  await page.evaluate(() => window.notificationAudit.login());
  await page.waitForFunction(() => window.notificationAudit.history.items.length === 1);
  assert.equal(await soundCount(), 1, 'login hydration does not play another alarm');
  // Restricted storage must not prevent new in-memory history or banner dismissal.
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    window.notificationAudit.restoreStorage = () =>
      Object.defineProperty(window, 'localStorage', descriptor);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Storage denied');
      },
    });
  });
  const blocked = await makeAlert('blocked-storage', true);
  await emit([blocked]);
  await banner.getByText(blocked.message).waitFor();
  assert.ok((await historyIds()).includes('blocked-storage'));
  await dismiss();
  await openHistory();
  await drawer.getByText(blocked.message).waitFor();
  assert.equal(await unreadCount(), 0);
  await closeHistory();
  await page.evaluate(() => window.notificationAudit.restoreStorage());

  // Reconnect batches select by occurrence, not wire order, and keep all history.
  const batchOlder = await makeAlert('batch-older', true);
  await page.clock.fastForward(1000);
  const batchNewest = await makeAlert('batch-newest', true);
  const beforeBatch = await soundCount();
  await emit([batchNewest, batchOlder]);
  await banner.getByText(batchNewest.message).waitFor();
  assert.equal(await banner.getByText(batchOlder.message).count(), 0);
  assert.equal(await soundCount(), beforeBatch + 1);
  assert.ok((await historyIds()).includes(batchOlder.id));
  assert.ok((await historyIds()).includes(batchNewest.id));
  await emit([batchOlder, batchNewest]);
  assert.equal(await soundCount(), beforeBatch + 1, 'replayed batch cannot replace or sound');
  await dismiss();
  assert.equal(await banner.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    `${mobileManager ? 'Mobile Manager bridge' : 'Browser'} notification audit passed: instant newest-alert preemption/sound, fresh 60s timeout/dismissal, actual drawer/map icon, unread/hidden state, merged navigation, dates, deletion/dedup, reload, expiry, permissions, four phones and logout.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
