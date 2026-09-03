const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mondayThisWeek() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600000);
}

function makeDom() {
  const elements = new Map();
  const makeElement = (id, html = '') => ({
    id,
    value: html.match(/\bvalue="([^"]*)"/)?.[1] || '',
    checked: /\bchecked\b/.test(html),
    disabled: /\bdisabled\b/.test(html),
    innerHTML: '',
    onclick: null,
    onchange: null,
    addEventListener(type, handler) { this[`on${type}`] = handler; }
  });
  const pageElement = {};
  Object.defineProperty(pageElement, 'innerHTML', {
    get() { return this._innerHTML || ''; },
    set(html) {
      this._innerHTML = html;
      for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        elements.set(match[1], makeElement(match[1], match[0]));
      }
    }
  });
  return {
    pageElement,
    document: {
      body: { appendChild() {} },
      createElement() { return { click() {}, remove() {} }; },
      getElementById(id) { return elements.get(id) || null; }
    },
    get(id) { return elements.get(id); }
  };
}

test('Weekly Summary is added to navigation and totals completed work with breaks excluded', () => {
  const dom = makeDom();
  const monday = mondayThisWeek();
  const taskOneStart = addHours(monday, 8);
  const taskTwoStart = addHours(monday, 11);
  const entries = [
    {
      id: 'one', employee_id: 'owner', title: 'Homepage investigation', status: 'completed',
      started_at: taskOneStart.toISOString(), ended_at: addHours(taskOneStart, 1).toISOString(),
      break_seconds: 0, client_label: 'Setiba', before_url: 'before.png', after_url: 'after.png'
    },
    {
      id: 'two', employee_id: 'owner', title: 'Homepage restoration', status: 'completed',
      started_at: taskTwoStart.toISOString(), ended_at: addHours(taskTwoStart, 2).toISOString(),
      break_seconds: 900, client_label: 'Setiba', project_label: 'Website', before_url: 'before-2.png'
    }
  ];

  const context = {
    window: { WorkWatchPro: {
      own: () => entries,
      dateKey: localDateKey,
      breakMs: entry => Number(entry.break_seconds || 0) * 1000,
      workMs: entry => new Date(entry.ended_at) - new Date(entry.started_at) - Number(entry.break_seconds || 0) * 1000,
      checklistFor: () => []
    } },
    state: { profile: { id: 'owner', role: 'system_admin', full_name: 'John Mark' }, entries },
    navFor: () => [['dashboard', 'My Workday', 'clock'], ['reports', 'Reports', 'report'], ['custom-export', 'Custom Export', 'report']],
    titleFor: (_role, view) => view,
    renderPage: () => 'base',
    page: () => dom.pageElement,
    document: dom.document,
    navigator: { clipboard: { writeText: async () => {} } },
    Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    open: () => null,
    toast() {},
    head: (title, subtitle, actions = '') => `<header><h1>${title}</h1><p>${subtitle}</p>${actions}</header>`,
    metric: (key, value, subtitle = '') => `<article><span>${key}</span><strong>${value}</strong><small>${subtitle}</small></article>`,
    esc: value => String(value ?? ''),
    fmtDate: value => localDateKey(value),
    fmtTime: value => new Date(value).toISOString().slice(11, 16),
    fmtDuration: ms => {
      const seconds = Math.floor(ms / 1000);
      return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
        .map(value => String(value).padStart(2, '0')).join(':');
    },
    console,
    Date,
    Map,
    Set,
    Math,
    String,
    Array,
    Number
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('weekly-summary.js', 'utf8'), context);

  const nav = context.navFor('system_admin');
  assert.equal(nav.findIndex(([view]) => view === 'weekly-summary'), 3);
  assert.equal(context.titleFor('system_admin', 'weekly-summary'), 'Weekly Summary');

  context.state.view = 'weekly-summary';
  context.renderPage('system_admin');
  const result = dom.get('weeklySummaryResult');
  assert.ok(result);
  assert.match(result.innerHTML, /02:45:00/);
  assert.match(result.innerHTML, /Completed tasks/);
  assert.match(result.innerHTML, />2</);
  assert.match(result.innerHTML, /3 evidence images/);
  assert.equal(dom.get('weeklyPdf').disabled, false);
});

