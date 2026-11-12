const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../Model.js');

// Exercise the real QML functions with their process and device dependencies replaced.
const panel = fs.readFileSync(require.resolve('../Panel.qml'), 'utf8');
function panelFunction(name, context) {
  const start = panel.indexOf('  function ' + name + '(');
  const end = panel.indexOf('\n  }', start) + 4;
  return vm.runInNewContext('(' + panel.slice(start, end).trim() + ')', context);
}

test('unchanged primitive models keep delegates; changed data replaces the model', () => {
  const previous = [{ id: 'one', active: false }];
  assert.equal(Model.stableRows(previous, [{ id: 'one', active: false }]), previous);
  const changed = [{ id: 'one', active: true }];
  assert.equal(Model.stableRows(previous, changed), changed);
  assert.deepEqual(Model.stableRows(previous, []), []);
});

test('WireGuard refresh skips unrelated DNS, band, wired, hotspot and Wi-Fi work', () => {
  let wireguardQueries = 0;
  const unexpected = () => { throw Error('Hidden Network tab performed work'); };
  const root = { refreshWireguard: () => wireguardQueries++ };
  const refresh = panelFunction('refresh', {
    root, networkVisible: false, detailsProc: { running: false }, refreshWireguard: root.refreshWireguard,
    dnsProc: { get running() { return unexpected(); } },
    setScannerEnabled: unexpected, syncWifiNetworks: unexpected,
  });
  refresh(true);
  assert.equal(wireguardQueries, 1);
});

test('hidden Network tab releases its scanner and never starts a new scan', () => {
  const old = { scannerEnabled: true };
  const context = { root: { hotspotActive: false }, scannerDevice: old, networkVisible: false,
                    wifiDevice: { scannerEnabled: false } };
  panelFunction('setScannerEnabled', context)(true);
  assert.equal(old.scannerEnabled, false);
  assert.equal(context.wifiDevice.scannerEnabled, false);
  assert.equal(context.scannerDevice, null);
});

test('Wi-Fi rendering stays bounded and prioritizes the connected network', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ ssid: String(i), connected: i === 999, known: false, signal: i % 100 }));
  assert.equal(Model.sortWifiRows(rows).length, Model.MAX_WIFI_ROWS);
  assert.equal(Model.sortWifiRows(rows)[0].ssid, '999');
  assert.equal(rows[0].ssid, '0');
});

test('malformed QR data is rejected', () => {
  assert.equal(Model.parseQrMatrix('01\n10').size, 2);
  assert.equal(Model.parseQrMatrix('010\n10').size, 0);
  assert.equal(Model.parseQrMatrix('<img>').size, 0);
});

test('clipboard copy opens a new input channel and ignores overlapping writes', () => {
  const clipboardProc = { running: false, stdinEnabled: false };
  const copy = panelFunction('copyToClipboard', { clipboardProc });
  copy('example', true);
  assert.equal(clipboardProc.stdinEnabled, true);
  assert.equal(clipboardProc.textToCopy, 'example');
  assert.equal(clipboardProc.sensitive, true);
  assert.equal(clipboardProc.running, true);
  copy('overlapping', false);
  assert.equal(clipboardProc.textToCopy, 'example');
  const handler = panel.match(/id: clipboardProc[\s\S]*?onStarted: \{([\s\S]*?)\n    \}/)[1];
  let written = '';
  const context = { write: text => { written += text; }, textToCopy: 'example', stdinEnabled: true };
  vm.runInNewContext(handler, context);
  assert.equal(written, 'example');
  assert.equal(context.stdinEnabled, false);
  assert.equal(context.textToCopy, '');
});

test('a late hotspot query cannot restore a password after the panel closes', () => {
  const root = { networkVisible: false, hotspotQrOpen: false, hotspotEditing: false, hotspotClientList: [] };
  const update = panelFunction('updateHotspot', { root, Model });
  update(JSON.stringify({ name: 'example', password: 'test-passphrase' }));
  assert.equal(root.hotspotPassword, '');
  assert.equal(root.hotspotDraftPassword, '');
  root.networkVisible = true;
  update(JSON.stringify({ name: 'example', password: 'test-passphrase' }));
  assert.equal(root.hotspotPassword, 'test-passphrase');
});

test('all exported shell scripts remain valid Bash', () => {
  const { spawnSync } = require('node:child_process');
  for (const [name, value] of Object.entries(Model)) {
    if (typeof value !== 'string' || !/Script|Helper|Function/.test(name)) continue;
    const result = spawnSync('bash', ['-n'], { input: value, encoding: 'utf8' });
    assert.equal(result.status, 0, name + ': ' + result.stderr);
  }
});
