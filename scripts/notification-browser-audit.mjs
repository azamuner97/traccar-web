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
          audience: 'session',
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

  const waitForHistory = (count) =>
    page.waitForFunction(
      (value) =>
        window.notificationAudit.history.items.length === value &&
        !window.notificationAudit.history.loading,
      count,
    );
  const synchronize = async () => {
    await page.evaluate(() => window.notificationAudit.reconnect());
    await page.waitForFunction(() => !window.notificationAudit.history.loading);
    await page.clock.fastForward(100);
  };
  // Actual Snackbar replacement, independent 60s timeout and one-time sound.
  const first = await makeAlert('first');
  await emit([first]);
  await banner.getByText(first.message).waitFor();
  assert.equal(await soundCount(), 1);
  assert.equal(await unreadCount(), 1);
  assert.match(await mapButton.getAttribute('class'), /active/);
  await page.mouse.click(10, 400);
  await page.clock.fastForward(59000);
  assert.equal(await banner.getByText(first.message).count(), 1);
  const second = await makeAlert('second', true);
  await emit([second]);
  await banner.getByText(second.message).waitFor();
  assert.equal(await soundCount(), 2);
  assert.equal(await banner.getByText(first.message).count(), 0);
  await page.clock.fastForward(2000);
  assert.equal(await banner.getByText(second.message).count(), 1);
  await page.clock.fastForward(59000);
  assert.equal(await banner.count(), 0);
  assert.equal(await unreadCount(), 2);
  await synchronize();
  assert.equal(await soundCount(), 2, 'reconnect cannot replay an alarm');
  const spoofed = await makeAlert('spoofed');
  await page.evaluate((alert) => window.notificationAudit.spoof(alert), spoofed);
  await page.clock.fastForward(100);
  assert.ok(
    !(await historyIds()).includes('spoofed'),
    'device uploads are not notification authority',
  );

  // Drawer, dates, unread indicator and visible/hidden handling.
  await openHistory();
  await drawer.getByText(first.message).waitFor();
  assert.equal(await unreadCount(), 0);
  assert.doesNotMatch(await mapButton.getAttribute('class'), /active/);
  assert.ok(await drawer.getByText(/\d{2}\.\d{2}\.\d{4}.*\(Europe\/Zurich\)/).count());
  await drawer.getByText(first.message).click();
  assert.equal(await page.getByTestId('audit-route').textContent(), '/');
  const third = await makeAlert('third', true);
  await emit([third]);
  await drawer.getByText(third.message).waitFor();
  assert.equal(await unreadCount(), 0);
  assert.equal(await soundCount(), 3);
  assert.ok(
    await page.evaluate(
      () =>
        Number(
          getComputedStyle(document.querySelector('.MuiSnackbar-anchorOriginTopCenter')).zIndex,
        ) < Number(getComputedStyle(document.querySelector('.MuiDrawer-root')).zIndex),
    ),
  );
  await page.evaluate(() => window.notificationAudit.setVisible(false));
  const hidden = await makeAlert('hidden', true);
  await emit([hidden]);
  await waitForHistory(4);
  assert.equal(await unreadCount(), 1);
  assert.equal(await soundCount(), 3);
  await page.clock.fastForward(20000);
  await page.evaluate(() => window.notificationAudit.setVisible(true));
  await banner.getByText(hidden.message).waitFor();
  assert.equal(await soundCount(), 4);
  assert.equal(await unreadCount(), 0);
  await page.evaluate(() => {
    window.notificationAudit.setVisible(false);
    window.notificationAudit.setVisible(true);
  });
  await synchronize();
  assert.equal(await soundCount(), 4);
  await drawer
    .locator('.MuiListItem-root')
    .filter({ hasText: first.message })
    .getByRole('button', { name: 'Delete history entry' })
    .click();
  await synchronize();
  assert.ok(!(await historyIds()).includes('first'));
  assert.equal(await soundCount(), 4);

  // Native events remain distinct and navigable.
  await page.evaluate(() =>
    window.notificationAudit.nativeEvent({
      id: 77,
      deviceId: 123,
      type: 'deviceOnline',
      eventTime: new Date().toISOString(),
      attributes: {},
    }),
  );
  await drawer.locator('.MuiListItemButton-root').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="audit-route"]').textContent === '/event/77',
  );
  assert.equal(await page.getByTestId('audit-route').textContent(), '/event/77');
  await drawer.getByRole('button', { name: 'Clear event and notification history' }).click();
  assert.deepEqual(await historyIds(), []);
  await closeHistory();
  await banner.getByText(hidden.message).waitFor();
  await dismiss();
  assert.equal(await banner.count(), 0);
  await synchronize();
  assert.deepEqual(await historyIds(), [], 'clear cutoff survives fetching the same journal');

  const socketCount = await page.evaluate(() => window.notificationAudit.sockets);
  await page.evaluate(() => {
    window.notificationAudit.refreshUser();
    window.notificationAudit.malformed();
  });
  await page.clock.fastForward(100);
  assert.equal(await page.evaluate(() => window.notificationAudit.sockets), socketCount);
  await page.evaluate(() => window.updateNotificationToken('four'));
  await page.waitForFunction(() => window.notificationAudit.tokens === 'one,two,three,four');
  await page.evaluate(() =>
    window.handleNativeNotification({ notification: { body: 'Announcement' } }),
  );

  // IndexedDB persists read flags, handled IDs and deletion tombstones.
  await page.clock.fastForward(1000);
  const saved = await makeAlert('saved', true);
  await emit([saved]);
  await banner.getByText(saved.message).waitFor();
  await dismiss();
  await openHistory();
  await closeHistory();
  await page.evaluate(() => window.notificationAudit.flushHistory());
  await page.reload();
  await page.waitForFunction(() => window.notificationAudit?.sockets > 0);
  await waitForHistory(1);
  assert.deepEqual(await historyIds(), ['saved']);
  assert.equal(await unreadCount(), 0);
  assert.equal(await soundCount(), 0);
  assert.equal(await banner.count(), 0);
  await synchronize();
  assert.deepEqual(await historyIds(), ['saved']);
  assert.equal(await soundCount(), 0);

  await page.evaluate(() => window.notificationAudit.disableEvents(true));
  await mapButton.waitFor();
  await page.evaluate(() => window.notificationAudit.setLanguage('de'));
  await page.getByRole('button', { name: 'Ereignis', exact: true }).waitFor();
  await mapButton.click();
  await drawer.getByRole('button', { name: 'Benachrichtigungsverlauf schließen' }).click();
  await page.clock.fastForward(400);
  await page.evaluate(() => window.notificationAudit.setLanguage('en'));

  // Retained hidden alerts go stale without alarming; history never expires.
  await page.evaluate(() => window.notificationAudit.setVisible(false));
  const expired = await makeAlert('expired', true);
  await emit([expired]);
  await waitForHistory(2);
  await page.clock.fastForward(16 * 60 * 1000);
  await page.evaluate(() => window.notificationAudit.setVisible(true));
  await synchronize();
  assert.equal(await banner.count(), 0);
  assert.equal(await soundCount(), 0);
  await page.clock.fastForward(25 * 60 * 60 * 1000);
  await synchronize();
  assert.ok((await historyIds()).includes('expired'), 'no 24-hour history limit');

  // Full-session paging after hours offline: all history, newest fresh banner only.
  await page.evaluate(() => window.notificationAudit.reset());
  await waitForHistory(0);
  const beforeArchive = await soundCount();
  await page.evaluate(() =>
    window.notificationAudit.emit(
      Array.from({ length: 250 }, (_, i) => ({
        id: 'archive-' + i,
        type: 'speedhunt',
        audience: 'session',
        occurredAt: '2026-01-01T00:00:00Z',
        timeZone: 'Europe/Zurich',
        message: '[01:00:00] Archive ' + i,
      })),
    ),
  );
  await waitForHistory(250);
  assert.equal(await soundCount(), beforeArchive);
  assert.equal(await unreadCount(), 250);
  await openHistory();
  assert.equal(await drawer.locator('.MuiListItem-root').count(), 100);
  await drawer.getByRole('button', { name: 'Go to page 3', exact: true }).click();
  assert.equal(await drawer.locator('.MuiListItem-root').count(), 50);
  assert.equal(await unreadCount(), 0);
  await closeHistory();
  const batchOlder = await makeAlert('batch-older', true);
  await page.clock.fastForward(1000);
  const batchNewest = await makeAlert('batch-newest', true);
  await emit([batchNewest, batchOlder]);
  await banner.getByText(batchNewest.message).waitFor();
  assert.equal(await soundCount(), beforeArchive + 1);
  await synchronize();
  assert.equal(await soundCount(), beforeArchive + 1);
  await dismiss();

  // Loading failure retains valid cache, then recovery; reset wipes local state.
  await page.evaluate(() => window.notificationAudit.fail(true));
  await page.waitForFunction(() => Boolean(window.notificationAudit.history.error));
  assert.equal((await historyIds()).length, 252);
  await openHistory();
  await drawer.getByRole('alert').waitFor();
  assert.equal(
    await drawer.locator('.MuiListItem-root').count(),
    100,
    'reopening starts with newest history',
  );
  await drawer.getByText(batchNewest.message, { exact: true }).waitFor();
  await page.evaluate(() => window.notificationAudit.fail(false));
  await page.waitForFunction(() => !window.notificationAudit.history.error);
  await closeHistory();
  const permissionBanner = await makeAlert('permission-banner');
  await emit([permissionBanner]);
  await banner.getByText(permissionBanner.message).waitFor();
  const beforeRevocation = await soundCount();
  await page.evaluate(() => window.notificationAudit.fail(403));
  await waitForHistory(0);
  await page.clock.fastForward(400);
  assert.equal(await banner.count(), 0, 'permission denial clears an active banner');
  await page.evaluate(() => window.notificationAudit.fail(false));
  await waitForHistory(253);
  assert.equal(
    await soundCount(),
    beforeRevocation,
    'permission restoration does not replay alarms',
  );
  const resetBanner = await makeAlert('reset-banner');
  await emit([resetBanner]);
  await banner.getByText(resetBanner.message).waitFor();
  await page.evaluate(() => window.notificationAudit.reset());
  await waitForHistory(0);
  await page.clock.fastForward(500);
  assert.equal(await banner.count(), 0);
  assert.equal(await unreadCount(), 0);
  assert.deepEqual(await page.evaluate(() => window.notificationAudit.history.handled), []);
  await page.evaluate(() => window.notificationAudit.flushHistory());
  await page.reload();
  await page.waitForFunction(() => window.notificationAudit?.sockets > 0);
  await waitForHistory(0);
  assert.equal(await soundCount(), 0);

  // Reusing an ID in a fresh generation must not inherit the old banner timer.
  const oldGenerationBanner = await makeAlert('generation-reused-id', true);
  await emit([oldGenerationBanner]);
  await banner.getByText(oldGenerationBanner.message).waitFor();
  await page.mouse.move(10, 400);
  await page.clock.fastForward(50000);
  const newGenerationBanner = await makeAlert('generation-reused-id', true);
  await page.evaluate((alert) => window.notificationAudit.reset(900, [alert]), newGenerationBanner);
  await banner.getByText(newGenerationBanner.message).waitFor();
  await page.clock.fastForward(11000);
  assert.equal(await banner.count(), 1, 'new generation receives a fresh 60-second banner timer');
  await page.clock.fastForward(51000);
  assert.equal(await banner.count(), 0, 'new generation banner also expires after 60 seconds');
  await page.evaluate(() => window.notificationAudit.reset());
  await waitForHistory(0);

  // Every generated role, account/session isolation, and logout.
  for (const role of ['player', 'supporter', 'hunter', 'spectator']) {
    await page.evaluate((value) => window.notificationAudit.setRole(value), role);
    await page.clock.fastForward(1000);
    const speedhunt = await makeAlert('speedhunt-' + role);
    const test = {
      ...(await makeAlert('test-' + role)),
      type: 'notificationTest',
      message: speedhunt.message.replace(
        'Speedhunt: Ping 1 out of 4 sent.',
        'Test notification: check that your phone plays a sound.',
      ),
    };
    const before = await soundCount();
    await emit([speedhunt]);
    await banner.getByText(speedhunt.message).waitFor();
    await emit([test]);
    await banner.getByText(test.message).waitFor();
    assert.equal(await soundCount(), before + 2);
    await dismiss();
  }
  await page.evaluate(() => window.notificationAudit.setRole('unrelated'));
  assert.deepEqual(await historyIds(), []);
  await page.evaluate(() => window.notificationAudit.setRole('player'));
  await waitForHistory(8);
  const beforeIsolation = await soundCount();
  await page.evaluate(() => window.notificationAudit.setSession(901));
  await waitForHistory(0);
  await page.evaluate(() => window.notificationAudit.setSession(900));
  await waitForHistory(8);
  assert.equal(await soundCount(), beforeIsolation);
  await page.evaluate(() => window.notificationAudit.logout());
  assert.deepEqual(await historyIds(), []);
  assert.equal(await banner.count(), 0);
  await page.evaluate(() => window.notificationAudit.login());
  await waitForHistory(8);
  assert.equal(await soundCount(), beforeIsolation);
  if (process.env.TRACCAR_AUDIT_SCREENSHOT) {
    await openHistory();
    await page.screenshot({ path: process.env.TRACCAR_AUDIT_SCREENSHOT });
  }

  // A separate phone with denied IndexedDB still has working in-memory delivery.
  const denied = await browser.newPage({ viewport: { width: 390, height: 844 } });
  denied.on('pageerror', (error) => errors.push(error.message));
  await denied.addInitScript(() =>
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('Storage denied');
      },
    }),
  );
  await denied.goto(`${server.resolvedUrls.local[0]}__notification_audit__`);
  await denied.waitForFunction(() => window.notificationAudit?.sockets > 0);
  await denied.evaluate(() =>
    window.notificationAudit.emit([
      {
        id: 'denied',
        type: 'notificationTest',
        audience: 'session',
        occurredAt: new Date().toISOString(),
        timeZone: 'UTC',
        message: '[12:00:00] Test notification',
      },
    ]),
  );
  await denied
    .locator('.MuiSnackbar-anchorOriginTopCenter')
    .getByText('[12:00:00] Test notification')
    .waitFor();
  assert.equal(await denied.evaluate(() => window.notificationAudit.history.items.length), 1);
  await denied.getByRole('button', { name: 'Dismiss notification' }).click();
  await denied.close();
  // Personal live alerts use the real banner/history controller and account filtering.
  let expectedSounds = await soundCount();
  for (const type of ['liveTrackingStarted', 'liveTrackingTargetsChanged', 'liveTrackingStopped']) {
    const personal = {
      ...(await makeAlert(`personal-${type}`)),
      type,
      audience: 'user',
      recipientUserId: 5,
      sourceDeviceId: 100,
      message: `[12:00:00] ${type}: Anarchist:in. Reason: Usage of public transport.`,
    };
    await emit([personal]);
    await banner.getByText(personal.message).waitFor();
    expectedSounds += 1;
    assert.equal(await soundCount(), expectedSounds);
    assert.ok((await historyIds()).includes(personal.id));
  }
  const anotherUser = {
    ...(await makeAlert('private-other')),
    type: 'liveTrackingStarted',
    audience: 'user',
    recipientUserId: 6,
    sourceDeviceId: 101,
  };
  await emit([anotherUser]);
  await synchronize();
  assert.equal(await soundCount(), expectedSounds);
  assert.ok(!(await historyIds()).includes(anotherUser.id));
  const reassigned = {
    ...(await makeAlert('private-reassigned')),
    type: 'liveTrackingStarted',
    audience: 'user',
    recipientUserId: 5,
    sourceDeviceId: 101,
    message: '[12:00:00] Live ping started for your newly assigned tracker.',
  };
  await emit([reassigned]);
  await synchronize();
  assert.ok(!(await historyIds()).includes(reassigned.id));
  assert.equal(await soundCount(), expectedSounds);
  await page.evaluate(() => window.notificationAudit.setAssignedDevice(101));
  await banner.getByText(reassigned.message).waitFor();
  assert.equal(await soundCount(), ++expectedSounds);
  assert.ok(!(await historyIds()).includes('personal-liveTrackingStarted'));
  await page.evaluate(() => window.notificationAudit.setAssignedDevice(100));
  await page.waitForFunction(() =>
    window.notificationAudit.history.items.some(
      (item) => item.id === 'personal-liveTrackingStarted',
    ),
  );
  await synchronize();
  assert.equal(
    await soundCount(),
    expectedSounds,
    'reassignment back cannot replay handled personal alerts',
  );
  assert.ok(!(await historyIds()).includes(reassigned.id));
  const permissionReceived = {
    ...(await makeAlert('permission-received')),
    type: 'livePingReceived',
    audience: 'livePlayer',
    recipientUserId: 5,
    sourceDeviceId: 200,
    message: '[12:00:00] Live ping from Bob is being received.',
  };
  const permissionPersonal = {
    ...(await makeAlert('permission-personal')),
    type: 'liveTrackingStarted',
    audience: 'user',
    recipientUserId: 5,
    sourceDeviceId: 100,
    message: '[12:00:00] Your private live ping started.',
  };
  await emit([permissionReceived]);
  await banner.getByText(permissionReceived.message).waitFor();
  expectedSounds += 1;
  await emit([permissionPersonal]);
  await banner.getByText(permissionPersonal.message).waitFor();
  assert.equal(await soundCount(), ++expectedSounds);
  await page.evaluate(() => window.notificationAudit.setTrackerAccess(false));
  await page.waitForFunction(
    () => window.notificationAudit.history.personalSourceDeviceId === null,
  );
  await synchronize();
  await page.clock.fastForward(400);
  assert.equal(
    await banner.count(),
    0,
    'revoking tracker access removes the active private banner',
  );
  assert.ok(
    (await historyIds()).includes(permissionReceived.id),
    'destination history is not personal tracker history',
  );
  assert.ok(!(await historyIds()).includes(permissionPersonal.id));
  await page.evaluate(() => window.notificationAudit.setTrackerAccess(true));
  await page.waitForFunction(() =>
    window.notificationAudit.history.items.some((item) => item.id === 'permission-personal'),
  );
  await synchronize();
  assert.equal(
    await banner.count(),
    0,
    'restoring access cannot revive a dismissed/unauthorized banner',
  );
  assert.equal(await soundCount(), expectedSounds, 'restoring access cannot replay handled sounds');
  const anonymousPing = {
    ...(await makeAlert('speedhunt-anonymous')),
    audience: 'nonHunters',
    message: '[12:00:00] Speedhunt: Ping 2 out of 4 sent.',
  };
  const hunterPing = {
    ...anonymousPing,
    id: 'speedhunt-hunters',
    audience: 'hunters',
    message: anonymousPing.message + ' Participant: Älice.',
  };
  for (const role of ['player', 'supporter', 'hunter', 'spectator']) {
    await page.evaluate(
      ({ role, records }) => {
        window.notificationAudit.setRole(role);
        window.notificationAudit.reset(900, records);
      },
      { role, records: [anonymousPing, hunterPing] },
    );
    const named = ['hunter', 'spectator'].includes(role);
    const expected = named ? hunterPing : anonymousPing;
    await banner.getByText(expected.message).waitFor();
    await waitForHistory(1);
    assert.deepEqual(await historyIds(), [expected.id]);
    assert.equal(await soundCount(), ++expectedSounds, 'one banner and alarm per Speedhunt');
    const messages = await page.evaluate(() =>
      window.notificationAudit.history.items.map((item) => item.message),
    );
    assert.equal(
      messages.some((message) => message.includes('Älice')),
      named,
    );
    await dismiss();
    await synchronize();
    assert.equal(await soundCount(), expectedSounds, 'role-scoped history reconnect cannot replay');
  }
  assert.deepEqual(errors, []);
  const liveAudiences = {
    player: 'livePlayer',
    supporter: 'liveSupporter',
    hunter: 'liveHunter',
    spectator: 'liveSpectator',
  };
  for (const [role, audience] of Object.entries(liveAudiences)) {
    const received = {
      ...(await makeAlert('recipient-' + role)),
      type: 'livePingReceived',
      audience,
      recipientUserId: 5,
      sourceDeviceId: 200,
      message:
        '[12:00:00] Live ping from Älice is now being sent to Tschugger. Reason: Usage of public transport.',
    };
    await page.evaluate(
      ({ role, records }) => {
        window.notificationAudit.setRole(role);
        window.notificationAudit.reset(900, records);
      },
      { role, records: [received, { ...received, id: 'other-recipient', recipientUserId: 6 }] },
    );
    await banner.getByText(received.message).waitFor();
    await waitForHistory(1);
    assert.deepEqual(await historyIds(), [received.id]);
    assert.equal(await soundCount(), ++expectedSounds);
    await dismiss();
    await synchronize();
    assert.equal(await soundCount(), expectedSounds);
    await page.evaluate(() => window.notificationAudit.flushHistory());
    await page.reload();
    await page.waitForFunction(() => window.notificationAudit?.sockets > 0);
    await waitForHistory(1);
    assert.equal(await soundCount(), 0, 'recipient cache hydration cannot replay sound');
    expectedSounds = 0;
    const stopped = {
      ...received,
      id: 'recipient-stop-' + role,
      type: 'livePingEnded',
      message:
        '[12:01:00] Live ping from Älice to Tschugger has stopped. Timer expired. Reason: Usage of public transport.',
    };
    await emit([stopped]);
    await banner.getByText(stopped.message).waitFor();
    await waitForHistory(2);
    assert.equal(await soundCount(), ++expectedSounds);
    await dismiss();
  }
  assert.deepEqual(errors, []);
  console.log(
    `${mobileManager ? 'Mobile Manager bridge' : 'Desktop'} database notification audit passed: API recovery, IndexedDB, >100/>24h history, paged drawer, deletion, reset, unread, timeout, replacement, permissions and sound.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
