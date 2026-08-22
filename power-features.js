(() => {
  const OWNER_ROLE = 'system_admin';
  const suite = window.WorkWatchSuite = window.WorkWatchSuite || {
    templates: [], summaries: [], reports: [], submissions: [], preferences: null,
    auditEntryIds: new Set(), calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    loaded: false, refreshing: null
  };

  const baseNavFor = navFor;
  const baseTitleFor = titleFor;
  const baseRenderPage = renderPage;
  const baseLoadWorkspace = loadWorkspace;
  const baseUploadEvidence = uploadEvidence;
  const baseHydrate = hydrate;
  const baseAuthView = authView;

  const ownEntries = () => (state.entries || []).filter(e => e.employee_id === state.profile?.id).sort((a,b) => new Date(b.started_at) - new Date(a.started_at));
  const currentEntry = () => ownEntries().find(e => e.status === 'active' || e.status === 'paused');
  const breakMsFor = (e, now = new Date()) => {
    let ms = Math.max(0, Number(e?.break_seconds || 0)) * 1000;
    if (e?.status === 'paused' && e.paused_at) ms += Math.max(0, now - new Date(e.paused_at));
    return ms;
  };
  const recordedMsFor = (e, now = new Date()) => {
    if (!e?.started_at) return 0;
    const end = e.ended_at ? new Date(e.ended_at) : now;
    return Math.max(0, end - new Date(e.started_at) - breakMsFor(e, now));
  };
  const totalRecorded = arr => (arr || []).reduce((n,e) => n + recordedMsFor(e), 0);
  const totalBreak = arr => (arr || []).reduce((n,e) => n + breakMsFor(e), 0);
  const dateKey = value => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const endOfDay = value => { const d = new Date(value); d.setHours(23,59,59,999); return d; };
  const startOfWeek = value => { const d = new Date(value); d.setHours(0,0,0,0); const day=d.getDay(); d.setDate(d.getDate()+(day===0?-6:1-day)); return d; };
  const slug = s => String(s || '').trim().replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'') || 'WorkWatch';
  const unique = arr => [...new Set((arr || []).filter(Boolean).map(x => String(x).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const evidenceStatus = e => e.before_url && e.after_url ? `${(e.during_evidence || []).length} During · Verified` : e.before_url ? 'Before only' : 'No evidence';

  function defaultPreferences() {
    return { workday_target_minutes: 480, compression_enabled: true, max_image_width: 1920, image_quality: 0.84 };
  }

  async function refreshSuiteData() {
    if (!sb || !state.profile || state.profile.role !== OWNER_ROLE) return;
    if (suite.refreshing) return suite.refreshing;
    suite.refreshing = (async () => {
      const uid = state.profile.id;
      const [templates, summaries, prefs, reports, submissions, audits] = await Promise.all([
        sb.from('task_templates').select('*').eq('user_id', uid).order('favorite',{ascending:false}).order('created_at',{ascending:false}),
        sb.from('daily_summaries').select('*').eq('user_id', uid).order('summary_date',{ascending:false}).limit(365),
        sb.from('user_preferences').select('*').eq('user_id', uid).maybeSingle(),
        sb.from('finalized_reports').select('*').eq('user_id', uid).order('finalized_at',{ascending:false}).limit(100),
        sb.from('report_submissions').select('*').eq('user_id', uid).order('submitted_at',{ascending:false}).limit(300),
        sb.from('work_entry_audit').select('entry_id').eq('edited_by', uid).limit(1000)
      ]);
      suite.templates = templates.data || [];
      suite.summaries = summaries.data || [];
      suite.preferences = prefs.data || defaultPreferences();
      suite.reports = reports.data || [];
      suite.submissions = submissions.data || [];
      suite.auditEntryIds = new Set((audits.data || []).map(x => x.entry_id));
      suite.loaded = true;
    })().finally(() => { suite.refreshing = null; });
    return suite.refreshing;
  }

  hydrate = async function(arr) {
    const hydrated = await baseHydrate(arr);
    if (!sb || !state.profile || !hydrated?.length) return hydrated;
    const ids = hydrated.map(x => x.id).filter(Boolean);
    const { data } = await sb.from('work_entry_during_evidence').select('id,work_entry_id,path,captured_at,created_at,caption').in('work_entry_id', ids).order('captured_at',{ascending:true});
    if (!data) return hydrated;
    const captions = new Map(data.map(x => [x.id, x.caption || '']));
    return hydrated.map(entry => ({
      ...entry,
      during_evidence: (entry.during_evidence || []).map(item => ({...item, caption: captions.get(item.id) || item.caption || ''}))
    }));
  };

  loadWorkspace = async function() {
    const result = await baseLoadWorkspace();
    if (state.profile?.role === OWNER_ROLE) {
      await refreshSuiteData();
      recoverTimerState();
      if (['history','reports','calendar','templates','finalized','settings'].includes(state.view)) renderShell();
      else queueMicrotask(patchDashboard);
    }
    return result;
  };

  navFor = function(role) {
    if (role !== OWNER_ROLE) return baseNavFor(role);
    return [
      ['dashboard','My Workday','clock'],
      ['history','Work History','report'],
      ['calendar','Calendar','report'],
      ['reports','Reports','report'],
      ['templates','Templates','building'],
      ['finalized','Finalized','report'],
      ['audit','Edit History','users'],
      ['settings','Settings','users']
    ];
  };

  titleFor = function(role, view) {
    if (role !== OWNER_ROLE) return baseTitleFor(role, view);
    return ({dashboard:'My Workday',history:'Work History',calendar:'Calendar',reports:'Reports',templates:'Task Templates',finalized:'Finalized Reports',audit:'Edit History',settings:'Settings'})[view] || 'WorkWatch';
  };

  renderPage = function(role) {
    if (role !== OWNER_ROLE) return baseRenderPage(role);
    if (state.view === 'history') return renderSuiteHistory();
    if (state.view === 'calendar') return renderCalendar();
    if (state.view === 'reports') return renderSuiteReports();
    if (state.view === 'templates') return renderTemplates();
    if (state.view === 'finalized') return renderFinalized();
    if (state.view === 'settings') return renderSettings();
    const result = baseRenderPage(role);
    if (state.view === 'dashboard') queueMicrotask(patchDashboard);
    return result;
  };

  async function ensurePersonalOrg() {
    if (state.orgs?.length) return state.orgs[0];
    const code = `PERSONAL-${Date.now().toString().slice(-6)}`;
    const { data, error } = await sb.from('organizations').insert({name:'Personal Work Records',code}).select('*').single();
    if (error) throw error;
    state.orgs = [data];
    return data;
  }

  function patchDashboard() {
    if (state.profile?.role !== OWNER_ROLE || state.view !== 'dashboard') return;
    const form = document.getElementById('personalStartForm');
    if (form && !form.dataset.suiteReady) {
      form.dataset.suiteReady = '1';
      const grid = form.querySelector('.form-grid');
      const clients = unique(ownEntries().map(e => e.client_label));
      const projects = unique(ownEntries().map(e => e.project_label));
      if (grid) grid.insertAdjacentHTML('beforeend', `
        <div class="field"><label>Client <span class="suite-optional">Optional</span></label><input class="input" id="clientLabel" list="suiteClients" maxlength="100" placeholder="e.g. Setiba Medical Spa"><datalist id="suiteClients">${clients.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field"><label>Project <span class="suite-optional">Optional</span></label><input class="input" id="projectLabel" list="suiteProjects" maxlength="100" placeholder="e.g. Website Maintenance"><datalist id="suiteProjects">${projects.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div>`);
      const actions = form.querySelector('.task-actions');
      if (actions) actions.insertAdjacentHTML('afterbegin','<button class="btn" type="button" id="saveTaskTemplate">Save as template</button>');
      document.getElementById('saveTaskTemplate')?.addEventListener('click', saveCurrentAsTemplate);
      applyTaskPrefill();
    }

    if (!document.getElementById('suiteTargetPanel')) {
      const today = ownEntries().filter(e => isToday(e.started_at));
      const targetMin = Number(suite.preferences?.workday_target_minutes ?? 480);
      const targetMs = targetMin * 60000;
      const done = totalRecorded(today);
      const pct = targetMs ? Math.min(100, Math.round(done / targetMs * 100)) : 0;
      const remaining = Math.max(0, targetMs - done);
      const panel = document.createElement('section');
      panel.className = 'panel suite-target-panel'; panel.id='suiteTargetPanel';
      panel.innerHTML = `<div class="panel-head"><div><div class="panel-title">Workday target</div><div class="panel-desc">Optional daily target. Breaks are excluded.</div></div><strong>${targetMin ? `${fmtDuration(done)} / ${fmtDuration(targetMs)}` : 'Off'}</strong></div><div class="panel-body"><div class="suite-progress"><span style="width:${pct}%"></span></div><div class="suite-target-meta">${targetMin ? `${pct}% complete · ${fmtDuration(remaining)} remaining` : 'Set a target in Settings.'}</div></div>`;
      const pageEl = page(); if (pageEl) pageEl.appendChild(panel);
    }

    if (!document.getElementById('suiteDailySummary')) {
      const todayKey = dateKey(new Date());
      const saved = suite.summaries.find(x => x.summary_date === todayKey) || {};
      const panel = document.createElement('section'); panel.className='panel suite-summary-panel'; panel.id='suiteDailySummary';
      panel.innerHTML = `<div class="panel-head"><div><div class="panel-title">Daily accomplishment summary</div><div class="panel-desc">Optional notes included in reports for today.</div></div></div><div class="panel-body suite-summary-grid"><div class="field"><label>Completed today</label><textarea class="textarea" id="dailyCompleted" maxlength="2000">${esc(saved.completed_text||'')}</textarea></div><div class="field"><label>Issues encountered</label><textarea class="textarea" id="dailyIssues" maxlength="2000">${esc(saved.issues_text||'')}</textarea></div><div class="field"><label>Next actions</label><textarea class="textarea" id="dailyNext" maxlength="2000">${esc(saved.next_actions_text||'')}</textarea></div><div class="task-actions"><button class="btn btn-primary" id="saveDailySummary" type="button">Save summary</button></div></div>`;
      page()?.appendChild(panel);
      document.getElementById('saveDailySummary')?.addEventListener('click', saveDailySummary);
    }
  }

  function applyTaskPrefill() {
    try {
      const raw = sessionStorage.getItem('ww_task_prefill'); if (!raw) return;
      sessionStorage.removeItem('ww_task_prefill');
      const p = JSON.parse(raw);
      if (document.getElementById('taskTitle')) document.getElementById('taskTitle').value = p.title || '';
      if (document.getElementById('taskNotes')) document.getElementById('taskNotes').value = p.notes || '';
      if (document.getElementById('clientLabel')) document.getElementById('clientLabel').value = p.client_label || '';
      if (document.getElementById('projectLabel')) document.getElementById('projectLabel').value = p.project_label || '';
      document.getElementById('taskTitle')?.focus();
    } catch {}
  }

  async function saveCurrentAsTemplate() {
    const title = document.getElementById('taskTitle')?.value.trim();
    if (!title) return toast('Enter a task name first.', 'error');
    const payload = { user_id:state.profile.id, title, notes:document.getElementById('taskNotes')?.value.trim()||'', client_label:document.getElementById('clientLabel')?.value.trim()||'', project_label:document.getElementById('projectLabel')?.value.trim()||'', favorite:true };
    const { error } = await sb.from('task_templates').insert(payload);
    if (error) return toast(error.message,'error');
    await refreshSuiteData(); toast('Task template saved.');
  }

  async function saveDailySummary() {
    const payload = { user_id:state.profile.id, summary_date:dateKey(new Date()), completed_text:document.getElementById('dailyCompleted')?.value.trim()||'', issues_text:document.getElementById('dailyIssues')?.value.trim()||'', next_actions_text:document.getElementById('dailyNext')?.value.trim()||'', updated_at:new Date().toISOString() };
    const { error } = await sb.from('daily_summaries').upsert(payload,{onConflict:'user_id,summary_date'});
    if (error) return toast(error.message,'error');
    await refreshSuiteData(); toast('Daily summary saved.');
  }

  document.addEventListener('submit', async event => {
    if (event.target?.id !== 'personalStartForm' || state.profile?.role !== OWNER_ROLE) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const form = event.target, button = event.submitter || form.querySelector('button[type="submit"]');
    const file = document.getElementById('beforeFile')?.files?.[0], title=document.getElementById('taskTitle')?.value.trim();
    if (!file || !title) return toast('Task name and Before screenshot are required.','error');
    if (currentEntry()) return toast('Finish or resume your current task first.','error');
    if (button) { button.disabled=true; button.textContent='Starting…'; }
    try {
      const org = await ensurePersonalOrg(), id=crypto.randomUUID(), path=await uploadEvidence(file,id,'before');
      const { error } = await sb.from('work_entries').insert({ id, organization_id:org.id, employee_id:state.profile.id, title, notes:document.getElementById('taskNotes')?.value.trim()||'', client_label:document.getElementById('clientLabel')?.value.trim()||'', project_label:document.getElementById('projectLabel')?.value.trim()||'', before_path:path, status:'active' });
      if (error) throw error;
      await loadWorkspace(); toast('Task started.');
    } catch (error) {
      toast(error.message || 'Could not start task.','error');
      if (button && document.body.contains(button)) { button.disabled=false; button.textContent='Start task'; }
    }
  }, true);

  function recoverTimerState() {
    const current = currentEntry();
    const key = 'ww_active_entry'; const previous = localStorage.getItem(key);
    if (current) {
      localStorage.setItem(key,current.id);
      if (previous === current.id && !sessionStorage.getItem('ww_recovery_notified')) {
        sessionStorage.setItem('ww_recovery_notified','1');
        setTimeout(()=>toast(`Timer recovered: ${current.title}`),250);
      }
    } else {
      localStorage.removeItem(key); sessionStorage.removeItem('ww_recovery_notified');
    }
  }

  function connectionBanner(offline) {
    let el=document.getElementById('wwConnectionBanner');
    if (!offline) { el?.remove(); return; }
    if (!el) { el=document.createElement('div'); el.id='wwConnectionBanner'; el.className='suite-offline'; el.textContent='Offline — your visible timer keeps running, but actions will sync only after connection returns.'; document.body.appendChild(el); }
  }
  window.addEventListener('offline',()=>connectionBanner(true));
  window.addEventListener('online',()=>{connectionBanner(false);toast('Back online. WorkWatch is connected again.');});
  connectionBanner(!navigator.onLine);

  async function compressImage(file) {
    const pref = suite.preferences || defaultPreferences();
    if (!pref.compression_enabled || !file?.type?.startsWith('image/')) return {blob:file,ext:(file.name.split('.').pop()||'jpg').toLowerCase(),type:file.type};
    try {
      const bitmap = await createImageBitmap(file);
      const max = Number(pref.max_image_width || 1920);
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const width=Math.max(1,Math.round(bitmap.width*scale)), height=Math.max(1,Math.round(bitmap.height*scale));
      const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
      canvas.getContext('2d').drawImage(bitmap,0,0,width,height); bitmap.close?.();
      const blob = await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Compression failed')),'image/webp',Number(pref.image_quality||0.84)));
      return {blob,ext:'webp',type:'image/webp'};
    } catch { return {blob:file,ext:(file.name.split('.').pop()||'jpg').toLowerCase(),type:file.type}; }
  }

  uploadEvidence = async function(file, entryId, stage) {
    if (file.size > 10*1024*1024) throw new Error('Screenshot must be 10 MB or smaller.');
    const processed = await compressImage(file);
    const stable = stage === 'before' || stage === 'after';
    const path = `${state.profile.id}/${entryId}/${stable?stage:`${stage}-${Date.now()}`}.${processed.ext}`;
    const finalPath = stable ? `${state.profile.id}/${entryId}/${stage}.${processed.ext}` : path;
    const { error } = await sb.storage.from('evidence').upload(finalPath,processed.blob,{upsert:true,contentType:processed.type});
    if (error) throw error;
    return finalPath;
  };

  function historyRow(entry) {
    const locked = !!entry.locked_at;
    const tags=[entry.client_label,entry.project_label].filter(Boolean).map(x=>`<span class="suite-tag">${esc(x)}</span>`).join('');
    return `<tr data-history-row="${entry.id}"><td><div class="td-main">${esc(entry.title)}</div><div class="td-sub">${esc(entry.notes||'')}</div><div class="suite-tags">${tags}</div></td><td>${fmtDate(entry.started_at)}</td><td>${fmtTime(entry.started_at)}</td><td>${fmtTime(entry.ended_at)}</td><td class="mono">${fmtDuration(breakMsFor(entry))}</td><td class="mono">${fmtDuration(recordedMsFor(entry))}</td><td><button class="btn btn-sm" data-evidence="${entry.id}">${esc(evidenceStatus(entry))}</button></td><td>${suite.auditEntryIds.has(entry.id)?'<span class="suite-edited">Edited</span>':''}${locked?`<span class="suite-locked">Locked · ${esc(entry.locked_report_code||'Finalized')}</span>`:''}</td><td class="history-actions-cell"><button class="btn btn-sm" data-continue-entry="${entry.id}">Continue</button>${entry.status==='completed'&&!locked?`<button class="btn btn-sm" data-edit-entry="${entry.id}">Edit</button>`:''}</td></tr>`;
  }

  function renderSuiteHistory() {
    page().innerHTML = head('Work History','Search, filter, continue, edit, or delete your personal work records.',`<button class="btn" id="historyBackupShortcut">Backup</button>`)+`
      <section class="panel suite-filter-panel"><div class="panel-body suite-filter-grid">
        <div class="field"><label>Search</label><input class="input" id="historySearch" placeholder="Task, notes, client, project"></div>
        <div class="field"><label>Client</label><select class="select" id="historyClient"><option value="">All clients</option>${unique(ownEntries().map(e=>e.client_label)).map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>
        <div class="field"><label>Project</label><select class="select" id="historyProject"><option value="">All projects</option>${unique(ownEntries().map(e=>e.project_label)).map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>
        <div class="field"><label>Evidence</label><select class="select" id="historyEvidence"><option value="">Any</option><option value="verified">Verified</option><option value="during">Has During</option><option value="noduring">No During</option></select></div>
        <div class="field"><label>From</label><input class="input" id="historyFrom" type="date"></div>
        <div class="field"><label>To</label><input class="input" id="historyTo" type="date"></div>
        <label class="suite-check"><input type="checkbox" id="historyEdited"> Edited only</label>
        <label class="suite-check"><input type="checkbox" id="historyLocked"> Finalized only</label>
      </div></section>
      <section class="panel"><div class="panel-body" style="padding:0"><div class="table-wrap"><table class="table suite-history-table"><thead><tr><th>Task</th><th>Date</th><th>Start</th><th>End</th><th>Break</th><th>Recorded</th><th>Evidence</th><th>Record</th><th>Actions</th></tr></thead><tbody id="historyBody"></tbody></table></div></div></section>`;
    const apply = () => {
      const q=(document.getElementById('historySearch')?.value||'').trim().toLowerCase(), client=document.getElementById('historyClient')?.value||'', project=document.getElementById('historyProject')?.value||'', ev=document.getElementById('historyEvidence')?.value||'', from=document.getElementById('historyFrom')?.value, to=document.getElementById('historyTo')?.value, edited=document.getElementById('historyEdited')?.checked, locked=document.getElementById('historyLocked')?.checked;
      const rows=ownEntries().filter(e=>{
        const hay=[e.title,e.notes,e.client_label,e.project_label].join(' ').toLowerCase();
        if(q&&!hay.includes(q))return false; if(client&&e.client_label!==client)return false; if(project&&e.project_label!==project)return false;
        if(from&&dateKey(e.started_at)<from)return false; if(to&&dateKey(e.started_at)>to)return false; if(edited&&!suite.auditEntryIds.has(e.id))return false; if(locked&&!e.locked_at)return false;
        const count=(e.during_evidence||[]).length; if(ev==='verified'&&!(e.before_url&&e.after_url))return false; if(ev==='during'&&count<1)return false; if(ev==='noduring'&&count>0)return false; return true;
      });
      document.getElementById('historyBody').innerHTML=rows.map(historyRow).join('')||'<tr><td colspan="9"><div class="empty"><strong>No matching records</strong><span>Try changing your filters.</span></div></td></tr>';
      bindHistoryActions(); bindEvidenceButtons();
    };
    ['historySearch','historyClient','historyProject','historyEvidence','historyFrom','historyTo','historyEdited','historyLocked'].forEach(id=>document.getElementById(id)?.addEventListener(id==='historySearch'?'input':'change',apply));
    document.getElementById('historyBackupShortcut').onclick=()=>{state.view='settings';renderShell();setTimeout(()=>document.getElementById('createBackup')?.focus(),20);};
    apply();
  }

  function bindHistoryActions() {
    document.querySelectorAll('[data-continue-entry]').forEach(btn=>btn.onclick=()=>useEntryAsNew(btn.dataset.continueEntry));
    document.querySelectorAll('[data-edit-entry]').forEach(btn=>btn.onclick=()=>openSuiteEditModal(btn.dataset.editEntry));
  }
  function useEntryAsNew(id) {
    const e=ownEntries().find(x=>x.id===id); if(!e)return;
    sessionStorage.setItem('ww_task_prefill',JSON.stringify({title:e.title,notes:e.notes,client_label:e.client_label,project_label:e.project_label}));
    state.view='dashboard'; renderShell(); toast('Task details copied. Add a new Before screenshot to start.');
  }

  function openSuiteEditModal(id) {
    const e=ownEntries().find(x=>x.id===id); if(!e||e.status!=='completed')return;
    if(e.locked_at)return toast(`This record is locked by ${e.locked_report_code||'a finalized report'}.`,'error');
    const local = v=>{const d=new Date(v),x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,16);};
    const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal edit-modal"><div class="modal-head"><div><h3>Edit work record</h3><p>Changes are recorded in Edit History.</p></div><button class="modal-close">×</button></div><form class="modal-body suite-edit-form" id="suiteEditForm"><div class="field"><label>Task</label><input class="input" id="suiteEditTitle" maxlength="120" value="${esc(e.title)}" required></div><div class="field"><label>Notes</label><textarea class="textarea" id="suiteEditNotes" maxlength="500">${esc(e.notes||'')}</textarea></div><div class="edit-time-grid"><div class="field"><label>Client</label><input class="input" id="suiteEditClient" value="${esc(e.client_label||'')}"></div><div class="field"><label>Project</label><input class="input" id="suiteEditProject" value="${esc(e.project_label||'')}"></div><div class="field"><label>Start</label><input class="input" id="suiteEditStart" type="datetime-local" value="${local(e.started_at)}" required></div><div class="field"><label>End</label><input class="input" id="suiteEditEnd" type="datetime-local" value="${local(e.ended_at)}" required></div></div><div class="task-actions"><button class="btn modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save correction</button></div></form></div>`;
    const close=()=>wrap.remove();wrap.onclick=ev=>{if(ev.target===wrap||ev.target.classList.contains('modal-close')||ev.target.classList.contains('modal-cancel'))close();};
    wrap.querySelector('#suiteEditForm').onsubmit=async ev=>{ev.preventDefault();const start=new Date(document.getElementById('suiteEditStart').value),end=new Date(document.getElementById('suiteEditEnd').value);if(end<=start)return toast('End time must be after start time.','error');if(end-start<=breakMsFor(e))return toast('Time range must be longer than recorded break time.','error');const b=ev.submitter;b.disabled=true;b.textContent='Saving…';const {error}=await sb.from('work_entries').update({title:document.getElementById('suiteEditTitle').value.trim(),notes:document.getElementById('suiteEditNotes').value.trim(),client_label:document.getElementById('suiteEditClient').value.trim(),project_label:document.getElementById('suiteEditProject').value.trim(),started_at:start.toISOString(),ended_at:end.toISOString()}).eq('id',e.id).eq('employee_id',state.profile.id);if(error){b.disabled=false;b.textContent='Save correction';return toast(error.message,'error');}close();await loadWorkspace();toast('Work record updated and logged.');};document.body.appendChild(wrap);
  }

  function renderCalendar() {
    const month=suite.calendarMonth, y=month.getFullYear(), m=month.getMonth(), first=new Date(y,m,1), days=new Date(y,m+1,0).getDate(), mondayOffset=(first.getDay()+6)%7;
    const byDate=new Map(); ownEntries().forEach(e=>{const k=dateKey(e.started_at);if(!byDate.has(k))byDate.set(k,[]);byDate.get(k).push(e);});
    const cells=[]; for(let i=0;i<mondayOffset;i++)cells.push('<div class="suite-calendar-cell muted"></div>');
    for(let d=1;d<=days;d++){const k=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, entries=byDate.get(k)||[], total=totalRecorded(entries);cells.push(`<button class="suite-calendar-cell ${entries.length?'has-work':''}" data-calendar-date="${k}"><span class="suite-calendar-day">${d}</span>${entries.length?`<strong>${fmtDuration(total)}</strong><small>${entries.length} task${entries.length===1?'':'s'}</small>`:''}</button>`);}
    page().innerHTML=head('Calendar','Monthly view of your recorded work and daily totals.',`<button class="btn" id="calPrev">←</button><button class="btn" id="calToday">Today</button><button class="btn" id="calNext">→</button>`)+`<section class="panel"><div class="panel-head"><div class="panel-title">${month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</div></div><div class="panel-body"><div class="suite-calendar-week"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="suite-calendar">${cells.join('')}</div></div></section><section class="panel suite-calendar-detail" id="calendarDetail"><div class="panel-body"><div class="empty"><strong>Select a date</strong><span>Click a day to view its tasks.</span></div></div></section>`;
    document.getElementById('calPrev').onclick=()=>{suite.calendarMonth=new Date(y,m-1,1);renderCalendar();}; document.getElementById('calNext').onclick=()=>{suite.calendarMonth=new Date(y,m+1,1);renderCalendar();}; document.getElementById('calToday').onclick=()=>{const n=new Date();suite.calendarMonth=new Date(n.getFullYear(),n.getMonth(),1);renderCalendar();};
    document.querySelectorAll('[data-calendar-date]').forEach(btn=>btn.onclick=()=>{const entries=byDate.get(btn.dataset.calendarDate)||[];document.getElementById('calendarDetail').innerHTML=`<div class="panel-head"><div><div class="panel-title">${new Date(`${btn.dataset.calendarDate}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div><div class="panel-desc">${fmtDuration(totalRecorded(entries))} recorded</div></div></div><div class="panel-body" style="padding:0">${entries.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Client / Project</th><th>Start</th><th>End</th><th>Recorded</th></tr></thead><tbody>${entries.map(e=>`<tr><td class="td-main">${esc(e.title)}</td><td>${esc([e.client_label,e.project_label].filter(Boolean).join(' · ')||'—')}</td><td>${fmtTime(e.started_at)}</td><td>${fmtTime(e.ended_at)}</td><td class="mono">${fmtDuration(recordedMsFor(e))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><strong>No work recorded</strong></div>'}</div>`;});
  }

  function renderTemplates() {
    page().innerHTML=head('Task Templates','Save recurring work and start it without retyping the details.',`<button class="btn btn-primary" id="newTemplate">New template</button>`)+`<section class="panel"><div class="panel-body" style="padding:0">${suite.templates.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Template</th><th>Client</th><th>Project</th><th>Actions</th></tr></thead><tbody>${suite.templates.map(t=>`<tr><td><div class="td-main">${esc(t.title)}</div><div class="td-sub">${esc(t.notes||'')}</div></td><td>${esc(t.client_label||'—')}</td><td>${esc(t.project_label||'—')}</td><td><button class="btn btn-sm btn-primary" data-use-template="${t.id}">Use</button> <button class="btn btn-sm" data-delete-template="${t.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><strong>No templates yet</strong><span>Create one for recurring VA tasks.</span></div>'}</div></section>`;
    document.getElementById('newTemplate').onclick=()=>openTemplateModal();
    document.querySelectorAll('[data-use-template]').forEach(b=>b.onclick=()=>{const t=suite.templates.find(x=>x.id===b.dataset.useTemplate);if(!t)return;sessionStorage.setItem('ww_task_prefill',JSON.stringify(t));sb.from('task_templates').update({last_used_at:new Date().toISOString()}).eq('id',t.id).then(()=>{});state.view='dashboard';renderShell();});
    document.querySelectorAll('[data-delete-template]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this task template?'))return;const {error}=await sb.from('task_templates').delete().eq('id',b.dataset.deleteTemplate);if(error)return toast(error.message,'error');await refreshSuiteData();renderTemplates();toast('Template deleted.');});
  }

  function openTemplateModal() {
    const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal"><div class="modal-head"><div><h3>New task template</h3><p>Reusable task details. Screenshot proof is still required when you start.</p></div><button class="modal-close">×</button></div><form class="modal-body suite-edit-form" id="newTemplateForm"><div class="field"><label>Task name</label><input class="input" id="tplTitle" maxlength="120" required></div><div class="field"><label>Notes</label><textarea class="textarea" id="tplNotes" maxlength="500"></textarea></div><div class="edit-time-grid"><div class="field"><label>Client</label><input class="input" id="tplClient"></div><div class="field"><label>Project</label><input class="input" id="tplProject"></div></div><div class="task-actions"><button class="btn modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save template</button></div></form></div>`;const close=()=>wrap.remove();wrap.onclick=e=>{if(e.target===wrap||e.target.classList.contains('modal-close')||e.target.classList.contains('modal-cancel'))close();};wrap.querySelector('form').onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('task_templates').insert({user_id:state.profile.id,title:document.getElementById('tplTitle').value.trim(),notes:document.getElementById('tplNotes').value.trim(),client_label:document.getElementById('tplClient').value.trim(),project_label:document.getElementById('tplProject').value.trim(),favorite:true});if(error)return toast(error.message,'error');close();await refreshSuiteData();renderTemplates();toast('Template saved.');};document.body.appendChild(wrap);
  }

  function getPresetRange(preset) {
    const now=new Date(); if(preset==='today')return[new Date(now.getFullYear(),now.getMonth(),now.getDate()),endOfDay(now)];
    if(preset==='last_week'){const s=startOfWeek(now),ls=new Date(s);ls.setDate(ls.getDate()-7);return[ls,new Date(s.getTime()-1)];}
    if(preset==='month')return[new Date(now.getFullYear(),now.getMonth(),1),endOfDay(new Date(now.getFullYear(),now.getMonth()+1,0))];
    const s=startOfWeek(now),e=new Date(s);e.setDate(e.getDate()+6);return[s,endOfDay(e)];
  }

  function renderSuiteReports() {
    page().innerHTML=head('Reports','Build, export, and finalize the exact work period you want to send.')+`<section class="panel suite-filter-panel"><div class="panel-body"><div class="report-presets"><button class="btn suite-report-preset btn-primary" data-report-preset="this_week">This Week</button><button class="btn suite-report-preset" data-report-preset="today">Today</button><button class="btn suite-report-preset" data-report-preset="last_week">Last Week</button><button class="btn suite-report-preset" data-report-preset="month">This Month</button></div><div class="suite-filter-grid suite-report-filters"><div class="field"><label>From</label><input class="input" type="date" id="reportFrom"></div><div class="field"><label>To</label><input class="input" type="date" id="reportTo"></div><div class="field"><label>Client</label><select class="select" id="reportClient"><option value="">All clients</option>${unique(ownEntries().map(e=>e.client_label)).map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div class="field"><label>Project</label><select class="select" id="reportProject"><option value="">All projects</option>${unique(ownEntries().map(e=>e.project_label)).map(x=>`<option>${esc(x)}</option>`).join('')}</select></div></div></div></section><div id="suiteReportResult"></div>`;
    const setRange=p=>{const [s,e]=getPresetRange(p);document.getElementById('reportFrom').value=dateKey(s);document.getElementById('reportTo').value=dateKey(e);document.querySelectorAll('[data-report-preset]').forEach(b=>b.classList.toggle('btn-primary',b.dataset.reportPreset===p));renderResult();};
    const renderResult=()=>{const from=document.getElementById('reportFrom').value,to=document.getElementById('reportTo').value,client=document.getElementById('reportClient').value,project=document.getElementById('reportProject').value;const entries=ownEntries().filter(e=>(!from||dateKey(e.started_at)>=from)&&(!to||dateKey(e.started_at)<=to)&&(!client||e.client_label===client)&&(!project||e.project_label===project));const finalizable=entries.filter(e=>e.status==='completed'&&!e.locked_at);document.getElementById('suiteReportResult').innerHTML=`<div class="grid metrics">${metric('Entries',entries.length,'Selected period')}${metric('Recorded',fmtDuration(totalRecorded(entries)),'Breaks excluded')}${metric('Break',fmtDuration(totalBreak(entries)),'Excluded')}${metric('Verified',entries.filter(e=>e.before_url&&e.after_url).length,'Before + After')}</div><section class="panel"><div class="panel-head"><div><div class="panel-title">Selected records</div><div class="panel-desc">${from||'—'} to ${to||'—'}</div></div><div class="page-actions"><button class="btn" id="reportCsv" ${entries.length?'':'disabled'}>CSV</button><button class="btn" id="reportPdf" ${entries.length?'':'disabled'}>Export PDF</button><button class="btn btn-primary" id="finalizeReport" ${finalizable.length?'':'disabled'}>Finalize ${finalizable.length||''}</button></div></div><div class="panel-body" style="padding:0">${entries.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Client / Project</th><th>Date</th><th>Recorded</th><th>Record</th></tr></thead><tbody>${entries.map(e=>`<tr><td class="td-main">${esc(e.title)}</td><td>${esc([e.client_label,e.project_label].filter(Boolean).join(' · ')||'—')}</td><td>${fmtDate(e.started_at)}</td><td class="mono">${fmtDuration(recordedMsFor(e))}</td><td>${e.locked_at?`<span class="suite-locked">${esc(e.locked_report_code||'Finalized')}</span>`:'Draft'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><strong>No records in this range</strong></div>'}</div></section>`;
      document.getElementById('reportCsv')?.addEventListener('click',()=>exportSuiteCsv(entries,from,to));
      document.getElementById('reportPdf')?.addEventListener('click',()=>exportReport(entries,state.profile.full_name));
      document.getElementById('finalizeReport')?.addEventListener('click',()=>finalizeReport(finalizable,from,to));};
    document.querySelectorAll('[data-report-preset]').forEach(b=>b.onclick=()=>setRange(b.dataset.reportPreset));['reportFrom','reportTo','reportClient','reportProject'].forEach(id=>document.getElementById(id).onchange=renderResult);setRange('this_week');
  }

  function exportSuiteCsv(entries, from, to) {
    const rows=[['Task','Notes','Client','Project','Date','Start','End','Break','Recorded','During Evidence','Status'],...entries.map(e=>[e.title,e.notes||'',e.client_label||'',e.project_label||'',fmtDate(e.started_at),fmtTime(e.started_at),fmtTime(e.ended_at),fmtDuration(breakMsFor(e)),fmtDuration(recordedMsFor(e)),(e.during_evidence||[]).length,e.status])];
    const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');download(`${slug(state.profile.full_name)}_WorkWatch_${from||dateKey(new Date())}_${to||dateKey(new Date())}.csv`,csv,'text/csv');
  }

  function snapshotEntry(e) {
    return {id:e.id,title:e.title,notes:e.notes||'',client_label:e.client_label||'',project_label:e.project_label||'',status:e.status,started_at:e.started_at,ended_at:e.ended_at,break_seconds:Number(e.break_seconds||0),before_path:e.before_path||null,after_path:e.after_path||null,during_evidence:(e.during_evidence||[]).map(x=>({id:x.id,path:x.path,captured_at:x.captured_at,caption:x.caption||''}))};
  }
  function summariesFor(from,to) { return suite.summaries.filter(s=>(!from||s.summary_date>=from)&&(!to||s.summary_date<=to)); }
  function buildSnapshot(entries,from,to) { return {version:2,profile:{name:state.profile.full_name},period:{from,to},created_at:new Date().toISOString(),entries:entries.map(snapshotEntry),daily_summaries:summariesFor(from,to),preferences:{workday_target_minutes:suite.preferences?.workday_target_minutes||0}}; }

  async function finalizeReport(entries, from, to) {
    if (!entries.length) return;
    const title = prompt('Report title','WorkWatch Time Record'); if (title===null)return;
    if (!confirm(`Finalize and lock ${entries.length} work record${entries.length===1?'':'s'}? Finalized entries cannot be edited or deleted.`)) return;
    const { data, error } = await sb.rpc('finalize_personal_report',{p_title:title||'WorkWatch Time Record',p_period_start:from||dateKey(entries[entries.length-1].started_at),p_period_end:to||dateKey(entries[0].started_at),p_entry_ids:entries.map(e=>e.id),p_snapshot:buildSnapshot(entries,from,to)});
    if (error) return toast(error.message,'error');
    await loadWorkspace(); state.view='finalized'; renderShell(); toast(`Finalized ${data.report_code}.`);
  }

  function renderFinalized() {
    page().innerHTML=head('Finalized Reports','Locked report snapshots, submission history, and secure client share links.')+`${suite.reports.length?suite.reports.map(r=>{const subs=suite.submissions.filter(s=>s.report_id===r.id),activeShare=r.share_token&&!r.share_revoked_at&&(!r.share_expires_at||new Date(r.share_expires_at)>new Date());return `<section class="panel suite-final-report"><div class="panel-head"><div><div class="panel-title">${esc(r.title)}</div><div class="panel-desc">${esc(r.report_code)} · ${r.period_start} – ${r.period_end} · Finalized ${new Date(r.finalized_at).toLocaleString()}</div></div><div class="page-actions"><button class="btn" data-print-final="${r.id}">Print</button><button class="btn" data-submit-final="${r.id}">Mark submitted</button>${activeShare?`<button class="btn" data-copy-share="${r.id}">Copy share link</button><button class="btn btn-danger-outline" data-revoke-share="${r.id}">Revoke link</button>`:`<button class="btn btn-primary" data-share-final="${r.id}">Create share link</button>`}</div></div><div class="panel-body"><div class="suite-final-meta"><span><strong>${(r.entry_ids||[]).length}</strong> locked entries</span><span><strong>${subs.length}</strong> submission${subs.length===1?'':'s'}</span><span>${activeShare?`Share ${r.share_expires_at?`expires ${new Date(r.share_expires_at).toLocaleDateString()}`:'has no expiry'}`:'No active share link'}</span></div>${subs.length?`<div class="suite-submission-list">${subs.slice(0,5).map(s=>`<div><strong>${new Date(s.submitted_at).toLocaleString()}</strong><span>${esc([s.recipient,s.channel].filter(Boolean).join(' · ')||'Submitted')}</span>${s.notes?`<small>${esc(s.notes)}</small>`:''}</div>`).join('')}</div>`:''}</div></section>`;}).join(''):'<section class="panel"><div class="empty"><strong>No finalized reports yet</strong><span>Build a report, then click Finalize to create an immutable snapshot.</span></div></section>'}`;
    document.querySelectorAll('[data-print-final]').forEach(b=>b.onclick=()=>printFinalReport(b.dataset.printFinal));
    document.querySelectorAll('[data-submit-final]').forEach(b=>b.onclick=()=>openSubmissionModal(b.dataset.submitFinal));
    document.querySelectorAll('[data-share-final]').forEach(b=>b.onclick=()=>createShareLink(b.dataset.shareFinal));
    document.querySelectorAll('[data-copy-share]').forEach(b=>b.onclick=()=>copyShareLink(b.dataset.copyShare));
    document.querySelectorAll('[data-revoke-share]').forEach(b=>b.onclick=()=>revokeShareLink(b.dataset.revokeShare));
  }

  function printFinalReport(id) { const r=suite.reports.find(x=>x.id===id);if(!r)return;exportSnapshotReport(r); }

  function openSubmissionModal(reportId) {
    const report=suite.reports.find(x=>x.id===reportId);if(!report)return;const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal"><div class="modal-head"><div><h3>Mark report as submitted</h3><p>${esc(report.report_code)}</p></div><button class="modal-close">×</button></div><form class="modal-body suite-edit-form" id="submissionForm"><div class="field"><label>Recipient</label><input class="input" id="submissionRecipient" placeholder="Client name or email"></div><div class="field"><label>Channel</label><select class="select" id="submissionChannel"><option>Email</option><option>WeChat</option><option>Slack</option><option>Messenger</option><option>Other</option></select></div><div class="field"><label>Notes</label><textarea class="textarea" id="submissionNotes" placeholder="Optional"></textarea></div><div class="task-actions"><button class="btn modal-cancel" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save submission</button></div></form></div>`;const close=()=>wrap.remove();wrap.onclick=e=>{if(e.target===wrap||e.target.classList.contains('modal-close')||e.target.classList.contains('modal-cancel'))close();};wrap.querySelector('form').onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('report_submissions').insert({report_id:reportId,user_id:state.profile.id,recipient:document.getElementById('submissionRecipient').value.trim(),channel:document.getElementById('submissionChannel').value,notes:document.getElementById('submissionNotes').value.trim()});if(error)return toast(error.message,'error');close();await refreshSuiteData();renderFinalized();toast('Submission saved.');};document.body.appendChild(wrap);
  }

  function randomToken() { return `${crypto.randomUUID().replaceAll('-','')}${crypto.randomUUID().replaceAll('-','')}`; }
  async function createShareLink(id) {
    const hours = prompt('Share link expiry in hours (24, 168, 720). Leave blank for no expiry.','168'); if(hours===null)return; const n=hours.trim()?Number(hours):0;if(hours.trim()&&(!Number.isFinite(n)||n<=0))return toast('Enter a valid number of hours.','error');const token=randomToken(),expires=n?new Date(Date.now()+n*3600000).toISOString():null;const {error}=await sb.from('finalized_reports').update({share_token:token,share_expires_at:expires,share_revoked_at:null}).eq('id',id);if(error)return toast(error.message,'error');await refreshSuiteData();await navigator.clipboard?.writeText(`${location.origin}${location.pathname}?share=${token}`);renderFinalized();toast('Secure share link created and copied.');
  }
  async function copyShareLink(id) { const r=suite.reports.find(x=>x.id===id);if(!r?.share_token)return;await navigator.clipboard?.writeText(`${location.origin}${location.pathname}?share=${r.share_token}`);toast('Share link copied.'); }
  async function revokeShareLink(id) { if(!confirm('Revoke this client share link?'))return;const {error}=await sb.from('finalized_reports').update({share_revoked_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message,'error');await refreshSuiteData();renderFinalized();toast('Share link revoked.'); }

  function renderSettings() {
    const p=suite.preferences||defaultPreferences();page().innerHTML=head('Settings','Personal targets, image compression, and full WorkWatch backup / restore.')+`<div class="grid split"><section class="panel"><div class="panel-head"><div><div class="panel-title">Workday & screenshot settings</div><div class="panel-desc">Stored in your WorkWatch account.</div></div></div><div class="panel-body suite-settings-form"><div class="field"><label>Daily target (minutes)</label><input class="input" id="targetMinutes" type="number" min="0" max="1440" value="${Number(p.workday_target_minutes||0)}"></div><label class="suite-check"><input type="checkbox" id="compressionEnabled" ${p.compression_enabled?'checked':''}> Compress screenshots before upload</label><div class="field"><label>Maximum image dimension</label><select class="select" id="maxImageWidth"><option value="1280" ${Number(p.max_image_width)===1280?'selected':''}>1280 px</option><option value="1920" ${Number(p.max_image_width)===1920?'selected':''}>1920 px</option><option value="2560" ${Number(p.max_image_width)===2560?'selected':''}>2560 px</option></select></div><div class="field"><label>Compression quality</label><input class="input" id="imageQuality" type="number" min="0.4" max="1" step="0.05" value="${Number(p.image_quality||0.84)}"></div><button class="btn btn-primary" id="saveSuiteSettings">Save settings</button></div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Backup & restore</div><div class="panel-desc">Full JSON backup includes database records and embedded screenshot files. Large histories can create large files.</div></div></div><div class="panel-body"><div class="suite-backup-actions"><button class="btn btn-primary" id="createBackup">Create full backup</button><label class="btn" for="restoreBackup">Restore backup</label><input id="restoreBackup" type="file" accept="application/json,.json" hidden></div><p class="panel-desc">Restore skips currently existing record IDs and never restores an active timer over your current active task.</p></div></section></div>`;
    document.getElementById('saveSuiteSettings').onclick=saveSettings;document.getElementById('createBackup').onclick=createFullBackup;document.getElementById('restoreBackup').onchange=e=>restoreBackupFile(e.target.files?.[0]);
  }

  async function saveSettings() {
    const payload={user_id:state.profile.id,workday_target_minutes:Math.max(0,Math.min(1440,Number(document.getElementById('targetMinutes').value||0))),compression_enabled:document.getElementById('compressionEnabled').checked,max_image_width:Number(document.getElementById('maxImageWidth').value),image_quality:Number(document.getElementById('imageQuality').value),updated_at:new Date().toISOString()};const {error}=await sb.from('user_preferences').upsert(payload,{onConflict:'user_id'});if(error)return toast(error.message,'error');await refreshSuiteData();toast('Settings saved.');
  }

  const blobToDataUrl = blob => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
  async function evidenceDataUrl(url) { if(!url)return null;const res=await fetch(url);if(!res.ok)throw new Error('Could not fetch evidence');return blobToDataUrl(await res.blob()); }

  async function createFullBackup() {
    const button=document.getElementById('createBackup');if(button){button.disabled=true;button.textContent='Building backup…';}
    try {
      const entries=ownEntries(), files={};
      for(let i=0;i<entries.length;i++){
        const e=entries[i], pairs=[[e.before_path,e.before_url],[e.after_path,e.after_url],...(e.during_evidence||[]).map(x=>[x.path,x.url])];
        for(const [path,url] of pairs){if(path&&url&&!files[path]){try{files[path]=await evidenceDataUrl(url);}catch{files[path]=null;}}}
        if(button)button.textContent=`Backing up ${i+1}/${entries.length}…`;
      }
      const backup={format:'WorkWatchFullBackup',version:2,created_at:new Date().toISOString(),profile:{name:state.profile.full_name,user_id:state.profile.id},entries:entries.map(snapshotEntry),evidence_files:files,templates:suite.templates,daily_summaries:suite.summaries,preferences:suite.preferences,finalized_reports:suite.reports,submissions:suite.submissions};
      download(`WorkWatch_Full_Backup_${dateKey(new Date())}.json`,JSON.stringify(backup),'application/json');toast('Full backup created.');
    } catch(error){toast(error.message||'Could not create backup.','error');} finally {if(button&&document.body.contains(button)){button.disabled=false;button.textContent='Create full backup';}}
  }

  function dataUrlToBlob(dataUrl) { const [meta,data]=dataUrl.split(',');const mime=(meta.match(/data:([^;]+)/)||[])[1]||'application/octet-stream';const bytes=atob(data),arr=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);return new Blob([arr],{type:mime}); }
  function rewritePath(path, uid) { if(!path)return path;const parts=String(path).split('/');parts[0]=uid;return parts.join('/'); }
  function rewriteSnapshotPaths(snapshot,uid){const copy=structuredClone(snapshot||{});for(const e of copy.entries||[]){e.before_path=rewritePath(e.before_path,uid);e.after_path=rewritePath(e.after_path,uid);for(const d of e.during_evidence||[])d.path=rewritePath(d.path,uid);}return copy;}

  async function restoreBackupFile(file) {
    if(!file)return; if(!confirm('Restore this WorkWatch backup? Existing records with the same IDs are skipped.'))return;
    try {
      const backup=JSON.parse(await file.text());if(backup.format!=='WorkWatchFullBackup')throw new Error('This is not a WorkWatch full backup.');const uid=state.profile.id,org=await ensurePersonalOrg(),files=backup.evidence_files||{},pathMap=new Map();
      for(const [oldPath,dataUrl] of Object.entries(files)){if(!dataUrl)continue;const newPath=rewritePath(oldPath,uid);pathMap.set(oldPath,newPath);const blob=dataUrlToBlob(dataUrl);const {error}=await sb.storage.from('evidence').upload(newPath,blob,{upsert:true,contentType:blob.type});if(error)console.warn('Restore evidence:',error.message);}
      const existing=new Set(ownEntries().map(e=>e.id));for(const source of backup.entries||[]){if(existing.has(source.id)||source.status!=='completed')continue;const row={id:source.id,organization_id:org.id,employee_id:uid,title:source.title,notes:source.notes||'',client_label:source.client_label||'',project_label:source.project_label||'',status:'completed',started_at:source.started_at,ended_at:source.ended_at,break_seconds:Number(source.break_seconds||0),before_path:pathMap.get(source.before_path)||rewritePath(source.before_path,uid),after_path:pathMap.get(source.after_path)||rewritePath(source.after_path,uid)};const {error}=await sb.from('work_entries').insert(row);if(error){console.warn('Restore entry:',error.message);continue;}for(const d of source.during_evidence||[]){await sb.from('work_entry_during_evidence').upsert({id:d.id,work_entry_id:source.id,user_id:uid,path:pathMap.get(d.path)||rewritePath(d.path,uid),captured_at:d.captured_at,caption:d.caption||''},{onConflict:'work_entry_id,path'});}}
      for(const t of backup.templates||[])await sb.from('task_templates').upsert({...t,user_id:uid},{onConflict:'id'});for(const s of backup.daily_summaries||[])await sb.from('daily_summaries').upsert({...s,user_id:uid},{onConflict:'user_id,summary_date'});if(backup.preferences)await sb.from('user_preferences').upsert({...backup.preferences,user_id:uid},{onConflict:'user_id'});
      for(const r of backup.finalized_reports||[]){const restored={...r,user_id:uid,snapshot:rewriteSnapshotPaths(r.snapshot,uid)};const {error}=await sb.from('finalized_reports').upsert(restored,{onConflict:'id'});if(error)console.warn('Restore report:',error.message);}for(const s of backup.submissions||[])await sb.from('report_submissions').upsert({...s,user_id:uid},{onConflict:'id'});
      await loadWorkspace();toast('Backup restore completed.');
    } catch(error){toast(error.message||'Could not restore backup.','error');}
  }

  showEvidence = function(id) {
    const entry=ownEntries().find(x=>x.id===id)||(state.entries||[]).find(x=>x.id===id);if(!entry)return;const during=entry.during_evidence||[];
    const card=(label,time,url,extra='')=>`<figure class="proof-card suite-proof-card"><figcaption><strong>${label}</strong><span>${time||'—'}</span></figcaption>${url?`<img src="${esc(url)}" alt="${esc(label)} work evidence">`:'<div class="proof-missing">Evidence unavailable</div>'}${extra}</figure>`;
    const cards=[card('Before',fmtTime(entry.started_at),entry.before_url),...during.map((d,i)=>card(`During ${i+1}`,d.captured_at?fmtTime(d.captured_at):'—',d.url,`<div class="suite-caption-editor"><textarea class="textarea" data-caption-input="${d.id}" placeholder="Add evidence caption…">${esc(d.caption||'')}</textarea><button class="btn btn-sm" data-save-caption="${d.id}">Save caption</button></div>`)),card('After',entry.ended_at?fmtTime(entry.ended_at):'Pending',entry.after_url)];
    const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal modal-wide"><div class="modal-head"><div><h3>${esc(entry.title)}</h3><p>${fmtDate(entry.started_at)} · ${during.length} During evidence${during.length===1?'':'s'}</p></div><button class="modal-close">×</button></div><div class="modal-body"><div class="evidence-triplet multi-evidence-grid">${cards.join('')}</div></div></div>`;wrap.onclick=e=>{if(e.target===wrap||e.target.classList.contains('modal-close'))wrap.remove();};wrap.querySelectorAll('[data-save-caption]').forEach(b=>b.onclick=async()=>{const id=b.dataset.saveCaption,caption=wrap.querySelector(`[data-caption-input="${id}"]`).value.trim();b.disabled=true;const {error}=await sb.from('work_entry_during_evidence').update({caption}).eq('id',id).eq('user_id',state.profile.id);b.disabled=false;if(error)return toast(error.message,'error');const item=(entry.during_evidence||[]).find(x=>x.id===id);if(item)item.caption=caption;toast('Evidence caption saved.');});document.body.appendChild(wrap);
  };

  function reportRowsHtml(entries) {
    return entries.map((e,i)=>`<tr><td>${i+1}</td><td>${fmtDate(e.started_at)}</td><td><strong>${esc(e.title)}</strong>${e.notes?`<div class="task-note-inline">${esc(e.notes)}</div>`:''}</td><td>${esc(e.client_label||'—')}</td><td>${esc(e.project_label||'—')}</td><td>${fmtTime(e.started_at)}</td><td>${fmtTime(e.ended_at)}</td><td class="mono">${fmtDuration(breakMsFor(e))}</td><td class="mono">${fmtDuration(recordedMsFor(e))}</td></tr>`).join('');
  }
  function proofCardPrint(label,time,url,caption='') { return `<figure class="proof-card-print"><figcaption><strong>${label}</strong><span>${time||'—'}</span></figcaption><div class="proof-image-print">${url?`<img src="${esc(url)}" alt="${esc(label)} evidence">`:'<div class="proof-empty-print">Not provided</div>'}</div>${caption?`<p class="proof-caption-print">${esc(caption)}</p>`:''}</figure>`; }
  function summariesHtml(summaries) { return (summaries||[]).filter(s=>s.completed_text||s.issues_text||s.next_actions_text).map(s=>`<section class="report-summary-day"><h3>${new Date(`${s.summary_date}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h3>${s.completed_text?`<div><strong>Completed</strong><p>${esc(s.completed_text)}</p></div>`:''}${s.issues_text?`<div><strong>Issues</strong><p>${esc(s.issues_text)}</p></div>`:''}${s.next_actions_text?`<div><strong>Next actions</strong><p>${esc(s.next_actions_text)}</p></div>`:''}</section>`).join(''); }

  function openReportWindow(entries, options={}) {
    if(!entries.length)return toast('No time records available to export.','error');const rows=[...entries].sort((a,b)=>new Date(a.started_at)-new Date(b.started_at)),name=options.name||state.profile?.full_name||'John Mark',from=options.from||dateKey(rows[0].started_at),to=options.to||dateKey(rows[rows.length-1].started_at),reportCode=options.reportCode||`WW-${dateKey(new Date()).replaceAll('-','')}`,summaries=options.summaries||summariesFor(from,to),total=totalRecorded(rows),breakTotal=totalBreak(rows),completed=rows.filter(e=>e.status==='completed').length,verified=rows.filter(e=>e.before_url&&e.after_url).length;
    const proofBlocks=rows.map((e,i)=>`<section class="proof-block"><div class="proof-head"><div><div class="proof-count">TASK ${String(i+1).padStart(2,'0')}</div><h3>${esc(e.title)}</h3><p>${esc([e.client_label,e.project_label].filter(Boolean).join(' · '))}</p></div><div class="proof-time"><span>${fmtDate(e.started_at)}</span><strong>${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}</strong><small>${fmtDuration(recordedMsFor(e))} recorded</small></div></div><div class="proof-grid-print">${proofCardPrint('BEFORE',fmtTime(e.started_at),e.before_url)}${(e.during_evidence||[]).map((d,j)=>proofCardPrint(`DURING ${j+1}`,d.captured_at?fmtTime(d.captured_at):'—',d.url,d.caption||'')).join('')}${proofCardPrint('AFTER',fmtTime(e.ended_at),e.after_url)}</div></section>`).join('');
    const filename=`${slug(name)}_WorkWatch_${from}_to_${to}`;const win=open('','_blank');if(!win)return toast('Allow pop-ups to open the printable record.','error');win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${filename}</title><style>*{box-sizing:border-box}body{margin:0;background:#edf1f5;color:#101828;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.45}@page{size:A4 portrait;margin:10mm}.toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:center;padding:10px;background:#101828}.toolbar button{border:0;border-radius:6px;background:#fff;color:#101828;padding:9px 15px;font-weight:800;cursor:pointer}.sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:11mm 12mm 12mm;box-shadow:0 2px 16px rgba(16,24,40,.09)}.header{display:flex;justify-content:space-between;border-bottom:2px solid #101828;padding-bottom:10px}.brand{font-weight:900;letter-spacing:.16em;font-size:13px}.meta{text-align:right;color:#667085;font-size:8px}.meta strong{display:block;color:#101828;font-size:10px}.record-info{display:grid;grid-template-columns:1.3fr 1fr;border:1px solid #cfd4dc;margin-top:13px}.record-info>div{padding:8px 9px}.record-info>div+div{border-left:1px solid #d9dde4}.label{display:block;color:#667085;font-size:7.5px;text-transform:uppercase;letter-spacing:.09em}.value{font-weight:800;font-size:10px}.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cfd4dc;border-top:0}.summary>div{padding:8px 9px;border-right:1px solid #d9dde4}.summary>div:last-child{border-right:0}.summary strong{display:block;font-size:15px}.section-title{margin:16px 0 6px;font-size:9px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}table{width:100%;border-collapse:collapse;table-layout:auto}th{background:#f2f4f7;border:1px solid #cfd4dc;padding:5px;font-size:6.6px;text-transform:uppercase;text-align:left}td{border:1px solid #d9dde4;padding:5px;vertical-align:top}.mono{font-family:Consolas,monospace;white-space:nowrap}.task-note-inline{color:#667085;font-size:7.5px}.proof-block{margin-top:11px;border:1px solid #cfd4dc;break-inside:avoid}.proof-head{display:flex;justify-content:space-between;padding:8px 9px;border-bottom:1px solid #d9dde4;background:#fafbfc}.proof-count{font-size:7px;font-weight:900;color:#667085}.proof-head h3{font-size:11px;margin:2px 0}.proof-head p{margin:0;color:#667085}.proof-time{text-align:right}.proof-time span,.proof-time small{display:block;color:#667085}.proof-grid-print{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px}.proof-card-print{margin:0;border:1px solid #d9dde4;break-inside:avoid}.proof-card-print figcaption{display:flex;justify-content:space-between;padding:5px 6px;background:#f8fafc;border-bottom:1px solid #e4e7ec;font-size:7.5px}.proof-image-print{height:43mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f7f8fa}.proof-image-print img{width:100%;height:100%;object-fit:contain}.proof-empty-print{color:#98a2b3}.proof-caption-print{margin:0;padding:5px 6px;border-top:1px solid #e4e7ec;color:#475467;font-size:7.5px}.report-summary-day{border:1px solid #d9dde4;padding:8px;margin:7px 0;break-inside:avoid}.report-summary-day h3{margin:0 0 5px}.report-summary-day div{display:grid;grid-template-columns:22mm 1fr;gap:5px}.report-summary-day p{margin:0}.footer{margin-top:12px;border-top:1px solid #e4e7ec;padding-top:6px;color:#98a2b3;font-size:7.5px;text-align:center}@media print{body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.proof-block{break-inside:avoid}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet"><header class="header"><div class="brand">WORKWATCH</div><div class="meta"><strong>${esc(reportCode)}</strong>Generated ${new Date().toLocaleString()}</div></header><section class="record-info"><div><span class="label">VA Name</span><span class="value">${esc(name)}</span></div><div><span class="label">Record Period</span><span class="value">${esc(from)} – ${esc(to)}</span></div></section><section class="summary"><div><span class="label">Recorded Time</span><strong class="mono">${fmtDuration(total)}</strong></div><div><span class="label">Completed Tasks</span><strong>${completed}</strong></div><div><span class="label">Break Time</span><strong class="mono">${fmtDuration(breakTotal)}</strong></div><div><span class="label">Verified Tasks</span><strong>${verified}/${rows.length}</strong></div></section><div class="section-title">Detailed Time Record</div><table><thead><tr><th>#</th><th>Date</th><th>Task</th><th>Client</th><th>Project</th><th>Start</th><th>End</th><th>Break</th><th>Recorded</th></tr></thead><tbody>${reportRowsHtml(rows)}</tbody></table>${summariesHtml(summaries)?`<div class="section-title">Accomplishment Summary</div>${summariesHtml(summaries)}`:''}<div class="section-title">Work Proof</div>${proofBlocks}<footer class="footer">Generated through WorkWatch • Developed by John Mark</footer></main></body></html>`);win.document.close();
  }

  exportReport = function(arr, preparedFor) { const rows=[...(arr||[])];const sorted=[...rows].sort((a,b)=>new Date(a.started_at)-new Date(b.started_at));openReportWindow(rows,{name:preparedFor||state.profile?.full_name,from:sorted.length?dateKey(sorted[0].started_at):dateKey(new Date()),to:sorted.length?dateKey(sorted[sorted.length-1].started_at):dateKey(new Date())}); };

  async function hydrateSnapshotEntries(snapshot) {
    const entries=structuredClone(snapshot.entries||[]);for(const e of entries){e.before_url=await signed(e.before_path);e.after_url=await signed(e.after_path);for(const d of e.during_evidence||[])d.url=await signed(d.path);}return entries;
  }
  async function exportSnapshotReport(report) { const entries=await hydrateSnapshotEntries(report.snapshot||{});openReportWindow(entries,{name:report.snapshot?.profile?.name||state.profile.full_name,from:report.period_start,to:report.period_end,reportCode:report.report_code,summaries:report.snapshot?.daily_summaries||[]}); }

  async function renderSharedPublic(token) {
    app.innerHTML='<main class="suite-share-loading"><strong>Loading shared WorkWatch report…</strong></main>';
    try {
      let supabaseUrl=CONFIG.SUPABASE_URL;if(!supabaseUrl){const r=await fetch('/api/config',{cache:'no-store'});const d=await r.json();supabaseUrl=d.supabaseUrl;}
      const res=await fetch(`${supabaseUrl}/functions/v1/shared-report?token=${encodeURIComponent(token)}`,{cache:'no-store'}),payload=await res.json();if(!res.ok)throw new Error(payload.error||'Shared report unavailable');const r=payload.report,s=r.snapshot||{},entries=s.entries||[];
      const total=entries.reduce((n,e)=>n+Math.max(0,new Date(e.ended_at)-new Date(e.started_at)-Number(e.break_seconds||0)*1000),0);app.innerHTML=`<div class="suite-shared-page"><header><div><div class="brand">WORKWATCH</div><h1>${esc(r.title||'WorkWatch Time Record')}</h1><p>${esc(r.report_code)} · Finalized ${new Date(r.finalized_at).toLocaleString()}</p></div><button class="btn btn-primary" onclick="window.print()">Print / Save PDF</button></header><section class="suite-share-summary"><div><span>VA Name</span><strong>${esc(s.profile?.name||'John Mark')}</strong></div><div><span>Record Period</span><strong>${esc(r.period_start)} – ${esc(r.period_end)}</strong></div><div><span>Recorded Time</span><strong>${fmtDuration(total)}</strong></div><div><span>Tasks</span><strong>${entries.length}</strong></div></section><section class="suite-share-entries">${entries.map((e,i)=>`<article><div class="suite-share-task"><div><small>TASK ${i+1}</small><h2>${esc(e.title)}</h2><p>${esc([e.client_label,e.project_label].filter(Boolean).join(' · '))}</p></div><strong>${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}</strong></div><div class="suite-share-proof-grid">${proofCardPrint('BEFORE',fmtTime(e.started_at),e.before_url)}${(e.during_evidence||[]).map((d,j)=>proofCardPrint(`DURING ${j+1}`,fmtTime(d.captured_at),d.url,d.caption||'')).join('')}${proofCardPrint('AFTER',fmtTime(e.ended_at),e.after_url)}</div></article>`).join('')}</section><footer>Generated through WorkWatch • Developed by John Mark</footer></div>`;
    } catch(error){app.innerHTML=`<main class="suite-share-loading"><strong>Shared report unavailable</strong><p>${esc(error.message)}</p></main>`;}
  }

  const shareToken = new URLSearchParams(location.search).get('share');
  authView = function() { if (shareToken) return renderSharedPublic(shareToken); return baseAuthView(); };
  if (shareToken) renderSharedPublic(shareToken);

  if (state.profile?.role === OWNER_ROLE) refreshSuiteData().then(()=>{recoverTimerState();renderShell();});
})();