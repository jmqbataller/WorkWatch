const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localIso(year, month, day, hour = 0) {
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

function makeDom() {
  const elements = new Map();
  const pageElement = {};
  Object.defineProperty(pageElement, 'innerHTML', {
    get() { return this._html || ''; },
    set(html) {
      this._html = html;
      for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        const tag = match[0];
        elements.set(match[1], {
          id: match[1],
          value: tag.match(/\bvalue="([^"]*)"/)?.[1] || '',
          disabled: /\bdisabled\b/.test(tag),
          textContent: '',
          innerHTML: '',
          addEventListener(type, handler) { this[`on${type}`] = handler; },
          click() {}
        });
      }
    }
  });
  return {
    pageElement,
    document: {
      getElementById: id => elements.get(id) || null,
      querySelectorAll: () => []
    }
  };
}

function loadModule(entries = [], dom = null) {
  const context = {
    window: { WorkWatchPro: {
      own: () => entries,
      dateKey,
      breakMs: entry => Number(entry.break_seconds || 0) * 1000,
      workMs: entry => new Date(entry.ended_at) - new Date(entry.started_at) - Number(entry.break_seconds || 0) * 1000
    } },
    state: { profile: { id: 'owner', role: 'system_admin' }, entries, view: 'dashboard' },
    navFor: () => [['reports', 'Reports', 'report'], ['custom-export', 'Custom Export', 'report'], ['weekly-summary', 'Weekly Summary', 'report']],
    titleFor: (_role, view) => view,
    renderPage: () => 'base',
    loadWorkspace: async () => {},
    renderShell() {},
    page: () => dom?.pageElement || ({ innerHTML: '' }),
    document: dom?.document || { getElementById: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => '', setItem() {} },
    navigator: {},
    confirm: () => true,
    open: () => null,
    toast() {},
    head: (title, subtitle, actions = '') =>
      `<header><h1>${title}</h1><p>${subtitle}</p>${actions}</header>`,
    metric: () => '',
    esc: value => String(value ?? ''),
    fmtDate: value => dateKey(value),
    fmtTime: () => '',
    fmtDuration: () => '',
    Intl,
    Date,
    Map,
    Set,
    Math,
    Number,
    String,
    Array,
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('invoice-generator.js', 'utf8'), context);
  return context;
}

test('invoice navigation is added after Weekly Summary', () => {
  const context = loadModule();
  const views = context.navFor('system_admin').map(([view]) => view);
  assert.deepEqual(JSON.parse(JSON.stringify(views)), ['reports', 'custom-export', 'weekly-summary', 'invoices']);
  assert.equal(context.titleFor('system_admin', 'invoices'), 'Invoices');
});

test('invoice total uses break-excluded task time and rounds each line', () => {
  const firstStart = new Date(2026, 8, 3, 8);
  const secondStart = new Date(2026, 8, 3, 10);
  const entries = [
    { started_at: firstStart.toISOString(), ended_at: new Date(firstStart.getTime() + 3600000).toISOString(), break_seconds: 0 },
    { started_at: secondStart.toISOString(), ended_at: new Date(secondStart.getTime() + 8100000).toISOString(), break_seconds: 900 }
  ];
  const context = loadModule(entries);
  assert.equal(context.window.JMWorkLogBilling.computeInvoiceTotal(entries, 20), 60);
});

test('earnings summary counts paid invoices by paid date and separates outstanding balances', () => {
  const context = loadModule();
  const now = new Date(2026, 8, 3, 12);
  const invoices = [
    { status: 'paid', paid_at: localIso(2026, 9, 3, 9), total_amount: 100 },
    { status: 'paid', paid_at: localIso(2026, 9, 1, 9), total_amount: 50 },
    { status: 'paid', paid_at: localIso(2026, 8, 20, 9), total_amount: 25 },
    { status: 'paid', paid_at: localIso(2026, 1, 10, 9), total_amount: 10 },
    { status: 'paid', paid_at: localIso(2025, 12, 31, 9), total_amount: 5 },
    { status: 'pending', total_amount: 40 },
    { status: 'not_paid', total_amount: 60 }
  ];
  const totals = context.window.JMWorkLogBilling.computeEarnings(invoices, now);
  assert.deepEqual(JSON.parse(JSON.stringify(totals)), {
    today: 100,
    week: 150,
    month: 150,
    year: 185,
    allTime: 190,
    outstanding: 100,
    pending: 40,
    notPaid: 60
  });
});

test('invoice migration protects data and receipts with owner-scoped RLS', () => {
  const migration = fs.readFileSync('supabase/migrations/20260903012414_invoice_generator.sql', 'utf8');
  assert.match(migration, /alter table public\.invoices enable row level security/i);
  assert.match(migration, /alter table public\.invoice_items enable row level security/i);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on public\.invoices, public\.invoice_items from anon/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /'payment-receipts'[\s\S]+false[\s\S]+10485760/i);
  assert.match(migration, /payment_receipts_insert_own/i);
});

test('invoice page renders earning periods, task billing controls, statuses, and history', () => {
  const dom = makeDom();
  const context = loadModule([], dom);
  context.state.demoRole = 'system_admin';
  context.state.view = 'invoices';
  context.window.JMWorkLogBilling.loaded = true;
  context.window.JMWorkLogBilling.invoices = [{
    id: 'invoice-1', invoice_number: 'INV-TEST', client_name: 'Test Client', client_email: '',
    hourly_rate: 20, subtotal: 40, total_amount: 40, status: 'pending', issued_on: '2026-09-03',
    due_on: null, paid_at: null, receipt_path: null
  }];
  context.renderPage('system_admin');
  const html = dom.pageElement.innerHTML;
  assert.match(html, /Invoice Generator/);
  assert.match(html, /Today/);
  assert.match(html, /This week/);
  assert.match(html, /This month/);
  assert.match(html, /This year/);
  assert.match(html, /All time/);
  assert.match(html, /Hourly rate \(USD\)/);
  assert.match(html, /Generate invoice/);
  assert.match(html, /Not Paid/);
  assert.match(html, /Pending/);
  assert.match(html, /Paid/);
  assert.match(html, /INV-TEST/);
});
