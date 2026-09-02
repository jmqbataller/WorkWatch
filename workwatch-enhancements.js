(() => {
  const params = new URLSearchParams(location.search);
  const publicRoute = params.get('share') || params.get('verify');

  // Public report links must always stay on the public renderer. This prevents
  // auth/session refreshes from replacing a shared report with the private UI.
  if (publicRoute) {
    const publicAuthView = authView;
    const renderPublicRoute = () => publicAuthView();
    authView = renderPublicRoute;
    renderShell = renderPublicRoute;
    loadWorkspace = async function () { return renderPublicRoute(); };
    queueMicrotask(renderPublicRoute);
    return;
  }

  const OWNER = 'system_admin';
  const DRAFT_KEY = 'ww_task_draft_v2';
  const DRAFT_PENDING_KEY = 'ww_task_draft_pending_start';
  const DRAFT_FIELDS = ['taskTitle', 'taskNotes', 'clientPresetSelect', 'clientLabel', 'projectLabel', 'taskChecklist'];
  let beforeFileMemory = null;

  const baseNavFor = navFor;
  const baseTitleFor = titleFor;
  const baseRenderPage = renderPage;

  const pro = () => window.WorkWatchPro || {};
  const own = () => pro().own?.() || (state.entries || []).filter(e => e.employee_id === state.profile?.id && !e.deleted_at).sort((a,b) => new Date(b.started_at) - new Date(a.started_at));
  const dateKey = value => pro().dateKey?.(value) || (() => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  const workMs = entry => pro().workMs?.(entry) ?? Math.max(0, (entry.ended_at ? new Date(entry.ended_at) : new Date()) - new Date(entry.started_at) - Number(entry.break_seconds || 0) * 1000);
  const breakMs = entry => pro().breakMs?.(entry) ?? Number(entry.break_seconds || 0) * 1000;
  const checklistFor = id => pro().checklistFor?.(id) || [];
  const slug = value => String(value || 'WorkWatch').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'WorkWatch';

  navFor = function (role) {
    const nav = baseNavFor(role);
    if (role !== OWNER || nav.some(([view]) => view === 'custom-export')) return nav;
    const next = [...nav];
    const reportsIndex = next.findIndex(([view]) => view === 'reports');
    next.splice(reportsIndex >= 0 ? reportsIndex + 1 : 2, 0, ['custom-export', 'Custom Export', 'report']);
    return next;
  };

  titleFor = function (role, view) {
    if (role === OWNER && view === 'custom-export') return 'Custom Export';
    return baseTitleFor(role, view);
  };

  renderPage = function (role) {
    if (role === OWNER && state.view === 'custom-export') return renderCustomExport();
    const result = baseRenderPage(role);
    if (role === OWNER && state.view === 'dashboard') queueMicrotask(bindDraftPersistence);
    return result;
  };

  function readDraft() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeDraft() {
    const form = document.getElementById('personalStartForm');
    if (!form) return;
    const draft = { updated_at: new Date().toISOString() };
    let hasValue = false;
    DRAFT_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      draft[id] = el.value || '';
      if (draft[id].trim()) hasValue = true;
    });
    if (beforeFileMemory?.name) {
      draft.beforeFileName = beforeFileMemory.name;
      hasValue = true;
    }
    if (hasValue) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  }

  function restoreDraft() {
    const form = document.getElementById('personalStartForm');
    if (!form) return;
    const draft = readDraft();
    DRAFT_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.value || !draft[id]) return;
      el.value = draft[id];
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const fileInput = document.getElementById('beforeFile');
    if (fileInput && beforeFileMemory && !fileInput.files?.length) {
      try {
        const transfer = new DataTransfer();
        transfer.items.add(beforeFileMemory);
        fileInput.files = transfer.files;
      } catch {}
    }

    if (draft.beforeFileName && !beforeFileMemory && fileInput && !fileInput.files?.length && !form.querySelector('[data-draft-file-note]')) {
      fileInput.insertAdjacentHTML('afterend', `<div class="ww-draft-file-note" data-draft-file-note>Previous screenshot: <strong>${esc(draft.beforeFileName)}</strong>. Re-select it only if the page was fully reloaded.</div>`);
    }
  }

  function clearDraftAfterConfirmedStart() {
    if (!sessionStorage.getItem(DRAFT_PENDING_KEY)) return;
    const startForm = document.getElementById('personalStartForm');
    const activeUi = document.getElementById('personalFinishForm') || document.querySelector('.tracker-card.active,.tracker-card.paused');
    if (!startForm && activeUi) {
      sessionStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_PENDING_KEY);
      beforeFileMemory = null;
    }
  }

  function bindDraftPersistence() {
    if (state.profile?.role !== OWNER || state.view !== 'dashboard') return;
    const form = document.getElementById('personalStartForm');
    if (!form) {
      clearDraftAfterConfirmedStart();
      return;
    }
    if (form.dataset.draftPersistence === '1') {
      restoreDraft();
      return;
    }
    form.dataset.draftPersistence = '1';
    restoreDraft();

    DRAFT_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', writeDraft);
      el.addEventListener('change', writeDraft);
    });

    const before = document.getElementById('beforeFile');
    before?.addEventListener('change', () => {
      beforeFileMemory = before.files?.[0] || null;
      form.querySelector('[data-draft-file-note]')?.remove();
      writeDraft();
    });

    form.addEventListener('submit', () => {
      writeDraft();
      sessionStorage.setItem(DRAFT_PENDING_KEY, '1');
    }, true);

    if (!form.querySelector('[data-draft-status]')) {
      const actions = form.querySelector('.task-actions');
      actions?.insertAdjacentHTML('beforebegin', '<div class="ww-draft-status" data-draft-status>Draft fields are saved automatically while you switch tabs or the dashboard refreshes.</div>');
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) writeDraft();
    else queueMicrotask(bindDraftPersistence);
  });
  window.addEventListener('beforeunload', writeDraft);

  const observer = new MutationObserver(() => {
    clearDraftAfterConfirmedStart();
    bindDraftPersistence();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(bindDraftPersistence);

  function renderCustomExport() {
    const entries = own().filter(e => e.status === 'completed');
    const clients = [...new Set(entries.map(e => e.client_label).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    const projects = [...new Set(entries.map(e => e.project_label).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    const selected = new Set();
    let visible = entries;

    page().innerHTML = head('Custom Export', 'Export one task, one full day, or any combination of completed tasks.') + `
      <section class="panel ww-export-controls">
        <div class="panel-head"><div><div class="panel-title">Choose records</div><div class="panel-desc">Check a single task, select a day, or combine any tasks you want in one export.</div></div></div>
        <div class="panel-body">
          <div class="ww-export-filter-grid">
            <div class="field"><label>Search tasks</label><input class="input" id="wwExportSearch" placeholder="Task, notes, client, project"></div>
            <div class="field"><label>Client</label><select class="select" id="wwExportClient"><option value="">All clients</option>${clients.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
            <div class="field"><label>Project</label><select class="select" id="wwExportProject"><option value="">All projects</option>${projects.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
            <div class="field"><label>Specific day</label><div class="ww-export-day"><input class="input" id="wwExportDay" type="date"><button class="btn" id="wwSelectDay" type="button">Select day</button></div></div>
          </div>
          <div class="ww-export-toolbar">
            <button class="btn" id="wwSelectVisible" type="button">Select visible</button>
            <button class="btn" id="wwClearSelection" type="button">Clear selection</button>
            <span id="wwSelectionSummary">0 tasks selected</span>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><div class="panel-title">Completed tasks</div><div class="panel-desc" id="wwVisibleSummary">${entries.length} records available</div></div><div class="page-actions"><button class="btn" id="wwExportCsv" disabled>Export CSV</button><button class="btn btn-primary" id="wwExportPdf" disabled>Export PDF</button></div></div>
        <div class="panel-body" style="padding:0"><div class="table-wrap"><table class="table ww-export-table"><thead><tr><th class="ww-export-check"></th><th>Task</th><th>Date</th><th>Client / Project</th><th>Recorded</th><th>Evidence</th></tr></thead><tbody id="wwExportBody"></tbody></table></div></div>
      </section>`;

    const filtered = () => {
      const q = (document.getElementById('wwExportSearch')?.value || '').trim().toLowerCase();
      const client = document.getElementById('wwExportClient')?.value || '';
      const project = document.getElementById('wwExportProject')?.value || '';
      return entries.filter(e => {
        const hay = [e.title, e.notes, e.client_label, e.project_label].join(' ').toLowerCase();
        return (!q || hay.includes(q)) && (!client || e.client_label === client) && (!project || e.project_label === project);
      });
    };

    const updateSelectionSummary = () => {
      const chosen = entries.filter(e => selected.has(e.id));
      const ms = chosen.reduce((sum,e) => sum + workMs(e), 0);
      const summary = document.getElementById('wwSelectionSummary');
      if (summary) summary.textContent = `${chosen.length} task${chosen.length === 1 ? '' : 's'} selected · ${fmtDuration(ms)}`;
      const csv = document.getElementById('wwExportCsv');
      const pdf = document.getElementById('wwExportPdf');
      if (csv) csv.disabled = !chosen.length;
      if (pdf) pdf.disabled = !chosen.length;
    };

    const renderRows = () => {
      visible = filtered();
      const body = document.getElementById('wwExportBody');
      const summary = document.getElementById('wwVisibleSummary');
      if (summary) summary.textContent = `${visible.length} matching record${visible.length === 1 ? '' : 's'}`;
      if (!body) return;
      body.innerHTML = visible.length ? visible.map(e => {
        const evidenceCount = (e.before_url ? 1 : 0) + (e.during_evidence?.length || 0) + (e.after_url ? 1 : 0);
        return `<tr><td class="ww-export-check"><input type="checkbox" data-ww-export-id="${e.id}" ${selected.has(e.id) ? 'checked' : ''}></td><td><div class="td-main">${esc(e.title)}</div><div class="td-sub">${esc(e.notes || '')}</div></td><td>${fmtDate(e.started_at)}</td><td>${esc([e.client_label,e.project_label].filter(Boolean).join(' · ') || '—')}</td><td class="mono">${fmtDuration(workMs(e))}</td><td>${evidenceCount ? `${evidenceCount} image${evidenceCount === 1 ? '' : 's'}` : 'No proof'}</td></tr>`;
      }).join('') : '<tr><td colspan="6"><div class="empty"><strong>No matching completed tasks</strong><span>Change the filters or choose another day.</span></div></td></tr>';
      document.querySelectorAll('[data-ww-export-id]').forEach(box => box.addEventListener('change', () => {
        if (box.checked) selected.add(box.dataset.wwExportId);
        else selected.delete(box.dataset.wwExportId);
        updateSelectionSummary();
      }));
      updateSelectionSummary();
    };

    ['wwExportSearch','wwExportClient','wwExportProject'].forEach(id => document.getElementById(id)?.addEventListener(id === 'wwExportSearch' ? 'input' : 'change', renderRows));
    document.getElementById('wwSelectVisible')?.addEventListener('click', () => { visible.forEach(e => selected.add(e.id)); renderRows(); });
    document.getElementById('wwClearSelection')?.addEventListener('click', () => { selected.clear(); renderRows(); });
    document.getElementById('wwSelectDay')?.addEventListener('click', () => {
      const day = document.getElementById('wwExportDay')?.value;
      if (!day) return toast('Choose a day first.', 'error');
      const dayEntries = entries.filter(e => dateKey(e.started_at) === day);
      if (!dayEntries.length) return toast('No completed tasks were recorded on that day.', 'error');
      dayEntries.forEach(e => selected.add(e.id));
      renderRows();
      toast(`${dayEntries.length} task${dayEntries.length === 1 ? '' : 's'} selected for ${day}.`);
    });
    document.getElementById('wwExportCsv')?.addEventListener('click', () => exportSelectedCsv(entries.filter(e => selected.has(e.id))));
    document.getElementById('wwExportPdf')?.addEventListener('click', () => exportSelectedPdf(entries.filter(e => selected.has(e.id))));
    renderRows();
  }

  function downloadFile(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportSelectedCsv(entries) {
    if (!entries.length) return;
    const rows = [['Task','Notes','Client','Project','Date','Start','End','Break','Recorded','Before','During','After'], ...entries.map(e => [
      e.title, e.notes || '', e.client_label || '', e.project_label || '', fmtDate(e.started_at), fmtTime(e.started_at), fmtTime(e.ended_at),
      fmtDuration(breakMs(e)), fmtDuration(workMs(e)), e.before_url ? 'Yes' : 'No', e.during_evidence?.length || 0, e.after_url ? 'Yes' : 'No'
    ])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadFile(`${slug(state.profile?.full_name)}_WorkWatch_Selected_${dateKey(new Date())}.csv`, csv, 'text/csv');
  }

  function proofFigure(label, time, url, caption = '') {
    return `<figure><figcaption><strong>${esc(label)}</strong><span>${esc(time || '—')}</span></figcaption>${url ? `<div class="proof-img"><img src="${esc(url)}"></div>` : '<div class="proof-empty">No image</div>'}${caption ? `<p>${esc(caption)}</p>` : ''}</figure>`;
  }

  function exportSelectedPdf(entries) {
    if (!entries.length) return;
    const sorted = [...entries].sort((a,b) => new Date(a.started_at) - new Date(b.started_at));
    const total = sorted.reduce((sum,e) => sum + workMs(e), 0);
    const totalBreak = sorted.reduce((sum,e) => sum + breakMs(e), 0);
    const dates = [...new Set(sorted.map(e => dateKey(e.started_at)))];
    const filename = `${slug(state.profile?.full_name)}_WorkWatch_Custom_Export_${dates[0]}${dates.length > 1 ? `_to_${dates[dates.length-1]}` : ''}`;
    const taskRows = sorted.map((e,index) => `<tr><td>${index+1}</td><td>${fmtDate(e.started_at)}</td><td><strong>${esc(e.title)}</strong>${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ''}</td><td>${esc([e.client_label,e.project_label].filter(Boolean).join(' · ') || '—')}</td><td>${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}</td><td>${fmtDuration(breakMs(e))}</td><td>${fmtDuration(workMs(e))}</td></tr>`).join('');
    const proofs = sorted.map((e,index) => {
      const checks = checklistFor(e.id);
      return `<section class="proof-block"><div class="proof-head"><div><small>TASK ${String(index+1).padStart(2,'0')}</small><h2>${esc(e.title)}</h2><p>${esc([e.client_label,e.project_label].filter(Boolean).join(' · '))}</p>${checks.length ? `<div class="checklist">${checks.map(x => `<span>${x.completed ? '☑' : '☐'} ${esc(x.item_text)}</span>`).join('')}</div>` : ''}</div><div class="proof-time"><strong>${fmtDate(e.started_at)}</strong><span>${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}</span><span>${fmtDuration(workMs(e))} recorded</span></div></div><div class="proof-grid">${proofFigure('BEFORE', fmtTime(e.started_at), e.before_url)}${(e.during_evidence || []).map((d,i) => proofFigure(`DURING ${i+1}`, fmtTime(d.captured_at), d.url, d.caption || '')).join('')}${proofFigure('AFTER', fmtTime(e.ended_at), e.after_url)}</div></section>`;
    }).join('');

    const w = open('', '_blank');
    if (!w) return toast('Allow pop-ups to open the custom export.', 'error');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(filename)}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#111;font-family:Arial,sans-serif;font-size:10px;line-height:1.45}@page{size:A4 portrait;margin:10mm}.toolbar{position:sticky;top:0;z-index:10;padding:10px;text-align:center;background:#111}.toolbar button{padding:9px 14px;border:0;border-radius:6px;font-weight:700}.sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:11mm 12mm}.header{display:flex;justify-content:space-between;gap:20px;padding-bottom:10px;border-bottom:2px solid #111}.brand{font-weight:900;letter-spacing:.16em}.header h1{font-size:20px;margin:4px 0}.meta{text-align:right}.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #aaa;border-top:0}.summary div{padding:8px;border-right:1px solid #aaa}.summary div:last-child{border-right:0}.summary span{display:block;font-size:7px;text-transform:uppercase}.summary strong{font-size:14px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #bbb;padding:6px;vertical-align:top}th{background:#f2f2f2;font-size:7px;text-transform:uppercase}.note{margin-top:3px;color:#555}.proof-block{margin-top:14px;border:1px solid #aaa;break-inside:avoid}.proof-head{display:flex;justify-content:space-between;gap:12px;padding:8px;border-bottom:1px solid #aaa;background:#fafafa}.proof-head h2{font-size:12px;margin:2px 0}.proof-head p{margin:0;color:#555}.proof-time{text-align:right}.proof-time span,.proof-time strong{display:block}.checklist{display:grid;gap:2px;margin-top:5px}.proof-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px}.proof-grid figure{margin:0;border:1px solid #bbb}.proof-grid figcaption{display:flex;justify-content:space-between;padding:5px;background:#f7f7f7}.proof-img{height:48mm;display:flex;align-items:center;justify-content:center;overflow:hidden}.proof-img img{width:100%;height:100%;object-fit:contain}.proof-empty{height:48mm;display:flex;align-items:center;justify-content:center;color:#777}.proof-grid figure p{margin:0;padding:5px;border-top:1px solid #ddd}.footer{margin-top:18px;padding-top:8px;border-top:1px solid #aaa;color:#555;text-align:center}@media print{body{background:#fff}.toolbar{display:none}.sheet{margin:0;box-shadow:none}}
    </style></head><body><div class="toolbar"><button onclick="print()">Print / Save PDF</button></div><main class="sheet"><header class="header"><div><div class="brand">WORKWATCH</div><h1>Custom Work Record Export</h1><div>${esc(state.profile?.full_name || '')}</div></div><div class="meta"><strong>${dates.length === 1 ? esc(dates[0]) : `${esc(dates[0])} – ${esc(dates[dates.length-1])}`}</strong><div>Generated ${new Date().toLocaleString()}</div></div></header><section class="summary"><div><span>Selected tasks</span><strong>${sorted.length}</strong></div><div><span>Recorded time</span><strong>${fmtDuration(total)}</strong></div><div><span>Break excluded</span><strong>${fmtDuration(totalBreak)}</strong></div><div><span>Work days</span><strong>${dates.length}</strong></div></section><table><thead><tr><th>#</th><th>Date</th><th>Task</th><th>Client / Project</th><th>Time</th><th>Break</th><th>Recorded</th></tr></thead><tbody>${taskRows}</tbody></table>${proofs}<footer class="footer">Generated through WorkWatch • Developed by John Mark</footer></main></body></html>`);
    w.document.close();
  }

  if (!document.getElementById('wwEnhancementStyles')) {
    const style = document.createElement('style');
    style.id = 'wwEnhancementStyles';
    style.textContent = `
      .ww-draft-status{margin:12px 0 4px;color:#667085;font-size:12px;line-height:1.45}
      .ww-draft-file-note{margin-top:8px;color:#667085;font-size:12px}
      .ww-export-filter-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1.35fr;gap:12px;align-items:end}
      .ww-export-day{display:flex;gap:8px}.ww-export-day .input{min-width:0}
      .ww-export-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid #e4e7ec}
      .ww-export-toolbar span{margin-left:auto;font-weight:700;color:#344054}
      .ww-export-check{width:42px;text-align:center}.ww-export-check input{width:16px;height:16px}
      @media(max-width:900px){.ww-export-filter-grid{grid-template-columns:1fr 1fr}.ww-export-toolbar span{width:100%;margin-left:0}.ww-export-day{flex-wrap:wrap}}
      @media(max-width:620px){.ww-export-filter-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }
})();
