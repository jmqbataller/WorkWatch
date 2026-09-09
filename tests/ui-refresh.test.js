const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const uiScript = fs.readFileSync(path.join(root, 'ui-refresh.js'), 'utf8');

test('brand assets and refresh layer are loaded in the document', () => {
  assert.match(index, /assets\/favicon\.svg/);
  assert.match(index, /ui-refresh\.css/);
  assert.match(index, /ui-refresh\.js/);
  assert.ok(fs.existsSync(path.join(root, 'assets', 'logo-mark.svg')));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'favicon.svg')));
});

test('mobile navigation is accessible and can be dismissed', () => {
  assert.match(uiScript, /aria-expanded/);
  assert.match(uiScript, /aria-label', 'Open navigation/);
  assert.match(uiScript, /event\.key === 'Escape'/);
  assert.match(uiScript, /window\.innerWidth > 760/);
});
