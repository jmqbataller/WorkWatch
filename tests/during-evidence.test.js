const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const multiDuring = fs.readFileSync(path.join(root, 'multi-during.js'), 'utf8');
const proEvidence = fs.readFileSync(path.join(root, 'pro-evidence.js'), 'utf8');
const productivityUx = fs.readFileSync(path.join(root, 'productivity-ux.js'), 'utf8');

test('During evidence is persisted and mirrored to the active work entry', () => {
  assert.match(multiDuring, /work_entry_during_evidence['"]\)\.insert\(record\)/);
  assert.match(multiDuring, /update\(\{ during_path: path, during_at: capturedAt \}\)/);
  assert.match(multiDuring, /eq\('employee_id', state\.profile\.id\)/);
});

test('saved evidence is reconciled into UI state after the workspace refresh', () => {
  assert.match(multiDuring, /function reconcileDuringEvidence\(record\)/);
  assert.match(multiDuring, /reconcileDuringEvidence\(record\) \|\| didChange/);
  assert.match(multiDuring, /renderShell\(\)/);
});

test('quick capture uses the shared verified During evidence flow', () => {
  assert.match(proEvidence, /window\.WorkWatchDuringEvidence/);
  assert.match(proEvidence, /record=await during\.save\(file,entry,stage\)/);
  assert.match(proEvidence, /await during\.refresh\(record\)/);
});

test('pasted During screenshots are queued and uploaded without a button click', () => {
  assert.match(productivityUx, /function autoUploadPastedDuring\(input, files\)/);
  assert.match(productivityUx, /queuePastedFiles\?\.\(files\)/);
  assert.match(productivityUx, /Uploading automatically/);
  assert.match(multiDuring, /automaticUploadChain/);
  assert.match(multiDuring, /queuePastedFiles/);
});

test('repeated page-level pastes route to the active During evidence input', () => {
  assert.match(productivityUx, /function handleGlobalDuringPaste\(event\)/);
  assert.match(productivityUx, /#personalDuringForm #duringFile:not\(:disabled\)/);
  assert.match(productivityUx, /document\.addEventListener\('paste', handleGlobalDuringPaste\)/);
});
