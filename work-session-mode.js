(() => {
  const OWNER_ROLE = 'system_admin';
  const SESSION_KEY = 'ww_work_session_v2';
  const SESSION_HISTORY_KEY = 'ww_work_session_history_v2';
  const LOCAL_TASKS_KEY = 'ww_open_tasks_v2';
  const PERSONAL_ORG_NAME = 'Personal Work Records';
  const feature = window.WorkWatchSessionMode = window.WorkWatchSessionMode || {
    schemaAvailable: null,
    sessions: [],
    loading: null
  };

  const baseRenderPage = renderPage;
  const baseLoadWorkspace = loadWorkspace;
  const baseUpdateTimers = updateTimers;

  const parse = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
    catch { return fallback; }
  };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const uid = () => state.profile?.id || state.user?.id || '';
  const currentUserEntries = () => (state.entries || [])
    .filter(e => e.employee_id === uid())
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const isOpenStatus = status => status === 'active' || status === 'paused';
  const serverOpenTasks = () => currentUserEntries().filter(e => isOpenStatus(e.status));
  const localOpenTasks = () => parse(LOCAL_TASKS_KEY, []).filter(t => t.user_id === uid() && isOpenStatus(t.status));
  const setLocalTasks = tasks => save(LOCAL_TASKS_KEY, tasks);
  const localTaskById = id => localOpenTasks().find(t => t.id === id);
  const serverTaskById = id => currentUserEntries().find(t => t.id === id && isOpenStatus(t.status));
  const findTask = id => serverTaskById(id) || localTaskById(id);
  const taskIsServer = task => !!task?.server_persisted || !!serverTaskById(task?.id);

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
  const dateKey = value => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function getLocalSession() {
    const session = parse(SESSION_KEY, null);
    return session?.user_id === uid() && isOpenStatus(session.status) ? session : null;
  }
  function setLocalSession(session) {
    if (session) save(SESSION_KEY, session);
    else localStorage.removeItem(SESSION_KEY);
  }
  function activeServerSession() {
    return (feature.sessions || []).find(s => s.user_id === uid() && isOpenStatus(s.status)) || null;
  }
  function activeSession() { return activeServerSession() || getLocalSession(); }
  function sessionIsServer(session) { return !!session?.server_persisted || !!activeServerSession()?.id && activeServerSession().id === session?.id; }

  async function refreshSessions({ rerender = false } = {}) {
    if (!sb || !uid()) return;
    if (feature.loading) return feature.loading;
    feature.loading = (async () => {
      const { data, error } = await sb
        .from('work_sessions')
        .select('*')
        .eq('user_id', uid())
        .order('started_at', { ascending: false })
        .limit(100);
      if (error) {
        const missing = ['42P01', 'PGRST205', 'PGRST204'].includes(error.code) || /work_sessions|schema cache|relation/i.test(error.message || '');
        if (missing) {
          feature.schemaAvailable = false;
          feature.sessions = [];
          return;
        }
        console.warn('Work session lookup failed:', error.message);
        return;
      }
      feature.schemaAvailable = true;
      feature.sessions = (data || []).map(x => ({ ...x, server_persisted: true }));
      const local = getLocalSession();
      if (local && !activeServerSession()) {
        try {
          const payload = {
            id: local.id,
            user_id: uid(),
            organization_id: local.organization_id || null,
            status: local.status,
            started_at: local.started_at,
            break_seconds: Number(local.break_seconds || 0),
            paused_at: local.paused_at || null
          };
          const { data: migrated, error: migrateError } = await sb.from('work_sessions').insert(payload).select('*').single();
          if (!migrateError && migrated) {
            feature.sessions.unshift({ ...migrated, server_persisted: true });
            setLocalSession(null);
          }
        } catch (error) { console.warn('Could not migrate local work session:', error); }
      }
      await migrateLocalOpenTasks();
    })().finally(() => { feature.loading = null; });
    await feature.loading;
    if (rerender && state.profile?.role === OWNER_ROLE && state.view === 'dashboard') renderShell();
  }

  async function ensurePersonalOrg() {
    const existing = (state.orgs || []).find(o => o.name === PERSONAL_ORG_NAME) || state.org || (state.orgs || [])[0];
    if (existing) return existing;
    const code = `PERSONAL-${Date.now().toString().slice(-6)}`;
    const { data, error } = await sb.from('organizations').insert({ name: PERSONAL_ORG_NAME, code }).select('*').single();
    if (error) throw error;
    state.orgs = [data, ...(state.orgs || [])];
    return data;
  }

  async function startWorkSession() {
    if (activeSession()) return toast('A work session is already running.', 'error');
    const button = document.getElementById('wwStartWork');
    if (button) { button.disabled = true; button.textContent = 'Starting…'; }
    try {
      const org = await ensurePersonalOrg();
      const session = {
        id: crypto.randomUUID(), user_id: uid(), organization_id: org?.id || null,
        status: 'active', started_at: nowIso(), ended_at: null,
        break_seconds: 0, paused_at: null, server_persisted: false
      };
      if (feature.schemaAvailable === true) {
        const { data, error } = await sb.from('work_sessions').insert({
          id: session.id, user_id: session.user_id, organization_id: session.organization_id,
          status: session.status, started_at: session.started_at, break_seconds: 0
        }).select('*').single();
        if (error) throw error;
        feature.sessions.unshift({ ...data, server_persisted: true });
      } else {
        setLocalSession(session);
      }
      toast('Work session started. Add a task whenever you are ready.');
      renderShell();
    } catch (error) {
      toast(error.message || 'Could not start work session.', 'error');
      if (button && document.body.contains(button)) { button.disabled = false; button.textContent = 'Start Work'; }
    }
  }

  async function pauseWorkSession() {
    const session = activeSession();
    if (!session || session.status !== 'active') return;
    const patch = { status: 'paused', paused_at: nowIso() };
    if (sessionIsServer(session)) {
      const { error } = await sb.from('work_sessions').update(patch).eq('id', session.id).eq('user_id', uid());
      if (error) return toast(error.message, 'error');
      await refreshSessions();
    } else {
      setLocalSession({ ...session, ...patch });
    }
    toast('Work session paused. Break time is excluded.');
    renderShell();
  }

  async function resumeWorkSession() {
    const session = activeSession();
    if (!session || session.status !== 'paused' || !session.paused_at) return;
    const extra = Math.max(0, Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000));
    const patch = { status: 'active', paused_at: null, break_seconds: Number(session.break_seconds || 0) + extra };
    if (sessionIsServer(session)) {
      const { error } = await sb.from('work_sessions').update(patch).eq('id', session.id).eq('user_id', uid());
      if (error) return toast(error.message, 'error');
      await refreshSessions();
    } else {
      setLocalSession({ ...session, ...patch });
    }
    toast('Work session resumed.');
    renderShell();
  }

  async function endWorkSession() {
    const session = activeSession();
    if (!session) return;
    const open = allOpenTasks();
    if (open.length) return toast(`Finish ${open.length} active task${open.length === 1 ? '' : 's'} before ending work.`, 'error');
    const endedAt = nowIso();
    let totalBreakSeconds = Number(session.break_seconds || 0);
    if (session.status === 'paused' && session.paused_at) totalBreakSeconds += Math.max(0, Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000));
    if (sessionIsServer(session)) {
      const { error } = await sb.from('work_sessions').update({
        status: 'completed', ended_at: endedAt, paused_at: null, break_seconds: totalBreakSeconds
      }).eq('id', session.id).eq('user_id', uid());
      if (error) return toast(error.message, 'error');
      await refreshSessions();
    } else {
      const history = parse(SESSION_HISTORY_KEY, []).filter(x => x.user_id === uid());
      history.unshift({ ...session, status: 'completed', ended_at: endedAt, paused_at: null, break_seconds: totalBreakSeconds });
      save(SESSION_HISTORY_KEY, history.slice(0, 365));
      setLocalSession(null);
    }
    toast('Work session ended.');
    renderShell();
  }

  function allOpenTasks() {
    const map = new Map();
    serverOpenTasks().forEach(t => map.set(t.id, { ...t, server_persisted: true }));
    localOpenTasks().forEach(t => { if (!map.has(t.id)) map.set(t.id, t); });
    return [...map.values()].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  }

  async function migrateLocalOpenTasks() {
    if (feature.schemaAvailable !== true) return;
    const session = activeServerSession();
    if (!session) return;
    const locals = localOpenTasks();
    if (!locals.length) return;
    const org = await ensurePersonalOrg();
    const remaining = [];
    for (const task of locals) {
      const exists = currentUserEntries().some(e => e.id === task.id);
      if (exists) continue;
      const payload = {
        id: task.id, organization_id: task.organization_id || org.id, employee_id: uid(),
        title: task.title, notes: task.notes || '', client_label: task.client_label || '', project_label: task.project_label || '',
        before_path: task.before_path, status: task.status || 'active', started_at: task.started_at,
        break_seconds: Number(task.break_seconds || 0), paused_at: task.paused_at || null, work_session_id: session.id
      };
      const { error } = await sb.from('work_entries').insert(payload);
      if (error) { remaining.push(task); continue; }
      for (const proof of task.during_evidence || []) {
        await sb.from('work_entry_during_evidence').insert({
          work_entry_id: task.id, user_id: uid(), path: proof.path,
          captured_at: proof.captured_at || nowIso(), caption: proof.caption || ''
        });
      }
    }
    setLocalTasks(remaining);
    if (locals.length !== remaining.length) await baseLoadWorkspace();
  }

  async function addTask(event) {
    event.preventDefault();
    const session = activeSession();
    if (!session || session.status !== 'active') return toast('Start or resume your work session before adding a task.', 'error');
    const form = event.currentTarget;
    const button = event.submitter || form.querySelector('button[type="submit"]');
    const title = document.getElementById('wwTaskTitle')?.value.trim();
    const notes = document.getElementById('wwTaskNotes')?.value.trim() || '';
    const client = document.getElementById('wwTaskClient')?.value.trim() || '';
    const project = document.getElementById('wwTaskProject')?.value.trim() || '';
    const file = document.getElementById('wwTaskBefore')?.files?.[0];
    if (!title || !file) return toast('Task name and Before screenshot are required.', 'error');
    if (button) { button.disabled = true; button.textContent = 'Adding…'; }
    try {
      const org = await ensurePersonalOrg();
      const id = crypto.randomUUID();
      const beforePath = await uploadEvidence(file, id, 'before');
      const task = {
        id, user_id: uid(), organization_id: org.id, work_session_id: session.id,
        title, notes, client_label: client, project_label: project,
        status: 'active', started_at: nowIso(), ended_at: null,
        break_seconds: 0, paused_at: null, before_path: beforePath,
        during_evidence: [], server_persisted: false
      };
      if (feature.schemaAvailable === true && sessionIsServer(session)) {
        const { error } = await sb.from('work_entries').insert({
          id, organization_id: org.id, employee_id: uid(), work_session_id: session.id,
          title, notes, client_label: client, project_label: project,
          before_path: beforePath, status: 'active', started_at: task.started_at
        });
        if (error) throw error;
        await baseLoadWorkspace();
      } else {
        setLocalTasks([...localOpenTasks(), task]);
      }
      toast('Task added. The work session keeps running.');
      renderShell();
    } catch (error) {
      toast(error.message || 'Could not add task.', 'error');
      if (button && document.body.contains(button)) { button.disabled = false; button.textContent = 'Add Task'; }
    }
  }

  async function pauseTask(id) {
    const task = findTask(id);
    if (!task || task.status !== 'active') return;
    const patch = { status: 'paused', paused_at: nowIso() };
    if (taskIsServer(task)) {
      const { error } = await sb.from('work_entries').update(patch).eq('id', id).eq('employee_id', uid());
      if (error) return toast(error.message, 'error');
      await baseLoadWorkspace();
    } else {
      setLocalTasks(localOpenTasks().map(t => t.id === id ? { ...t, ...patch } : t));
    }
    renderShell();
  }

  async function resumeTask(id) {
    const task = findTask(id);
    if (!task || task.status !== 'paused' || !task.paused_at) return;
    const extra = Math.max(0, Math.floor((Date.now() - new Date(task.paused_at).getTime()) / 1000));
    const patch = { status: 'active', paused_at: null, break_seconds: Number(task.break_seconds || 0) + extra };
    if (taskIsServer(task)) {
      const { error } = await sb.from('work_entries').update(patch).eq('id', id).eq('employee_id', uid());
      if (error) return toast(error.message, 'error');
      await baseLoadWorkspace();
    } else {
      setLocalTasks(localOpenTasks().map(t => t.id === id ? { ...t, ...patch } : t));
    }
    renderShell();
  }

  async function addDuringEvidence(id, input, captionInput, button) {
    const task = findTask(id);
    if (!task || task.status !== 'active') return toast('Resume this task before adding During evidence.', 'error');
    const files = Array.from(input?.files || []);
    if (!files.length) return toast('Choose one or more During screenshots first.', 'error');
    if (button) { button.disabled = true; button.textContent = `Uploading 0/${files.length}…`; }
    const added = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const path = await uploadEvidence(files[i], id, `during-${Date.now()}-${i}-${crypto.randomUUID().slice(0, 8)}`);
        const proof = { path, captured_at: nowIso(), caption: captionInput?.value.trim() || '' };
        if (taskIsServer(task)) {
          const { error } = await sb.from('work_entry_during_evidence').insert({
            work_entry_id: id, user_id: uid(), path: proof.path, captured_at: proof.captured_at, caption: proof.caption
          });
          if (error) throw error;
        }
        added.push(proof);
        if (button) button.textContent = `Uploading ${i + 1}/${files.length}…`;
      }
      if (!taskIsServer(task)) {
        setLocalTasks(localOpenTasks().map(t => t.id === id ? { ...t, during_evidence: [...(t.during_evidence || []), ...added] } : t));
      } else {
        await baseLoadWorkspace();
      }
      toast(`${added.length} During evidence${added.length === 1 ? '' : 's'} added.`);
      renderShell();
    } catch (error) {
      toast(error.message || 'Could not add During evidence.', 'error');
      if (button && document.body.contains(button)) { button.disabled = false; button.textContent = 'Add During'; }
    }
  }

  async function finishTask(id, input, button) {
    const task = findTask(id);
    if (!task) return toast('Task not found.', 'error');
    if (task.status === 'paused') return toast('Resume this task before finishing it.', 'error');
    const file = input?.files?.[0];
    if (!file) return toast('After screenshot is required.', 'error');
    if (button) { button.disabled = true; button.textContent = 'Finishing…'; }
    try {
      const afterPath = await uploadEvidence(file, id, 'after');
      const endedAt = nowIso();
      if (taskIsServer(task)) {
        const { error } = await sb.from('work_entries').update({
          status: 'completed', ended_at: endedAt, after_path: afterPath, paused_at: null
        }).eq('id', id).eq('employee_id', uid());
        if (error) throw error;
      } else {
        const { error } = await sb.from('work_entries').insert({
          id, organization_id: task.organization_id, employee_id: uid(),
          title: task.title, notes: task.notes || '', client_label: task.client_label || '', project_label: task.project_label || '',
          before_path: task.before_path, after_path: afterPath, status: 'completed',
          started_at: task.started_at, ended_at: endedAt, break_seconds: Number(task.break_seconds || 0)
        });
        if (error) throw error;
        for (const proof of task.during_evidence || []) {
          const { error: proofError } = await sb.from('work_entry_during_evidence').insert({
            work_entry_id: id, user_id: uid(), path: proof.path,
            captured_at: proof.captured_at || nowIso(), caption: proof.caption || ''
          });
          if (proofError) console.warn('During evidence link failed:', proofError.message);
        }
        setLocalTasks(localOpenTasks().filter(t => t.id !== id));
      }
      await baseLoadWorkspace();
      toast('Task completed. You can add another task without stopping the work timer.');
      renderShell();
    } catch (error) {
      toast(error.message || 'Could not finish task.', 'error');
      if (button && document.body.contains(button)) { button.disabled = false; button.textContent = 'Finish Task'; }
    }
  }

  async function saveTaskTemplate() {
    const title = document.getElementById('wwTaskTitle')?.value.trim();
    if (!title) return toast('Enter a task name first.', 'error');
    const payload = {
      user_id: uid(), title,
      notes: document.getElementById('wwTaskNotes')?.value.trim() || '',
      client_label: document.getElementById('wwTaskClient')?.value.trim() || '',
      project_label: document.getElementById('wwTaskProject')?.value.trim() || '', favorite: true
    };
    const { error } = await sb.from('task_templates').insert(payload);
    if (error) return toast(error.message, 'error');
    toast('Task template saved.');
  }

  function takeTemplatePrefill() {
    try {
      const raw = sessionStorage.getItem('ww_task_prefill');
      if (!raw) return {};
      sessionStorage.removeItem('ww_task_prefill');
      return JSON.parse(raw) || {};
    } catch { return {}; }
  }

  function sessionHistoryForToday() {
    const today = dateKey(new Date());
    const server = (feature.sessions || []).filter(s => s.user_id === uid() && dateKey(s.started_at) === today);
    const local = parse(SESSION_HISTORY_KEY, []).filter(s => s.user_id === uid() && dateKey(s.started_at) === today);
    const active = getLocalSession();
    return [...server, ...local, ...(active && dateKey(active.started_at) === today ? [active] : [])];
  }

  function unionSessionMs(sessions) {
    const ranges = (sessions || []).map(s => {
      const start = new Date(s.started_at).getTime();
      const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
      return [start, Math.max(start, end), breakMs(s)];
    }).sort((a, b) => a[0] - b[0]);
    return ranges.reduce((sum, [start, end, paused]) => sum + Math.max(0, end - start - paused), 0);
  }

  function taskProofCount(task) {
    return (task.before_path || task.before_url ? 1 : 0) + (task.during_evidence?.length || 0) + (task.after_path || task.after_url ? 1 : 0);
  }

  function taskCard(task) {
    const paused = task.status === 'paused';
    return `<article class="ww-active-task" data-task-card="${task.id}">
      <div class="ww-task-top">
        <div class="ww-task-copy"><div class="ww-task-status ${paused ? 'paused' : ''}">${paused ? 'Paused' : 'Active task'}</div><h3>${esc(task.title)}</h3><p>${esc([task.client_label, task.project_label].filter(Boolean).join(' · ') || task.notes || 'No additional details')}</p></div>
        <div class="ww-task-clock" data-task-timer="${task.id}">${fmtDuration(elapsedMs(task))}</div>
      </div>
      <div class="ww-task-meta"><span>Started ${fmtTime(task.started_at)}</span><span>${taskProofCount(task)} proof image${taskProofCount(task) === 1 ? '' : 's'}</span>${breakMs(task) ? `<span>Break ${fmtDuration(breakMs(task))}</span>` : ''}</div>
      <div class="ww-task-actions-row">
        ${paused ? `<button class="btn btn-sm btn-primary" type="button" data-resume-task="${task.id}">Resume</button>` : `<button class="btn btn-sm" type="button" data-pause-task="${task.id}">Pause task</button>`}
        ${taskIsServer(task) ? `<button class="btn btn-sm" type="button" data-evidence="${task.id}">View saved proof</button>` : ''}
      </div>
      <div class="ww-proof-actions ${paused ? 'is-disabled' : ''}">
        <form class="ww-during-form" data-during-form="${task.id}">
          <div class="field"><label>During evidence <span class="suite-optional">Optional · multiple allowed</span></label><input class="input" data-during-file="${task.id}" type="file" accept="image/jpeg,image/png,image/webp" multiple ${paused ? 'disabled' : ''}></div>
          <div class="field"><label>Caption <span class="suite-optional">Optional</span></label><input class="input" data-during-caption="${task.id}" maxlength="240" placeholder="What changed?" ${paused ? 'disabled' : ''}></div>
          <button class="btn btn-sm" type="submit" ${paused ? 'disabled' : ''}>Add During</button>
        </form>
        <form class="ww-finish-form" data-finish-form="${task.id}">
          <div class="field"><label>After screenshot <span class="ww-required">Required</span></label><input class="input" data-after-file="${task.id}" type="file" accept="image/jpeg,image/png,image/webp" required ${paused ? 'disabled' : ''}></div>
          <button class="btn btn-sm btn-primary" type="submit" ${paused ? 'disabled' : ''}>Finish Task</button>
        </form>
      </div>
    </article>`;
  }

  function completedTable(entries) {
    const rows = entries.filter(e => e.status === 'completed').slice(0, 20);
    if (!rows.length) return '<div class="empty"><strong>No completed tasks yet</strong><span>Finished tasks will appear here while your work session can continue.</span></div>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Time</th><th>Recorded</th><th>Evidence</th></tr></thead><tbody>${rows.map(e => `<tr><td><div class="td-main">${esc(e.title)}</div><div class="td-sub">${esc([e.client_label,e.project_label].filter(Boolean).join(' · ') || e.notes || '')}</div></td><td>${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}</td><td class="mono">${fmtDuration(elapsedMs(e))}</td><td>${e.before_url || e.after_url ? `<button class="btn btn-sm" data-evidence="${e.id}">View</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderSessionDashboard() {
    const session = activeSession();
    const openTasks = allOpenTasks();
    const todayEntries = currentUserEntries().filter(e => isToday(e.started_at));
    const completed = todayEntries.filter(e => e.status === 'completed');
    const todaySessionMs = unionSessionMs(sessionHistoryForToday());
    const prefill = takeTemplatePrefill();
    const clients = [...new Set(currentUserEntries().map(e => e.client_label).filter(Boolean))].sort();
    const projects = [...new Set(currentUserEntries().map(e => e.project_label).filter(Boolean))].sort();
    const schemaNote = feature.schemaAvailable === false
      ? '<span class="ww-storage-note">Active session/tasks are safely kept on this browser until completion. Completed tasks still sync to WorkWatch.</span>'
      : '<span class="ww-storage-note">Session and active tasks are synced to WorkWatch.</span>';

    page().innerHTML = head('My Workday', 'Start your work timer first, then add one or multiple tasks as you go.', `<button class="btn" id="exportToday" ${todayEntries.length ? '' : 'disabled'}>Export today</button>`) + `
      <div class="grid metrics ww-session-metrics">
        ${metric('Actual work today', fmtDuration(todaySessionMs), 'Session time · no overlap double-count')}
        ${metric('Active tasks', openTasks.length, openTasks.length > 1 ? 'Multiple tasks running' : 'Parallel tasks supported')}
        ${metric('Completed tasks', completed.length, 'Today')}
        ${metric('Evidence sets', completed.filter(e => e.before_url && e.after_url).length, 'Before + After verified')}
      </div>
      <section class="panel ww-session-panel">
        <div class="panel-head"><div><div class="panel-title">Work session</div><div class="panel-desc">This is your actual work clock. Task timers do not increase the total when they overlap.</div></div>${schemaNote}</div>
        <div class="panel-body">
          ${session ? `<div class="ww-session-running ${session.status === 'paused' ? 'paused' : ''}">
            <div><div class="ww-session-state">${session.status === 'paused' ? 'On break' : 'Working now'}</div><strong>Work Session</strong><span>Started ${fmtTime(session.started_at)}${breakMs(session) ? ` · Break ${fmtDuration(breakMs(session))}` : ''}</span></div>
            <div class="ww-session-timer" data-session-timer>${fmtDuration(elapsedMs(session))}</div>
            <div class="ww-session-actions">${session.status === 'paused' ? '<button class="btn btn-primary" id="wwResumeWork" type="button">Resume Work</button>' : '<button class="btn" id="wwPauseWork" type="button">Pause / Break</button>'}<button class="btn btn-danger" id="wwEndWork" type="button" ${openTasks.length ? 'disabled title="Finish active tasks first"' : ''}>End Work</button></div>
          </div>` : `<div class="ww-session-empty"><div><strong>Ready to work?</strong><p>Start the timer immediately. You can decide and add your tasks afterward.</p></div><button class="btn btn-primary ww-start-work" id="wwStartWork" type="button">Start Work</button></div>`}
        </div>
      </section>
      ${session ? `<div class="grid ww-work-grid">
        <section class="panel">
          <div class="panel-head"><div><div class="panel-title">Add task</div><div class="panel-desc">The work timer keeps running. Add another task anytime—even while another task is active.</div></div></div>
          <div class="panel-body"><form id="wwAddTaskForm"><div class="form-grid">
            <div class="full field"><label>Task name</label><input class="input" id="wwTaskTitle" maxlength="120" required value="${esc(prefill.title || '')}" placeholder="e.g. WooCommerce View Cart fix"></div>
            <div class="full field"><label>Notes <span class="suite-optional">Optional</span></label><textarea class="textarea" id="wwTaskNotes" maxlength="500" placeholder="What are you working on?">${esc(prefill.notes || '')}</textarea></div>
            <div class="field"><label>Client <span class="suite-optional">Optional</span></label><input class="input" id="wwTaskClient" list="wwClients" maxlength="100" value="${esc(prefill.client_label || '')}"><datalist id="wwClients">${clients.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
            <div class="field"><label>Project <span class="suite-optional">Optional</span></label><input class="input" id="wwTaskProject" list="wwProjects" maxlength="100" value="${esc(prefill.project_label || '')}"><datalist id="wwProjects">${projects.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
            <div class="full upload-box"><strong>Before screenshot</strong><p>Required when adding a task, not when starting your work session.</p><input id="wwTaskBefore" type="file" accept="image/jpeg,image/png,image/webp" required></div>
          </div><div class="task-actions"><button class="btn" id="wwSaveTemplate" type="button">Save as template</button><button class="btn btn-primary" type="submit" ${session.status === 'paused' ? 'disabled title="Resume work first"' : ''}>Add Task</button></div></form></div>
        </section>
        <section class="panel">
          <div class="panel-head"><div><div class="panel-title">Active tasks</div><div class="panel-desc">Each task keeps its own proof and elapsed time.</div></div><span class="ww-count-badge">${openTasks.length}</span></div>
          <div class="panel-body ww-active-list">${openTasks.length ? openTasks.map(taskCard).join('') : '<div class="empty"><strong>No active task yet</strong><span>Your main work timer is already running. Add a task when you are ready.</span></div>'}</div>
        </section>
      </div>` : ''}
      <section class="panel ww-completed-panel"><div class="panel-head"><div><div class="panel-title">Today’s completed tasks</div><div class="panel-desc">Finishing a task does not stop your main work session.</div></div></div><div class="panel-body" style="padding:0">${completedTable(todayEntries)}</div></section>`;

    bindDashboard(session, openTasks, todayEntries);
  }

  function bindDashboard(session, openTasks, todayEntries) {
    document.getElementById('wwStartWork')?.addEventListener('click', startWorkSession);
    document.getElementById('wwPauseWork')?.addEventListener('click', pauseWorkSession);
    document.getElementById('wwResumeWork')?.addEventListener('click', resumeWorkSession);
    document.getElementById('wwEndWork')?.addEventListener('click', endWorkSession);
    document.getElementById('wwAddTaskForm')?.addEventListener('submit', addTask);
    document.getElementById('wwSaveTemplate')?.addEventListener('click', saveTaskTemplate);
    document.getElementById('exportToday')?.addEventListener('click', () => exportReport(todayEntries, state.profile.full_name));
    document.querySelectorAll('[data-pause-task]').forEach(btn => btn.addEventListener('click', () => pauseTask(btn.dataset.pauseTask)));
    document.querySelectorAll('[data-resume-task]').forEach(btn => btn.addEventListener('click', () => resumeTask(btn.dataset.resumeTask)));
    document.querySelectorAll('[data-during-form]').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault();
      const id = form.dataset.duringForm;
      addDuringEvidence(id, document.querySelector(`[data-during-file="${id}"]`), document.querySelector(`[data-during-caption="${id}"]`), event.submitter || form.querySelector('button[type="submit"]'));
    }));
    document.querySelectorAll('[data-finish-form]').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault();
      const id = form.dataset.finishForm;
      finishTask(id, document.querySelector(`[data-after-file="${id}"]`), event.submitter || form.querySelector('button[type="submit"]'));
    }));
    bindEvidenceButtons();
  }

  renderPage = function(role) {
    if (role === OWNER_ROLE && state.view === 'dashboard') return renderSessionDashboard();
    return baseRenderPage(role);
  };

  loadWorkspace = async function() {
    const result = await baseLoadWorkspace();
    if (state.profile?.role === OWNER_ROLE) {
      await refreshSessions();
      if (state.view === 'dashboard') renderShell();
    }
    return result;
  };

  updateTimers = function() {
    if (!(state.profile?.role === OWNER_ROLE && state.view === 'dashboard')) return baseUpdateTimers();
    const session = activeSession();
    document.querySelectorAll('[data-session-timer]').forEach(el => { if (session) el.textContent = fmtDuration(elapsedMs(session)); });
    const tasks = allOpenTasks();
    document.querySelectorAll('[data-task-timer]').forEach(el => {
      const task = tasks.find(t => t.id === el.dataset.taskTimer);
      if (task) el.textContent = fmtDuration(elapsedMs(task));
    });
  };

  if (!document.getElementById('wwSessionModeStyles')) {
    const link = document.createElement('link');
    link.id = 'wwSessionModeStyles';
    link.rel = 'stylesheet';
    link.href = './work-session-mode.css';
    document.head.appendChild(link);
  }

  if (state.profile?.role === OWNER_ROLE) {
    refreshSessions({ rerender: true });
  } else {
    const observer = new MutationObserver(() => {
      if (state.profile?.role === OWNER_ROLE && feature.schemaAvailable === null) refreshSessions({ rerender: true });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
