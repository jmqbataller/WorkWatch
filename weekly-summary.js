(() => {
  const OWNER = 'system_admin';
  const baseNavFor = navFor;
  const baseTitleFor = titleFor;
  const baseRenderPage = renderPage;

  const pro = () => window.WorkWatchPro || {};
  const own = () => pro().own?.() || (state.entries || [])
    .filter(entry => entry.employee_id === state.profile?.id && !entry.deleted_at)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const checklistFor = id => pro().checklistFor?.(id) || [];
  const dateKey = value => pro().dateKey?.(value) || (() => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  })();
  const breakMs = entry => pro().breakMs?.(entry) ?? Math.max(0, Number(entry.break_seconds || 0) * 1000);
  const workMs = entry => pro().workMs?.(entry) ?? Math.max(0,
    new Date(entry.ended_at || Date.now()) - new Date(entry.started_at) - breakMs(entry)
  );
  const slug = value => String(value || 'JM_WorkLog')
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'JM_WorkLog';

  let selectedWeekStart = startOfWeek(new Date());

  navFor = function (role) {
    const nav = baseNavFor(role);
    if (role !== OWNER || nav.some(([view]) => view === 'weekly-summary')) return nav;
    const next = [...nav];
    const customExportIndex = next.findIndex(([view]) => view === 'custom-export');
    const reportsIndex = next.findIndex(([view]) => view === 'reports');
    next.splice(customExportIndex >= 0 ? customExportIndex + 1 : reportsIndex >= 0 ? reportsIndex + 1 : 2, 0,
      ['weekly-summary', 'Weekly Summary', 'report']);
    return next;
  };

  titleFor = function (role, view) {
    if (role === OWNER && view === 'weekly-summary') return 'Weekly Summary';
    return baseTitleFor(role, view);
  };

  renderPage = function (role) {
    if (role === OWNER && state.view === 'weekly-summary') return renderWeeklySummary();
    return baseRenderPage(role);
  };

  function startOfWeek(value) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
  }

  function addDays(value, days) {
    const date = new Date(value);
    date.setDate(date.getDate() + days);
    return date;
  }

  function parseLocalDate(value) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function weekEnd(start) {
    return addDays(start, 6);
  }

  function rangeLabel(start) {
    const end = weekEnd(start);
    const sameYear = start.getFullYear() === end.getFullYear();
    const startText = start.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' })
    });
    const endText = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startText} – ${endText}`;
  }

  function entriesForWeek(start) {
    const from = dateKey(start);
    const to = dateKey(weekEnd(start));
    return own().filter(entry => entry.status === 'completed' && dateKey(entry.started_at) >= from && dateKey(entry.started_at) <= to);
  }

  function evidenceCount(entry) {
    return (entry.before_url ? 1 : 0) + (entry.during_evidence?.length || 0) + (entry.after_url ? 1 : 0);
  }

  function totalFor(entries, getter) {
    return entries.reduce((sum, entry) => sum + getter(entry), 0);
  }

  function groupDuration(entries, key) {
    const grouped = new Map();
    entries.forEach(entry => {
      const label = entry[key] || 'Unlabeled';
      grouped.set(label, (grouped.get(label) || 0) + workMs(entry));
    });
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }

  function renderWeeklySummary() {
    page().innerHTML = head(
      'Weekly Work Summary',
      'Review a complete seven-day work period and export a client-ready summary.',
      '<button class="btn" id="weeklyCopy" disabled>Copy summary</button><button class="btn" id="weeklyCsv" disabled>Export CSV</button><button class="btn btn-primary" id="weeklyPdf" disabled>Export PDF</button>'
    ) + `
      <section class="panel weekly-controls">
        <div class="panel-body">
          <div class="weekly-control-row">
            <div class="field weekly-week-field">
              <label>Week starts</label>
              <input class="input" id="weeklyStart" type="date" value="${dateKey(selectedWeekStart)}">
            </div>
            <div class="weekly-nav-actions">
              <button class="btn" id="weeklyPrevious" type="button">← Previous week</button>
              <button class="btn" id="weeklyCurrent" type="button">This week</button>
              <button class="btn" id="weeklyNext" type="button">Next week →</button>
            </div>
          </div>
          <div class="weekly-options">
            <label><input id="weeklyIncludeNotes" type="checkbox" checked> Include task notes and checklists</label>
            <label><input id="weeklyIncludeEvidence" type="checkbox" checked> Include Before, During, and After evidence in PDF</label>
          </div>
        </div>
      </section>
      <div id="weeklySummaryResult"></div>`;

    const input = document.getElementById('weeklyStart');
    const setWeek = date => {
      selectedWeekStart = new Date(date);
      input.value = dateKey(selectedWeekStart);
      drawWeeklyResult();
    };
    input.addEventListener('change', () => {
      const parsed = parseLocalDate(input.value);
      if (parsed) setWeek(parsed);
    });
    document.getElementById('weeklyPrevious').onclick = () => setWeek(addDays(selectedWeekStart, -7));
    document.getElementById('weeklyCurrent').onclick = () => setWeek(startOfWeek(new Date()));
    document.getElementById('weeklyNext').onclick = () => setWeek(addDays(selectedWeekStart, 7));
    document.getElementById('weeklyIncludeNotes').onchange = drawWeeklyResult;
    document.getElementById('weeklyIncludeEvidence').onchange = drawWeeklyResult;
    drawWeeklyResult();
  }

  function drawWeeklyResult() {
    const entries = entriesForWeek(selectedWeekStart);
    const result = document.getElementById('weeklySummaryResult');
    if (!result) return;

    const total = totalFor(entries, workMs);
    const excludedBreak = totalFor(entries, breakMs);
    const workdays = new Set(entries.map(entry => dateKey(entry.started_at))).size;
    const clients = new Set(entries.map(entry => entry.client_label).filter(Boolean)).size;
    const projects = new Set(entries.map(entry => entry.project_label).filter(Boolean)).size;
    const proofs = totalFor(entries, evidenceCount);
    const byClient = groupDuration(entries, 'client_label');
    const byProject = groupDuration(entries, 'project_label');
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(selectedWeekStart, index);
      const rows = entries.filter(entry => dateKey(entry.started_at) === dateKey(date));
      return { date, rows, total: totalFor(rows, workMs) };
    });
    const maxDay = Math.max(...days.map(day => day.total), 1);

    result.innerHTML = `
      <div class="weekly-period"><span>Selected period</span><strong>${rangeLabel(selectedWeekStart)}</strong></div>
      <div class="grid metrics weekly-metrics">
        ${metric('Recorded time', fmtDuration(total), 'Breaks excluded')}
        ${metric('Completed tasks', entries.length, 'Selected week')}
        ${metric('Workdays', workdays, 'Days with completed work')}
        ${metric('Clients / Projects', `${clients} / ${projects}`, `${proofs} evidence image${proofs === 1 ? '' : 's'}`)}
      </div>
      ${entries.length ? `
        <div class="grid split weekly-overview">
          <section class="panel">
            <div class="panel-head"><div><div class="panel-title">Daily recorded time</div><div class="panel-desc">Monday through Sunday</div></div></div>
            <div class="panel-body weekly-day-bars">
              ${days.map(day => `<div class="weekly-day-row"><span>${day.date.toLocaleDateString(undefined, { weekday: 'short' })}</span><div><i style="width:${Math.round(day.total / maxDay * 100)}%"></i></div><strong class="mono">${fmtDuration(day.total)}</strong></div>`).join('')}
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><div class="panel-title">Work distribution</div><div class="panel-desc">Combined time by client and project</div></div></div>
            <div class="panel-body weekly-distribution">
              ${distribution('Clients', byClient)}
              ${distribution('Projects', byProject)}
            </div>
          </section>
        </div>
        <section class="panel weekly-task-panel">
          <div class="panel-head"><div><div class="panel-title">Completed work</div><div class="panel-desc">${entries.length} task${entries.length === 1 ? '' : 's'} · ${fmtDuration(excludedBreak)} break excluded</div></div></div>
          <div class="panel-body" style="padding:0">${weeklyTaskTable(entries)}</div>
        </section>` : `
        <section class="panel weekly-empty"><div class="empty"><strong>No completed work in this week</strong><span>Choose another week or complete a task to generate a summary.</span></div></section>`}
    `;

    ['weeklyCopy', 'weeklyCsv', 'weeklyPdf'].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = !entries.length;
    });
    document.getElementById('weeklyCopy').onclick = () => copyWeeklySummary(entries);
    document.getElementById('weeklyCsv').onclick = () => exportWeeklyCsv(entries);
    document.getElementById('weeklyPdf').onclick = () => openWeeklyPdf(entries);
  }

  function distribution(title, rows) {
    return `<div><h3>${title}</h3>${rows.length
      ? `<div class="weekly-ranking">${rows.slice(0, 5).map(([label, ms]) => `<div><span>${esc(label)}</span><strong class="mono">${fmtDuration(ms)}</strong></div>`).join('')}</div>`
      : '<p class="weekly-muted">No labels recorded.</p>'}</div>`;
  }

  function weeklyTaskTable(entries) {
    const rows = [...entries].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Task</th><th>Client / Project</th><th>Time</th><th>Break</th><th>Recorded</th><th>Evidence</th></tr></thead><tbody>${rows.map(entry => `
      <tr>
        <td>${fmtDate(entry.started_at)}</td>
        <td><div class="td-main">${esc(entry.title)}</div><div class="td-sub">${esc(entry.notes || '')}</div></td>
        <td>${esc([entry.client_label, entry.project_label].filter(Boolean).join(' · ') || '—')}</td>
        <td>${fmtTime(entry.started_at)} – ${fmtTime(entry.ended_at)}</td>
        <td class="mono">${fmtDuration(breakMs(entry))}</td>
        <td class="mono"><strong>${fmtDuration(workMs(entry))}</strong></td>
        <td>${evidenceCount(entry)} image${evidenceCount(entry) === 1 ? '' : 's'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  async function copyWeeklySummary(entries) {
    if (!entries.length) return;
    const sorted = [...entries].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    const lines = [
      `Weekly Work Summary — ${rangeLabel(selectedWeekStart)}`,
      `Completed tasks: ${sorted.length}`,
      `Total recorded time: ${fmtDuration(totalFor(sorted, workMs))}`,
      `Workdays: ${new Set(sorted.map(entry => dateKey(entry.started_at))).size}`,
      '',
      ...sorted.map(entry => `• ${fmtDate(entry.started_at)} — ${entry.title} (${fmtDuration(workMs(entry))})`)
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Weekly summary copied.');
    } catch {
      toast('Could not copy the summary.','error');
    }
  }

  function exportWeeklyCsv(entries) {
    if (!entries.length) return;
    const rows = [[
      'Date', 'Task', 'Notes', 'Client', 'Project', 'Start', 'End', 'Break Excluded', 'Recorded Time', 'Evidence Images'
    ], ...[...entries].sort((a, b) => new Date(a.started_at) - new Date(b.started_at)).map(entry => [
      dateKey(entry.started_at), entry.title, entry.notes || '', entry.client_label || '', entry.project_label || '',
      fmtTime(entry.started_at), fmtTime(entry.ended_at), fmtDuration(breakMs(entry)), fmtDuration(workMs(entry)), evidenceCount(entry)
    ])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadFile(`JM_WorkLog_Weekly_Summary_${dateKey(selectedWeekStart)}_to_${dateKey(weekEnd(selectedWeekStart))}.csv`, csv, 'text/csv');
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openWeeklyPdf(entries) {
    if (!entries.length) return toast('No completed work is available for this week.', 'error');
    const includeNotes = document.getElementById('weeklyIncludeNotes')?.checked !== false;
    const includeEvidence = document.getElementById('weeklyIncludeEvidence')?.checked !== false;
    const sorted = [...entries].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    const from = dateKey(selectedWeekStart);
    const to = dateKey(weekEnd(selectedWeekStart));
    const total = totalFor(sorted, workMs);
    const breaks = totalFor(sorted, breakMs);
    const workdays = new Set(sorted.map(entry => dateKey(entry.started_at))).size;
    const clients = new Set(sorted.map(entry => entry.client_label).filter(Boolean)).size;
    const name = state.profile?.full_name || 'John Mark';
    const filename = `${slug(name)}_JM_WorkLog_Weekly_Summary_${from}_to_${to}`;
    const taskRows = sorted.map((entry, index) => `<tr>
      <td>${index + 1}</td><td>${fmtDate(entry.started_at)}</td>
      <td><strong>${esc(entry.title)}</strong>${includeNotes && entry.notes ? `<div class="note">${esc(entry.notes)}</div>` : ''}${includeNotes ? printChecklist(entry) : ''}</td>
      <td>${esc([entry.client_label, entry.project_label].filter(Boolean).join(' · ') || '—')}</td>
      <td>${fmtTime(entry.started_at)} – ${fmtTime(entry.ended_at)}</td>
      <td class="mono">${fmtDuration(breakMs(entry))}</td><td class="mono">${fmtDuration(workMs(entry))}</td>
    </tr>`).join('');
    const daySections = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(selectedWeekStart, index);
      const rows = sorted.filter(entry => dateKey(entry.started_at) === dateKey(date));
      if (!rows.length) return '';
      return `<section class="day-summary"><header><strong>${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</strong><span>${rows.length} task${rows.length === 1 ? '' : 's'} · ${fmtDuration(totalFor(rows, workMs))}</span></header>${rows.map(entry => `<p><b>${esc(entry.title)}</b>${entry.notes && includeNotes ? ` — ${esc(entry.notes)}` : ''}</p>`).join('')}</section>`;
    }).join('');
    const proofs = includeEvidence ? sorted.map((entry, index) => printProofBlock(entry, index)).join('') : '';
    const win = open('', '_blank');
    if (!win) return toast('Allow pop-ups to open the printable weekly summary.', 'error');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(filename)}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#edf1f5;color:#101828;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.45}@page{size:A4 portrait;margin:10mm}.toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:center;padding:10px;background:#101828}.toolbar button{border:0;border-radius:6px;background:#fff;color:#101828;padding:9px 15px;font-weight:800;cursor:pointer}.sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:11mm 12mm;box-shadow:0 2px 16px #10182818}.report-head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #101828;padding-bottom:10px}.brand{font-weight:900;letter-spacing:.16em;font-size:13px}.report-head h1{font-size:21px;margin:5px 0 0}.meta{text-align:right;color:#667085}.meta strong{display:block;color:#101828}.record-info{display:grid;grid-template-columns:1.3fr 1fr;border:1px solid #cfd4dc;margin-top:13px}.record-info>div,.summary>div{padding:8px 9px}.record-info>div+div,.summary>div+div{border-left:1px solid #d9dde4}.label{display:block;color:#667085;font-size:7.5px;text-transform:uppercase;letter-spacing:.08em}.value{font-weight:800}.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cfd4dc;border-top:0}.summary strong{display:block;font-size:15px}.section-title{margin:16px 0 6px;font-size:9px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d9dde4;padding:5px;vertical-align:top;word-wrap:break-word}th{background:#f2f4f7;font-size:7px;text-transform:uppercase}.mono{font-family:Consolas,monospace}.note{color:#667085;font-size:8px;margin-top:2px}.checklist{display:flex;flex-direction:column;margin-top:4px;color:#475467;font-size:7.5px}.day-summary{border:1px solid #d9dde4;margin:6px 0;padding:7px 8px;break-inside:avoid}.day-summary header{display:flex;justify-content:space-between;border-bottom:1px solid #e4e7ec;padding-bottom:4px}.day-summary p{margin:5px 0 0}.proof-block{margin-top:11px;border:1px solid #cfd4dc;break-inside:avoid}.proof-head{display:flex;justify-content:space-between;gap:12px;padding:8px 9px;background:#fafbfc;border-bottom:1px solid #d9dde4}.proof-head small{color:#667085;font-weight:900}.proof-head h2{font-size:11px;margin:2px 0}.proof-head p{margin:0;color:#667085}.proof-time{text-align:right}.proof-time span{display:block;color:#667085}.proof-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px}.proof-card{margin:0;border:1px solid #d9dde4}.proof-card figcaption{display:flex;justify-content:space-between;gap:5px;padding:5px;background:#f8fafc;font-size:7.5px}.proof-image{height:48mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f7f8fa}.proof-image img{width:100%;height:100%;object-fit:contain}.proof-empty{padding:18px 7px;text-align:center;color:#98a2b3}.proof-caption{padding:5px;border-top:1px solid #e4e7ec;color:#475467;font-size:7px}.footer{margin-top:12px;border-top:1px solid #e4e7ec;padding-top:6px;color:#98a2b3;text-align:center;font-size:7.5px}@media print{body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.proof-block,.day-summary{break-inside:avoid}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet">
      <header class="report-head"><div><div class="brand">JM WORKLOG</div><h1>Weekly Work Summary</h1></div><div class="meta"><strong>${esc(from)} – ${esc(to)}</strong>Generated ${new Date().toLocaleString()}</div></header>
      <section class="record-info"><div><span class="label">Name</span><span class="value">${esc(name)}</span></div><div><span class="label">Week</span><span class="value">${esc(rangeLabel(selectedWeekStart))}</span></div></section>
      <section class="summary"><div><span class="label">Recorded time</span><strong class="mono">${fmtDuration(total)}</strong></div><div><span class="label">Completed tasks</span><strong>${sorted.length}</strong></div><div><span class="label">Workdays</span><strong>${workdays}</strong></div><div><span class="label">Clients</span><strong>${clients}</strong></div></section>
      <div class="section-title">Daily Accomplishment Summary</div>${daySections}
      <div class="section-title">Detailed Work Record</div><table><thead><tr><th>#</th><th>Date</th><th>Task</th><th>Client / Project</th><th>Time</th><th>Break</th><th>Recorded</th></tr></thead><tbody>${taskRows}<tr><td colspan="5"><strong>TOTAL</strong></td><td class="mono"><strong>${fmtDuration(breaks)}</strong></td><td class="mono"><strong>${fmtDuration(total)}</strong></td></tr></tbody></table>
      ${includeEvidence ? `<div class="section-title">Work Evidence</div>${proofs}` : ''}
      <footer class="footer">Generated through JM WorkLog · Personal Work Record</footer>
    </main></body></html>`);
    win.document.close();
  }

  function printChecklist(entry) {
    const checks = checklistFor(entry.id);
    if (!checks.length) return '';
    return `<div class="checklist">${checks.map(item => `<span>${item.completed ? '☑' : '☐'} ${esc(item.item_text)}</span>`).join('')}</div>`;
  }

  function printProofBlock(entry, index) {
    const clientProject = [entry.client_label, entry.project_label].filter(Boolean).join(' · ');
    return `<section class="proof-block"><div class="proof-head"><div><small>TASK ${String(index + 1).padStart(2, '0')}</small><h2>${esc(entry.title)}</h2><p>${esc(clientProject)}</p></div><div class="proof-time"><strong>${fmtDate(entry.started_at)}</strong><span>${fmtTime(entry.started_at)} – ${fmtTime(entry.ended_at)}</span><span>${fmtDuration(workMs(entry))} recorded</span></div></div><div class="proof-grid">${proofFigure('BEFORE', fmtTime(entry.started_at), entry.before_url)}${(entry.during_evidence || []).map((proof, proofIndex) => proofFigure(`DURING ${proofIndex + 1}`, fmtTime(proof.captured_at), proof.url, proof.caption || '')).join('')}${proofFigure('AFTER', fmtTime(entry.ended_at), entry.after_url)}</div></section>`;
  }

  function proofFigure(label, time, url, caption = '') {
    return `<figure class="proof-card"><figcaption><strong>${esc(label)}</strong><span>${esc(time)}</span></figcaption><div class="proof-image">${url ? `<img src="${esc(url)}" alt="${esc(label)} work evidence">` : '<div class="proof-empty">No image recorded</div>'}</div>${caption ? `<div class="proof-caption">${esc(caption)}</div>` : ''}</figure>`;
  }
})();
