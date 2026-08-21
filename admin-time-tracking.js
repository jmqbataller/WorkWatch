(() => {
  const originalNavFor = navFor;
  const originalTitleFor = titleFor;
  const originalRenderPage = renderPage;
  const originalStartTask = startTask;

  const orgNameFor = id => state.orgs.find(o => o.id === id)?.name || 'Organization';

  navFor = function (role) {
    if (role !== 'system_admin') return originalNavFor(role);
    return [
      ['dashboard', 'System Overview', 'dashboard'],
      ['mywork', 'My Workday', 'clock'],
      ['myhistory', 'My Work History', 'report'],
      ['organizations', 'Organizations', 'building'],
      ['users', 'Users & Roles', 'users'],
      ['reports', 'Reports', 'report']
    ];
  };

  titleFor = function (role, view) {
    if (role === 'system_admin') {
      if (view === 'mywork') return 'My Workday';
      if (view === 'myhistory') return 'My Work History';
    }
    return originalTitleFor(role, view);
  };

  renderPage = function (role) {
    if (role === 'system_admin' && state.view === 'mywork') return renderAdminWorkday();
    if (role === 'system_admin' && state.view === 'myhistory') return renderAdminWorkHistory();
    return originalRenderPage(role);
  };

  function adminNewTaskForm() {
    if (!state.orgs.length) {
      return `<div class="empty" style="padding:34px 20px">
        <strong>Create an organization first</strong>
        <span>Admin task entries must be linked to a client or organization so reports stay properly separated.</span>
        <button class="btn btn-primary" id="goCreateOrg" type="button" style="margin-top:14px">Go to Organizations</button>
      </div>`;
    }

    return `<form id="startForm">
      <div class="form-grid">
        <div class="full field">
          <label>Organization / Client</label>
          <select class="select" id="taskOrg" required>
            <option value="">Select organization</option>
            ${state.orgs.map(o => `<option value="${o.id}">${esc(o.name)} · ${esc(o.code)}</option>`).join('')}
          </select>
        </div>
        <div class="full field">
          <label>Task name</label>
          <input class="input" id="taskTitle" maxlength="120" required placeholder="e.g. Website audit">
        </div>
        <div class="full field">
          <label>Notes</label>
          <textarea class="textarea" id="taskNotes" maxlength="500" placeholder="What will you work on?"></textarea>
        </div>
        <div class="full upload-box">
          <strong>Before screenshot</strong>
          <p>Required proof of your starting state.</p>
          <input id="beforeFile" type="file" accept="image/jpeg,image/png,image/webp" required>
        </div>
      </div>
      <div class="task-actions"><button class="btn btn-primary">Start task</button></div>
    </form>`;
  }

  function renderAdminWorkday() {
    const own = ownEntries();
    const active = activeEntry();
    const today = own.filter(e => isToday(e.started_at));
    const activeOrg = active ? orgNameFor(active.organization_id) : null;

    page().innerHTML = head(
      'My Workday',
      'Track your own admin work without leaving the System Admin account.',
      `<button class="btn" id="adminExportToday" ${today.length ? '' : 'disabled'}>Export today</button>`
    ) + `
      <div class="grid metrics">
        ${metric('Tracked today', fmtDuration(totalMs(today)), 'Your admin account only')}
        ${metric('Completed tasks', today.filter(e => e.status === 'completed').length, 'Today')}
        ${metric('Current status', active ? 'Working' : 'Idle', active ? active.title : 'No active task')}
        ${metric('Evidence sets', today.filter(e => e.before_url && e.after_url).length, 'Before + after')}
      </div>
      <div class="grid split">
        <section class="panel">
          <div class="panel-head"><div><div class="panel-title">Task timer</div><div class="panel-desc">Choose the client workspace, attach before evidence, then start tracking.</div></div></div>
          <div class="panel-body">
            ${active ? `<div class="notice" style="margin-bottom:14px"><strong>${esc(activeOrg)}</strong><br><span>This task is linked to this organization.</span></div>${activeTaskForm(active)}` : adminNewTaskForm()}
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><div><div class="panel-title">Today’s activity</div><div class="panel-desc">Only your own timed entries are shown here.</div></div></div>
          <div class="panel-body" style="padding:0">${entriesTable(today)}</div>
        </section>
      </div>`;

    const exportButton = document.getElementById('adminExportToday');
    if (exportButton) exportButton.onclick = () => exportReport(today, state.profile.full_name, 'WorkWatch');

    const goCreateOrg = document.getElementById('goCreateOrg');
    if (goCreateOrg) goCreateOrg.onclick = () => { state.view = 'organizations'; renderShell(); };

    bindEmployeeForms();
    bindEvidenceButtons();
  }

  function renderAdminWorkHistory() {
    const own = ownEntries();
    page().innerHTML = head(
      'My Work History',
      'Review and export tasks recorded from your System Admin account.',
      `<button class="btn" id="adminCsv" ${own.length ? '' : 'disabled'}>CSV</button><button class="btn btn-primary" id="adminPdf" ${own.length ? '' : 'disabled'}>Client report</button>`
    ) + `<section class="panel"><div class="panel-body" style="padding:0">${entriesTable(own)}</div></section>`;

    const csv = document.getElementById('adminCsv');
    const pdf = document.getElementById('adminPdf');
    if (csv) csv.onclick = () => exportCsv(own);
    if (pdf) pdf.onclick = () => exportReport(own, state.profile.full_name, 'WorkWatch');
    bindEvidenceButtons();
  }

  startTask = async function (event) {
    if (state.profile?.role !== 'system_admin') return originalStartTask(event);

    event.preventDefault();
    if (state.demoRole) {
      toast('Demo mode does not write data.');
      return;
    }

    const button = event.submitter || event.currentTarget?.querySelector('button[type="submit"], button');
    if (button?.disabled) return;

    const file = document.getElementById('beforeFile')?.files?.[0];
    const title = document.getElementById('taskTitle')?.value?.trim() || '';
    const notes = document.getElementById('taskNotes')?.value?.trim() || '';
    const organizationId = document.getElementById('taskOrg')?.value || '';

    if (!organizationId) {
      toast('Select an organization or client first.', 'error');
      return;
    }
    if (!file) {
      toast('Before screenshot is required.', 'error');
      return;
    }
    if (!title) {
      toast('Task name is required.', 'error');
      return;
    }

    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Starting…';
    }

    try {
      const id = crypto.randomUUID();
      const path = await uploadEvidence(file, id, 'before');
      const { error } = await sb.from('work_entries').insert({
        id,
        organization_id: organizationId,
        employee_id: state.profile.id,
        title,
        notes,
        before_path: path,
        status: 'active'
      });
      if (error) throw error;
      state.view = 'mywork';
      await loadWorkspace();
      toast('Task started.');
    } catch (err) {
      toast(err.message || 'Could not start task.', 'error');
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Start task';
      }
    }
  };
})();
