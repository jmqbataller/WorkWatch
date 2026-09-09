(() => {
  const OWNER_ROLE = 'system_admin';
  const SESSION_KEY = 'ww_work_session_v2';
  const SESSION_HISTORY_KEY = 'ww_work_session_history_v2';
  const LOCAL_TASKS_KEY = 'ww_open_tasks_v2';

  const parse = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
    catch { return fallback; }
  };
  const uid = () => state.profile?.id || state.user?.id || '';
  const dateKey = value => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const breakMs = (record, at = Date.now()) => {
    let ms = Math.max(0, Number(record?.break_seconds || 0)) * 1000;
    if (record?.status === 'paused' && record.paused_at) ms += Math.max(0, at - new Date(record.paused_at).getTime());
    return ms;
  };
  const elapsedMs = (record, at = Date.now()) => {
    if (!record?.started_at) return 0;
    const end = record.ended_at ? new Date(record.ended_at).getTime() : at;
    return Math.max(0, end - new Date(record.started_at).getTime() - breakMs(record, at));
  };

  function sessionsToday() {
    const today = dateKey(new Date());
    const server = (window.WorkWatchSessionMode?.sessions || []).filter(s => s.user_id === uid() && dateKey(s.started_at) === today);
    const history = parse(SESSION_HISTORY_KEY, []).filter(s => s.user_id === uid() && dateKey(s.started_at) === today);
    const active = parse(SESSION_KEY, null);
    return [...server, ...history, ...(active?.user_id === uid() && dateKey(active.started_at) === today ? [active] : [])];
  }

  function actualWorkMs() {
    return sessionsToday().reduce((sum, session) => sum + elapsedMs(session), 0);
  }

  function todayEntries() {
    return (state.entries || []).filter(e => e.employee_id === uid() && isToday(e.started_at));
  }

  function openDailyReport(entries) {
    const completed = entries.filter(e => e.status === 'completed');
    const actual = actualWorkMs();
    const activity = completed.reduce((sum, e) => sum + elapsedMs(e), 0);
    const overlap = Math.max(0, activity - actual);
    const rows = completed.map((e, index) => `<tr><td>${index + 1}</td><td>${esc(e.title)}</td><td>${esc([e.client_label,e.project_label].filter(Boolean).join(' · ') || '—')}</td><td>${fmtTime(e.started_at)}</td><td>${fmtTime(e.ended_at)}</td><td>${fmtDuration(elapsedMs(e))}</td></tr>`).join('');
    const proofCard = (label, time, url) => `<figure><figcaption><strong>${label}</strong><span>${time || '—'}</span></figcaption>${url ? `<img src="${esc(url)}" alt="${label} evidence">` : '<div class="proof-empty">No image</div>'}</figure>`;
    const proofs = completed.map((e, index) => `<section class="proof-block"><div class="proof-head"><div><small>TASK ${index + 1}</small><h2>${esc(e.title)}</h2><p>${esc([e.client_label,e.project_label].filter(Boolean).join(' · ') || e.notes || '')}</p></div><div><strong>${fmtDuration(elapsedMs(e))}</strong><span>Task elapsed</span></div></div><div class="proof-grid">${proofCard('BEFORE',fmtTime(e.started_at),e.before_url)}${(e.during_evidence || []).map((d,i)=>proofCard(`DURING ${i+1}`,fmtTime(d.captured_at),d.url)).join('')}${proofCard('AFTER',fmtTime(e.ended_at),e.after_url)}</div></section>`).join('');
    const w = open('', '_blank');
    if (!w) return toast('Allow pop-ups to open the daily report.', 'error');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>WorkWatch Daily Work Record</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#111827;font:10px Arial,sans-serif;line-height:1.45}@page{size:A4;margin:10mm}.toolbar{position:sticky;top:0;background:#111827;text-align:center;padding:10px}.toolbar button{border:0;border-radius:6px;padding:9px 14px;font-weight:700}.sheet{width:210mm;min-height:297mm;background:#fff;margin:12px auto;padding:11mm 12mm}.head{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:10px}.brand{font-weight:900;letter-spacing:.14em}.head h1{font-size:20px;margin:3px 0}.head p{margin:0;color:#667085}.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cfd4dc;border-top:0}.summary div{padding:9px;border-right:1px solid #cfd4dc}.summary div:last-child{border-right:0}.summary span{display:block;font-size:7px;text-transform:uppercase;color:#667085}.summary strong{font-size:14px}.note{margin:10px 0;padding:8px;border:1px solid #d0d5dd;background:#f9fafb;color:#475467}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #d0d5dd;padding:6px;text-align:left;vertical-align:top}th{background:#f2f4f7;font-size:7px;text-transform:uppercase}.proof-block{border:1px solid #cfd4dc;margin-top:14px;break-inside:avoid}.proof-head{display:flex;justify-content:space-between;gap:12px;padding:8px;background:#fafafa;border-bottom:1px solid #d0d5dd}.proof-head h2{font-size:12px;margin:2px 0}.proof-head p,.proof-head span{margin:0;color:#667085}.proof-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px}.proof-grid figure{margin:0;border:1px solid #d0d5dd}.proof-grid figcaption{display:flex;justify-content:space-between;padding:5px;background:#f9fafb}.proof-grid img,.proof-empty{width:100%;height:46mm;object-fit:contain;display:flex;align-items:center;justify-content:center;color:#98a2b3}@media print{body{background:#fff}.toolbar{display:none}.sheet{margin:0;width:auto;min-height:auto;padding:0}}
    </style></head><body><div class="toolbar"><button onclick="print()">Print / Save PDF</button></div><main class="sheet"><header class="head"><div><div class="brand">WORKWATCH</div><h1>Daily Work Record</h1><p>${esc(state.profile?.full_name || '')}</p></div><div><strong>${esc(fmtDate(new Date()))}</strong><p>Generated ${new Date().toLocaleString()}</p></div></header><section class="summary"><div><span>Actual work time</span><strong>${fmtDuration(actual)}</strong></div><div><span>Task activity</span><strong>${fmtDuration(activity)}</strong></div><div><span>Completed tasks</span><strong>${completed.length}</strong></div><div><span>Overlap</span><strong>${fmtDuration(overlap)}</strong></div></section><div class="note"><strong>Actual Work Time</strong> comes from the work-session clock. Task Activity is the sum of individual task timers and may be higher when tasks overlap; overlapping tasks are not double-counted as worked hours.</div><table><thead><tr><th>#</th><th>Task</th><th>Client / Project</th><th>Start</th><th>End</th><th>Task elapsed</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No completed tasks yet.</td></tr>'}</tbody></table>${proofs}</main></body></html>`);
    w.document.close();
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#exportToday');
    if (!button || state.profile?.role !== OWNER_ROLE || state.view !== 'dashboard') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openDailyReport(todayEntries());
  }, true);

  function patchSyncNote() {
    if (state.profile?.role !== OWNER_ROLE || state.view !== 'dashboard') return;
    const note = document.querySelector('.ww-storage-note');
    if (!note) return;
    if (window.WorkWatchSessionMode?.schemaAvailable === null) note.textContent = 'Checking session sync…';
  }

  const observer = new MutationObserver(patchSyncNote);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(patchSyncNote);

  window.addEventListener('storage', event => {
    if (![SESSION_KEY, SESSION_HISTORY_KEY, LOCAL_TASKS_KEY].includes(event.key)) return;
    if (state.profile?.role === OWNER_ROLE && state.view === 'dashboard') renderShell();
  });
})();
