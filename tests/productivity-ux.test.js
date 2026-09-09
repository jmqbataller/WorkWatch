const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'productivity-ux.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'productivity-ux.css'), 'utf8');

test('productivity UX assets load after the visual refresh layer', () => {
  assert.ok(index.indexOf('productivity-ux.css') > index.indexOf('ui-refresh.css'));
  assert.ok(index.indexOf('productivity-ux.js') > index.indexOf('ui-refresh.js'));
});

test('navigation is grouped around the real product view identifiers', () => {
  for (const view of ['dashboard', 'custom-export', 'weekly-summary', 'invoices', 'analytics', 'settings']) {
    assert.match(script, new RegExp(`['\"]${view}['\"]`));
  }
  assert.match(script, /GROUP_STATE_KEY/);
  assert.match(script, /nav-group-toggle/);
});

test('daily workflow includes quick add, sticky timer, and progress guidance', () => {
  assert.match(script, /ux-quick-task/);
  assert.match(script, /ux-sticky-session/);
  assert.match(script, /Task details/);
  assert.match(script, /Before proof/);
  assert.match(script, /During work/);
});

test('evidence UX supports paste, drop, preview, replace, and remove', () => {
  assert.match(script, /filesFromClipboard/);
  assert.match(script, /addEventListener\('drop'/);
  assert.match(script, /ux-upload-preview/);
  assert.match(script, /data-replace/);
  assert.match(script, /data-remove/);
});

test('autosave, offline feedback, empty actions, and responsive cards are present', () => {
  assert.match(script, /Draft saved/);
  assert.match(script, /navigator\.onLine/);
  assert.match(script, /Start a task/);
  assert.match(script, /dataset\.label/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /content: attr\(data-label\)/);
});

test('compact density can be toggled and remembered', () => {
  assert.match(script, /COMPACT_KEY/);
  assert.match(script, /compact-ui/);
  assert.match(css, /\.compact-ui \.page/);
});
