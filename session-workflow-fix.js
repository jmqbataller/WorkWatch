(() => {
  const OWNER = 'system_admin';
  const feature = window.WorkWatchSessionMode || { sessions: [] };
  const suite = window.WorkWatchSuite || { reports: [] };
  const EXPORT_MODE_KEY = 'ww_custom_export_mode_v2';
  const baseRenderPage = renderPage;
  const baseLoadWorkspace = loadWorkspace;
  let workspaceFlight = null;

  const uid = () => state.profile?.id || state.user?.id || '';
  const isOpen = status => status === 'active' || status === 'paused';
  const ownEntries = () => (state.entries || []).filter(e => e.employee_id === uid() && !e.deleted_at);
  const completedSessions = () => (feature.sessions || [])
    .filter(s => s.user_id === uid() && s.status === 'completed')
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const sessionTasks = id => ownEntries()
    .filter(e => e.work_session_id === id)
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  const breakMs = record => Math.max(0, Number(record?.break_seconds || 0)) * 1000;
  const elapsedMs = record => {
    if (!record?.started_at) return 0;
    const end = record.ended_at ? new Date(record.ended_at).getTime() : Date.now();
    return Math.max(0, end - new Date(record.started_at).getTime() - breakMs(record));
  };
  const dateKey = value => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const reportForSession = id => (suite.reports || [])
    .filter(r => r.work_session_id === id || r.snapshot?.session?.id === id)
    .sort((a, b) => Number(b.version_no || 1) - Number(a.version_no || 1))[0] || null;
  const evidenceCount = task => (task.before_url || task.before_path ? 1 : 0) + (task.during_evidence?.length || 0) + (task.after_url || task.after_path ? 1 : 0);

  loadWorkspace = function(...args) {
    if (workspaceFlight) return workspaceFlight;
    workspaceFlight = Promise.resolve()
      .then(() => baseLoadWorkspace(...args))
      .finally(() => { workspaceFlight = null; });
    return workspaceFlight;
  };

  async function refreshAfterSessionControl(message) {
    await loadWorkspace();
    if (state.profile?.role === OWNER) renderShell();
    if (message) toast(message);
  }

  async function pauseWholeSession(session, button) {
    if (!session || session.status !== 'active') return;
    if (button) { button.disabled = true; button.textContent = 'Pausing…'; }
    try {
      const { error } = await sb.rpc('pause_work_session_with_tasks', { p_work_session_id: session.id });
      if (error) throw error;
      await refreshAfterSessionControl('Work session and active task timers paused.');
    } catch (error) {
      toast(error.message || 'Could not pause the work session.', 'error');
      if (button && document.body.contains(button)) { button.disabled = false; button.textContent = 'Pause / Break'; }
    }
  }

  async function resumeWholeSession(session, button) {
    if (!session || session.status !== 'paused') return;
    if (button) { button.disabled = true; button.textContent = 'Resuming…'; }
    try {
      const { error } = await sb.rpc('resume_work_session_with_tasks', { p_work_session_id: session.id });
      if (error) throw error;
      await refreshAfterSessionControl('Work session and previously active task timers resumed.');
    } catch (error) {
      toast(error.message || 'Could not resume the work session.', 'error');
      if (button && document.body.contains(button)) { button.disabled = false; button.textContent = 'Resume Work'; }
    }
  }

  document.addEventListener('click', event => {
    const pause = event.target?.closest?.('#wwPauseWork');
    const resume = event.target?.closest?.('#wwResumeWork');
    const taskResume = event.target?.closest?.('[data-resume-task]');
    const active = (feature.sessions || []).find(s => s.user_id === uid() && isOpen(s.status));

    if (taskResume && active?.status === 'paused') {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Resume the Work Session first. Tasks paused by the session will resume automatically.', 'error');
      return;
    }
    if (pause) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pauseWholeSession(active, pause);
      return;
    }
    if (resume) {
      event.preventDefault();
      event.stopImmediatePropagation();
      resumeWholeSession(active, resume);
    }
  }, true);

  function switchButton(mode) {
    return `<button class="btn" type="button" data-export-mode="${mode}">${mode === 'tasks' ? 'Individual Tasks' : 'Work Sessions'}</button>`;
  }

  function addSessionSwitchToLegacyTaskExport() {
    if (state.profile?.role !== OWNER || state.view !== 'custom-export') return;
    const actions = page()?.querySelector('.pagehead .page-actions');
    if (!actions || actions.querySelector('[data-export-mode="sessions"]')) return;
    actions.insertAdjacentHTML('afterbegin', switchButton('sessions'));
    actions.querySelector('[data-export-mode="sessions"]')?.addEventListener('click', () => {
      sessionStorage.setItem(EXPORT_MODE_KEY, 'sessions');
      renderShell();
    });
  }

  function renderSessionCustomExport() {
    const all = completedSessions();
    const selected = new Set();
    let visible = [...all];

    page().innerHTML = head(
      'Custom Export',
      'Export one completed Work Session or combine multiple sessions in one file.',
      switchButton('tasks')
    ) + `
      <section class="panel">
        <div class="panel-head"><div><div class="panel-title">Choose work sessions</div><div class="panel-desc">Actual work totals come from session timers. Overlapping task timers are not double-counted.</div></div></div>
        <div class="panel-body">
          <div class="ww-export-filter-grid">
            <div class="field"><label>Search</label><input class="input" id="wsxSearch" placeholder="Task, client, project"></div>
            <div class="field"><label>From</label><input class="input" id="wsxFrom" type="date"></div>
            <div class="field"><label>To</label><input class="input" id="wsxTo" type="date"></div>
          </div>
          <div class="ww-export-toolbar">
            <button class="btn" id="wsxSelectVisible" type="button">Select visible</button>
            <button class="btn" id="wsxClear" type="button">Clear selection</button>
            <span id="wsxSummary">0 sessions selected</span>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><div class="panel-title">Completed work sessions</div><div class="panel-desc" id="wsxVisibleSummary">${all.length} sessions available</div></div><div class="page-actions"><button class="btn" id="wsxCsv" disabled>Export CSV</button><button class="btn btn-primary" id="wsxPdf" disabled>Export PDF</button></div></div>
        <div class="panel-body" style="padding:0"><div class="table-wrap"><table class="table"><thead><tr><th></th><th>Session</th><th>Actual work</th><th>Tasks</th><th>Evidence</th><th>Status</th></tr></thead><tbody id="wsxBody"></tbody></table></div></div>
      </section>`;

    const filtered = () => {
      const q = (document.getElementById('wsxSearch')?.value || '').trim().toLowerCase();
      const from = document.getElementById('wsxFrom')?.value || '';
      const to = document.getElementById('wsxTo')?.value || '';
      return all.filter(session => {
        const day = dateKey(session.started_at);
        const tasks = sessionTasks(session.id);
        const hay = tasks.map(t => [t.title, t.notes, t.client_label, t.project_label].join(' ')).join(' ').toLowerCase();
        return (!q || hay.includes(q)) && (!from || day >= from) && (!to || day <= to);
      });
    };

    const updateSummary = () => {
      const chosen = all.filter(s => selected.has(s.id));
      const total = chosen.reduce((sum, s) => sum + elapsedMs(s), 0);
      const el = document.getElementById('wsxSummary');
      if (el) el.textContent = `${chosen.length} session${chosen.length === 1 ? '' : 's'} selected · ${fmtDuration(total)} actual work`;
      const csv = document.getElementById('wsxCsv');
      const pdf = document.getElementById('wsxPdf');
      if (csv) csv.disabled = !chosen.length;
      if (pdf) pdf.disabled = !chosen.length;
    };

    const renderRows = () => {
      visible = filtered();
      const body = document.getElementById('wsxBody');
      const vis = document.getElementById('wsxVisibleSummary');
      if (vis) vis.textContent = `${visible.length} matching session${visible.length === 1 ? '' : 's'}`;
      if (!body) return;
      body.innerHTML = visible.length ? visible.map(session => {
        const tasks = sessionTasks(session.id);
        const proofs = tasks.reduce((n, t) => n + evidenceCount(t), 0);
        const report = reportForSession(session.id);
        return `<tr><td><input type="checkbox" data-wsx-id="${session.id}" ${selected.has(session.id) ? 'checked' : ''}></td><td><div class="td-main">${fmtDate(session.started_at)}</div><div class="td-sub">${fmtTime(session.started_at)} – ${fmtTime(session.ended_at)}</div></td><td class="mono">${fmtDuration(elapsedMs(session))}</td><td>${tasks.length}</td><td>${proofs} image${proofs === 1 ? '' : 's'}</td><td>${report ? `<span class="suite-locked">${esc(report.report_code || 'Finalized')}</span>` : 'Completed'}</td></tr>`;
      }).join('') : '<tr><td colspan="6"><div class="empty"><strong>No matching work sessions</strong><span>Change the filters or finish a Work Session first.</span></div></td></tr>';
      body.querySelectorAll('[data-wsx-id]').forEach(box => box.addEventListener('change', () => {
        if (box.checked) selected.add(box.dataset.wsxId);
        else selected.delete(box.dataset.wsxId);
        updateSummary();
      }));
      updateSummary();
    };

    document.querySelector('[data-export-mode="tasks"]')?.addEventListener('click', () => {
      sessionStorage.setItem(EXPORT_MODE_KEY, 'tasks');
      renderShell();
    });
    ['wsxSearch', 'wsxFrom', 'wsxTo'].forEach(id => document.getElementById(id)?.addEventListener(id === 'wsxSearch' ? 'input' : 'change', renderRows));
    document.getElementById('wsxSelectVisible')?.addEventListener('click', () => { visible.forEach(s => selected.add(s.id)); renderRows(); });
    document.getElementById('wsxClear')?.addEventListener('click', () => { selected.clear(); renderRows(); });
    document.getElementById('wsxCsv')?.addEventListener('click', () => exportSessionsCsv(all.filter(s => selected.has(s.id))));
    document.getElementById('wsxPdf')?.addEventListener('click', () => exportSessionsPdf(all.filter(s => selected.has(s.id))));
    renderRows();
  }

  function exportSessionsCsv(sessions) {
    if (!sessions.length) return;
    const rows = [['Session Date','Session Start','Session End','Actual Work','Session Break','Task','Client','Project','Task Start','Task End','Task Time','Evidence Count']];
    sessions.slice().sort((a,b) => new Date(a.started_at)-new Date(b.started_at)).forEach(session => {
      const tasks = sessionTasks(session.id);
      if (!tasks.length) rows.push([fmtDate(session.started_at),fmtTime(session.started_at),fmtTime(session.ended_at),fmtDuration(elapsedMs(session)),fmtDuration(breakMs(session)),'','','','','','','0']);
      tasks.forEach(task => rows.push([
        fmtDate(session.started_at), fmtTime(session.started_at), fmtTime(session.ended_at), fmtDuration(elapsedMs(session)), fmtDuration(breakMs(session)),
        task.title, task.client_label || '', task.project_label || '', fmtTime(task.started_at), fmtTime(task.ended_at), fmtDuration(elapsedMs(task)), evidenceCount(task)
      ]));
    });
    const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    download(`JM-WorkLog-sessions-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
  }

  function proofCard(label, time, url, caption = '') {
    return `<figure class="sx-proof"><figcaption><strong>${esc(label)}</strong><span>${esc(time || '—')}</span></figcaption>${url ? `<img src="${esc(url)}">` : '<div class="sx-empty">No image</div>'}${caption ? `<p>${esc(caption)}</p>` : ''}</figure>`;
  }

  function exportSessionsPdf(sessions) {
    if (!sessions.length) return;
    const ordered = sessions.slice().sort((a,b) => new Date(a.started_at)-new Date(b.started_at));
    const total = ordered.reduce((sum,s) => sum + elapsedMs(s), 0);
    const totalTasks = ordered.reduce((sum,s) => sum + sessionTasks(s.id).length, 0);
    const sessionSections = ordered.map((session, si) => {
      const tasks = sessionTasks(session.id);
      const report = reportForSession(session.id);
      const taskRows = tasks.map((task, ti) => `<tr><td>${ti+1}</td><td><strong>${esc(task.title)}</strong><small>${esc([task.client_label,task.project_label].filter(Boolean).join(' · ') || task.notes || '')}</small></td><td>${fmtTime(task.started_at)}</td><td>${fmtTime(task.ended_at)}</td><td class="mono">${fmtDuration(elapsedMs(task))}</td><td>${evidenceCount(task)}</td></tr>`).join('');
      const evidence = tasks.map((task, ti) => `<section class="sx-task"><div class="sx-task-head"><div><small>SESSION ${si+1} · TASK ${ti+1}</small><h2>${esc(task.title)}</h2><p>${esc([task.client_label,task.project_label].filter(Boolean).join(' · ') || task.notes || '')}</p></div><strong>${fmtDuration(elapsedMs(task))}</strong></div><div class="sx-proofs">${proofCard('BEFORE',fmtTime(task.started_at),task.before_url)}${(task.during_evidence||[]).map((d,j)=>proofCard(`DURING ${j+1}`,fmtTime(d.captured_at),d.url,d.caption||'')).join('')}${proofCard('AFTER',fmtTime(task.ended_at),task.after_url)}</div></section>`).join('');
      return `<section class="sx-session"><div class="sx-session-head"><div><small>WORK SESSION ${si+1}</small><h2>${fmtDate(session.started_at)}</h2><p>${fmtTime(session.started_at)} – ${fmtTime(session.ended_at)}${report ? ` · ${esc(report.report_code)}` : ''}</p></div><strong>${fmtDuration(elapsedMs(session))}</strong></div><div class="sx-stats"><span><b>${fmtDuration(elapsedMs(session))}</b>Actual work</span><span><b>${fmtDuration(breakMs(session))}</b>Break</span><span><b>${tasks.length}</b>Tasks</span><span><b>${tasks.reduce((n,t)=>n+evidenceCount(t),0)}</b>Evidence</span></div><table><thead><tr><th>#</th><th>Task</th><th>Start</th><th>End</th><th>Task time</th><th>Proof</th></tr></thead><tbody>${taskRows}</tbody></table></section>${evidence}`;
    }).join('');

    const win = open('', '_blank');
    if (!win) return toast('Allow pop-ups to export the selected sessions.', 'error');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>JM WorkLog Session Export</title><style>*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#101828;font:10px Arial}.toolbar{position:sticky;top:0;z-index:9;background:#101828;padding:10px;text-align:center}.toolbar button{border:0;border-radius:6px;padding:9px 14px;font-weight:800}.cover,.sx-session,.sx-task{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:12mm}.cover h1{font-size:26px}.summary{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #d0d5dd}.summary div,.sx-stats span{padding:10px;border-right:1px solid #d0d5dd}.summary span,.summary b,.sx-stats b{display:block}.summary span{color:#667085;text-transform:uppercase;font-size:8px}.summary b{font-size:18px}.sx-session,.sx-task{page-break-before:always}.sx-session-head,.sx-task-head{display:flex;justify-content:space-between;border-bottom:2px solid #101828}.sx-session-head h2,.sx-task-head h2{margin:3px 0}.sx-session-head strong,.sx-task-head>strong{font-size:18px}.sx-stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #d0d5dd;margin:12px 0}.sx-stats span{font-size:8px;text-transform:uppercase}.sx-stats b{font-size:14px;text-transform:none}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d9dde4;padding:6px;vertical-align:top}th{background:#f2f4f7;font-size:7px}td small{display:block;color:#667085}.mono{font-family:Consolas,monospace}.sx-proofs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.sx-proof{margin:0;border:1px solid #d0d5dd}.sx-proof figcaption{display:flex;justify-content:space-between;padding:7px;background:#f8fafc}.sx-proof img,.sx-empty{width:100%;height:220px;object-fit:contain}.sx-empty{display:grid;place-items:center;color:#98a2b3}.sx-proof p{margin:0;padding:6px;border-top:1px solid #eee}@media print{.toolbar{display:none}.cover,.sx-session,.sx-task{margin:0}}</style></head><body><div class="toolbar"><button onclick="print()">Save as PDF / Print</button></div><section class="cover"><p>JM WORKLOG</p><h1>Custom Work Session Export</h1><p>${ordered.length} selected session${ordered.length===1?'':'s'}</p><div class="summary"><div><span>Actual work</span><b>${fmtDuration(total)}</b></div><div><span>Sessions</span><b>${ordered.length}</b></div><div><span>Tasks</span><b>${totalTasks}</b></div></div><p style="margin-top:14px;color:#667085">Actual work is calculated from Work Session timers. Overlapping task time is not double-counted.</p></section>${sessionSections}</body></html>`);
    win.document.close();
  }

  renderPage = function(role) {
    if (role === OWNER && state.view === 'custom-export') {
      const mode = sessionStorage.getItem(EXPORT_MODE_KEY) || 'sessions';
      if (mode === 'tasks') {
        const result = baseRenderPage(role);
        queueMicrotask(addSessionSwitchToLegacyTaskExport);
        return result;
      }
      return renderSessionCustomExport();
    }
    return baseRenderPage(role);
  };

  window.WorkWatchSessionWorkflowFix = {
    getWorkspaceState: () => workspaceFlight ? 'loading' : 'idle',
    exportSessionsPdf,
    exportSessionsCsv
  };
})();