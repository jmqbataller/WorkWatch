(() => {
  const OWNER_ROLE = 'system_admin';
  const PERSONAL_ORG_NAME = 'Personal Work Records';
  const REPORT_RANGE_KEY = 'workwatch_report_range';
  const REMINDER_MINUTES_KEY = 'workwatch_proof_reminder_minutes';
  const reminderSeen = new Set();

  const originalRenderPage = renderPage;
  const originalNavFor = navFor;
  const originalTitleFor = titleFor;
  const originalRoleLabel = roleLabel;

  const personalEntries = () => (state.entries || [])
    .filter(e => e.employee_id === state.profile?.id)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  const openEntry = () => personalEntries().find(e => e.status === 'active' || e.status === 'paused');

  const personalDurationMs = (entry, now = new Date()) => {
    if (!entry?.started_at) return 0;
    const end = entry.ended_at ? new Date(entry.ended_at) : now;
    let breakMs = Math.max(0, Number(entry.break_seconds || 0)) * 1000;
    if (entry.status === 'paused' && entry.paused_at) breakMs += Math.max(0, now - new Date(entry.paused_at));
    return Math.max(0, end - new Date(entry.started_at) - breakMs);
  };

  const personalTotalMs = arr => (arr || []).reduce((sum, e) => sum + personalDurationMs(e), 0);
  const breakMsFor = (entry, now = new Date()) => {
    let ms = Math.max(0, Number(entry.break_seconds || 0)) * 1000;
    if (entry.status === 'paused' && entry.paused_at) ms += Math.max(0, now - new Date(entry.paused_at));
    return ms;
  };

  const toInputDateTime = value => {
    if (!value) return '';
    const d = new Date(value);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  const dateKey = value => {
    const d = new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const startOfWeek = date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  };

  const endOfDay = date => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  };

  const getRange = preset => {
    const now = new Date();
    if (preset === 'today') return [new Date(now.getFullYear(), now.getMonth(), now.getDate()), endOfDay(now)];
    if (preset === 'last_week') {
      const thisStart = startOfWeek(now);
      const lastStart = new Date(thisStart);
      lastStart.setDate(lastStart.getDate() - 7);
      return [lastStart, new Date(thisStart.getTime() - 1)];
    }
    const start = startOfWeek(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return [start, endOfDay(end)];
  };

  const filterRange = (entries, start, end) => entries.filter(e => {
    const d = new Date(e.started_at);
    return d >= start && d <= end;
  });

  const evidenceStatus = e => e.before_url && e.after_url
    ? (e.during_url ? 'Before · During · After' : 'Before · After')
    : e.before_url ? 'Before only' : 'No evidence';

  authView = function () {
    state.authMode = 'signin';
    app.innerHTML = `<section class="auth-shell personal-auth">
      <aside class="auth-brand">
        <div class="wordmark"><span class="wordmark-mark">W</span><span>WorkWatch</span></div>
        <div class="auth-message">
          <div class="auth-kicker">Private work record</div>
          <h1>Track time. Keep proof. Send clean records.</h1>
          <p>Your private workspace for task timing, screenshot evidence, and client-ready work records.</p>
          <div class="auth-proof">
            <div class="proof"><strong>Time</strong><span>Task-based records</span></div>
            <div class="proof"><strong>Proof</strong><span>Before · During · After</span></div>
            <div class="proof"><strong>PDF</strong><span>Ready to send</span></div>
          </div>
        </div>
        <div class="auth-foot">Private workspace · Sign-in required</div>
      </aside>
      <main class="auth-main"><div class="auth-card">
        <h2>Welcome back</h2><p>Sign in to your private WorkWatch workspace.</p>
        <form id="authForm">
          <div class="field"><label>Email</label><input class="input" id="email" type="email" autocomplete="email" required></div>
          <div class="field"><label>Password</label><input class="input" id="password" type="password" autocomplete="current-password" minlength="6" required></div>
          <button class="btn btn-primary btn-lg">Sign in</button>
        </form>
      </div></main>
    </section>`;
    document.getElementById('authForm').onsubmit = handleAuth;
  };

  navFor = function (role) {
    if (role !== OWNER_ROLE) return originalNavFor(role);
    return [['dashboard','My Workday','clock'],['history','Work History','report'],['reports','Reports','report'],['audit','Edit History','users']];
  };

  titleFor = function (role, view) {
    if (role === OWNER_ROLE) return ({dashboard:'My Workday',history:'Work History',reports:'Reports',audit:'Edit History'})[view] || 'WorkWatch';
    return originalTitleFor(role, view);
  };

  roleLabel = function (role) {
    if (role === OWNER_ROLE) return 'PERSONAL';
    return originalRoleLabel(role);
  };

  renderPage = function (role) {
    if (role !== OWNER_ROLE) return originalRenderPage(role);
    if (state.view === 'history') return renderPersonalHistory();
    if (state.view === 'reports') return renderPersonalReports();
    if (state.view === 'audit') return renderAuditHistory();
    return renderPersonalDashboard();
  };

  async function ensurePersonalOrg() {
    if (state.orgs?.length) return state.orgs[0];
    const code = `PERSONAL-${Date.now().toString().slice(-6)}`;
    const { data, error } = await sb.from('organizations').insert({ name: PERSONAL_ORG_NAME, code }).select('*').single();
    if (error) throw error;
    state.orgs = [data];
    return data;
  }

  function newPersonalTaskForm() {
    return `<form id="personalStartForm"><div class="form-grid">
      <div class="full field"><label>Task name</label><input class="input" id="taskTitle" maxlength="120" required placeholder="e.g. Website audit"></div>
      <div class="full field"><label>Notes</label><textarea class="textarea" id="taskNotes" maxlength="500" placeholder="What are you working on?"></textarea></div>
      <div class="full upload-box"><strong>Before screenshot</strong><p>Required proof of your starting state.</p><input id="beforeFile" type="file" accept="image/jpeg,image/png,image/webp" required></div>
    </div><div class="task-actions"><button class="btn btn-primary" type="submit">Start task</button></div></form>`;
  }

  function personalActiveForm(entry) {
    const paused = entry.status === 'paused';
    return `<div class="tracker-card ${paused ? 'paused' : 'active'}">
      <div class="tracker-copy"><div class="tracker-state">${paused ? 'On break' : 'Working now'}</div><div class="tracker-task">${esc(entry.title)}</div><div class="tracker-meta">Started ${fmtTime(entry.started_at)}${breakMsFor(entry) ? ` · Break ${fmtDuration(breakMsFor(entry))}` : ''}</div></div>
      <div class="timer" data-active-timer>${fmtDuration(personalDurationMs(entry))}</div>
    </div>
    <div class="personal-timer-actions">${paused ? '<button class="btn btn-primary" id="resumeTask" type="button">Resume task</button>' : '<button class="btn" id="pauseTask" type="button">Pause / Break</button>'}<span class="break-readout" data-break-timer>${breakMsFor(entry) ? `Break ${fmtDuration(breakMsFor(entry))}` : 'No break time'}</span></div>
    <div class="notice"><strong>${esc(entry.notes || 'No notes')}</strong></div>
    <form id="personalDuringForm"><div class="upload-box" style="margin-top:14px"><div class="proof-stage-heading"><div><strong>During screenshot <span class="proof-optional">Optional</span></strong><p>${entry.during_at ? `Saved at ${fmtTime(entry.during_at)}.` : 'Add one work-in-progress screenshot if needed.'}</p></div>${entry.during_url ? `<button class="btn btn-sm" type="button" data-evidence="${entry.id}">View proof</button>` : ''}</div><input id="duringFile" type="file" accept="image/jpeg,image/png,image/webp" ${paused ? 'disabled' : ''}><div class="task-actions proof-stage-actions"><button class="btn" type="submit" ${paused ? 'disabled' : ''}>${entry.during_path ? 'Replace during proof' : 'Save during proof'}</button></div></div></form>
    <form id="personalFinishForm"><div class="upload-box" style="margin-top:14px"><strong>After screenshot</strong><p>Required proof before completing this task.</p><input id="afterFile" type="file" accept="image/jpeg,image/png,image/webp" required ${paused ? 'disabled' : ''}></div><div class="task-actions"><button class="btn btn-primary" type="submit" ${paused ? 'disabled title="Resume the task before finishing"' : ''}>Finish task</button></div></form>`;
  }

  function personalTable(entries, editable = false) {
    if (!entries.length) return '<div class="empty"><strong>No work entries</strong><span>Your tracked tasks will appear here.</span></div>';
    return `<div class="table-wrap"><table class="table personal-table"><thead><tr><th>Task</th><th>Date</th><th>Start</th><th>End</th><th>Break</th><th>Recorded</th><th>Evidence</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>${entries.map(e => `<tr><td><div class="td-main">${esc(e.title)}</div><div class="td-sub">${esc(e.notes || '')}</div></td><td>${fmtDate(e.started_at)}</td><td>${fmtTime(e.started_at)}</td><td>${fmtTime(e.ended_at)}</td><td class="mono">${fmtDuration(breakMsFor(e))}</td><td class="mono">${fmtDuration(personalDurationMs(e))}</td><td>${e.before_url || e.after_url ? `<button class="btn btn-sm" data-evidence="${e.id}">${esc(evidenceStatus(e))}</button>` : '—'}</td>${editable ? `<td><button class="btn btn-sm" data-edit-entry="${e.id}" ${e.status !== 'completed' ? 'disabled' : ''}>Edit</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderPersonalDashboard() {
    const own = personalEntries();
    const current = openEntry();
    const today = own.filter(e => isToday(e.started_at));
    const reminderMinutes = Number(localStorage.getItem(REMINDER_MINUTES_KEY) || 60);
    page().innerHTML = head('My Workday','Track tasks, breaks, and screenshot proof.',`<button class="btn" id="exportToday" ${today.length ? '' : 'disabled'}>Export today</button>`) + `<div class="grid metrics">${metric('Recorded today',fmtDuration(personalTotalMs(today)),'Breaks excluded')}${metric('Completed tasks',today.filter(e=>e.status==='completed').length,'Today')}${metric('Current status',current?(current.status==='paused'?'On break':'Working'):'Idle',current?current.title:'No active task')}${metric('Verified tasks',today.filter(e=>e.before_url&&e.after_url).length,'Before + after')}</div><div class="grid split"><section class="panel"><div class="panel-head"><div><div class="panel-title">Task timer</div><div class="panel-desc">Break time is automatically excluded from your recorded hours.</div></div></div><div class="panel-body">${current?personalActiveForm(current):newPersonalTaskForm()}</div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Today’s activity</div><div class="panel-desc">Your personal work record only.</div></div></div><div class="panel-body" style="padding:0">${personalTable(today)}</div></section></div><section class="panel reminder-panel"><div class="panel-head"><div><div class="panel-title">Proof reminder</div><div class="panel-desc">Remind me to capture a During screenshot while a task is running.</div></div></div><div class="panel-body reminder-settings"><div class="field compact-field"><label>Reminder interval</label><select class="select" id="reminderMinutes"><option value="30" ${reminderMinutes===30?'selected':''}>30 minutes</option><option value="45" ${reminderMinutes===45?'selected':''}>45 minutes</option><option value="60" ${reminderMinutes===60?'selected':''}>60 minutes</option><option value="90" ${reminderMinutes===90?'selected':''}>90 minutes</option></select></div><button class="btn" id="enableNotifications" type="button">Enable browser reminder</button><span class="reminder-status">During proof remains optional.</span></div></section>`;
    document.getElementById('personalStartForm')?.addEventListener('submit', startPersonalTask);
    document.getElementById('personalFinishForm')?.addEventListener('submit', finishPersonalTask);
    document.getElementById('personalDuringForm')?.addEventListener('submit', savePersonalDuring);
    document.getElementById('pauseTask')?.addEventListener('click', pausePersonalTask);
    document.getElementById('resumeTask')?.addEventListener('click', resumePersonalTask);
    document.getElementById('exportToday')?.addEventListener('click',()=>exportReport(today,state.profile.full_name));
    document.getElementById('reminderMinutes').onchange=e=>localStorage.setItem(REMINDER_MINUTES_KEY,e.target.value);
    document.getElementById('enableNotifications').onclick=async()=>{if(!('Notification' in window))return toast('Browser notifications are not supported here.','error');const permission=await Notification.requestPermission();toast(permission==='granted'?'Browser reminders enabled.':'Browser reminders were not enabled.',permission==='granted'?'':'error');};
    bindEvidenceButtons();
  }

  async function startPersonalTask(event) {
    event.preventDefault();
    const button=event.submitter,file=document.getElementById('beforeFile')?.files?.[0],title=document.getElementById('taskTitle')?.value?.trim(),notes=document.getElementById('taskNotes')?.value?.trim()||'';
    if(!file||!title)return toast('Task name and Before screenshot are required.','error');
    if(openEntry())return toast('Finish or resume your current task first.','error');
    if(button){button.disabled=true;button.textContent='Starting…';}
    try{const org=await ensurePersonalOrg();const id=crypto.randomUUID();const path=await uploadEvidence(file,id,'before');const {error}=await sb.from('work_entries').insert({id,organization_id:org.id,employee_id:state.profile.id,title,notes,before_path:path,status:'active'});if(error)throw error;reminderSeen.delete(id);await loadWorkspace();toast('Task started.');}catch(err){toast(err.message||'Could not start task.','error');if(button){button.disabled=false;button.textContent='Start task';}}
  }

  async function pausePersonalTask(){const current=openEntry();if(!current||current.status!=='active')return;const {error}=await sb.from('work_entries').update({status:'paused',paused_at:new Date().toISOString()}).eq('id',current.id);if(error)return toast(error.message,'error');await loadWorkspace();toast('Task paused. Break time will not be counted.');}
  async function resumePersonalTask(){const current=openEntry();if(!current||current.status!=='paused'||!current.paused_at)return;const extra=Math.max(0,Math.floor((Date.now()-new Date(current.paused_at).getTime())/1000));const {error}=await sb.from('work_entries').update({status:'active',paused_at:null,break_seconds:Number(current.break_seconds||0)+extra}).eq('id',current.id);if(error)return toast(error.message,'error');await loadWorkspace();toast('Task resumed.');}

  async function savePersonalDuring(event){event.preventDefault();const current=openEntry(),file=document.getElementById('duringFile')?.files?.[0],button=event.submitter;if(!current||current.status!=='active')return toast('Resume the task before adding During proof.','error');if(!file)return toast('Choose a During screenshot first.','error');if(button){button.disabled=true;button.textContent='Saving…';}try{const path=await uploadEvidence(file,current.id,'during');const {error}=await sb.from('work_entries').update({during_path:path,during_at:new Date().toISOString()}).eq('id',current.id);if(error)throw error;reminderSeen.add(current.id);await loadWorkspace();toast('During proof saved.');}catch(err){toast(err.message||'Could not save During proof.','error');if(button){button.disabled=false;button.textContent='Save during proof';}}}

  async function finishPersonalTask(event){event.preventDefault();const current=openEntry(),file=document.getElementById('afterFile')?.files?.[0],button=event.submitter;if(!current)return toast('No active task found.','error');if(current.status==='paused')return toast('Resume the task before finishing it.','error');if(!file)return toast('After screenshot is required.','error');if(button){button.disabled=true;button.textContent='Finishing…';}try{const path=await uploadEvidence(file,current.id,'after');const {error}=await sb.from('work_entries').update({status:'completed',ended_at:new Date().toISOString(),after_path:path,paused_at:null}).eq('id',current.id);if(error)throw error;reminderSeen.delete(current.id);await loadWorkspace();toast('Task completed.');}catch(err){toast(err.message||'Could not finish task.','error');if(button){button.disabled=false;button.textContent='Finish task';}}}

  function renderPersonalHistory(){const entries=personalEntries();page().innerHTML=head('Work History','Review your completed time records and make traceable corrections.',`<button class="btn" id="historyCsv" ${entries.length?'':'disabled'}>CSV</button><button class="btn btn-primary" id="historyPdf" ${entries.length?'':'disabled'}>Export PDF</button>`)+`<section class="panel"><div class="panel-body" style="padding:0">${personalTable(entries,true)}</div></section>`;document.getElementById('historyCsv')?.addEventListener('click',()=>exportPersonalCsv(entries));document.getElementById('historyPdf')?.addEventListener('click',()=>exportReport(entries,state.profile.full_name));document.querySelectorAll('[data-edit-entry]').forEach(btn=>btn.onclick=()=>openEditModal(btn.dataset.editEntry));bindEvidenceButtons();}

  function openEditModal(id){const entry=personalEntries().find(e=>e.id===id);if(!entry||entry.status!=='completed')return;const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal edit-modal"><div class="modal-head"><div><h3>Edit time record</h3><p>Every saved correction is added to Edit History.</p></div><button class="modal-close">×</button></div><form id="editEntryForm" class="modal-body edit-entry-form"><div class="field"><label>Task name</label><input class="input" id="editTitle" maxlength="120" value="${esc(entry.title)}" required></div><div class="field"><label>Notes</label><textarea class="textarea" id="editNotes" maxlength="500">${esc(entry.notes||'')}</textarea></div><div class="edit-time-grid"><div class="field"><label>Start</label><input class="input" id="editStart" type="datetime-local" value="${toInputDateTime(entry.started_at)}" required></div><div class="field"><label>End</label><input class="input" id="editEnd" type="datetime-local" value="${toInputDateTime(entry.ended_at)}" required></div></div><div class="edit-break-note">Recorded break: <strong>${fmtDuration(breakMsFor(entry))}</strong>. Break history is preserved.</div><div class="task-actions"><button type="button" class="btn modal-cancel">Cancel</button><button class="btn btn-primary" type="submit">Save correction</button></div></form></div>`;wrap.onclick=ev=>{if(ev.target===wrap||ev.target.classList.contains('modal-close')||ev.target.classList.contains('modal-cancel'))wrap.remove();};wrap.querySelector('#editEntryForm').onsubmit=async event=>{event.preventDefault();const start=new Date(document.getElementById('editStart').value),end=new Date(document.getElementById('editEnd').value);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)return toast('End time must be after start time.','error');if((end-start)<=breakMsFor(entry))return toast('Time range must be longer than recorded break time.','error');const button=event.submitter;button.disabled=true;button.textContent='Saving…';const payload={title:document.getElementById('editTitle').value.trim(),notes:document.getElementById('editNotes').value.trim(),started_at:start.toISOString(),ended_at:end.toISOString()};const {error}=await sb.from('work_entries').update(payload).eq('id',entry.id).eq('employee_id',state.profile.id);if(error){button.disabled=false;button.textContent='Save correction';return toast(error.message,'error');}wrap.remove();await loadWorkspace();toast('Time record corrected and logged.');};document.body.appendChild(wrap);}

  const rangeLabel=(start,end)=>`${fmtDate(start)} – ${fmtDate(end)}`;

  function renderPersonalReports(){const entries=personalEntries(),preset=localStorage.getItem(REPORT_RANGE_KEY)||'this_week',[defaultStart,defaultEnd]=getRange(preset==='custom'?'this_week':preset);page().innerHTML=head('Reports','Export a clean time record for the exact period you need.')+`<section class="panel report-filter-panel"><div class="panel-body"><div class="report-presets"><button class="btn report-preset ${preset==='today'?'btn-primary':''}" data-preset="today">Today</button><button class="btn report-preset ${preset==='this_week'?'btn-primary':''}" data-preset="this_week">This Week</button><button class="btn report-preset ${preset==='last_week'?'btn-primary':''}" data-preset="last_week">Last Week</button><button class="btn report-preset ${preset==='custom'?'btn-primary':''}" data-preset="custom">Custom Range</button></div><div class="custom-range ${preset==='custom'?'':'is-hidden'}" id="customRange"><div class="field"><label>From</label><input class="input" id="reportFrom" type="date" value="${dateKey(defaultStart)}"></div><div class="field"><label>To</label><input class="input" id="reportTo" type="date" value="${dateKey(defaultEnd)}"></div><button class="btn" id="applyRange">Apply range</button></div></div></section><div id="reportResults"></div>`;
    const renderRange=(start,end)=>{const filtered=filterRange(entries,start,end),container=document.getElementById('reportResults');container.innerHTML=`<div class="grid metrics">${metric('Recorded time',fmtDuration(personalTotalMs(filtered)),rangeLabel(start,end))}${metric('Tasks',filtered.length,'Selected period')}${metric('Break time',fmtDuration(filtered.reduce((a,e)=>a+breakMsFor(e),0)),'Excluded from recorded time')}${metric('Verified',`${filtered.filter(e=>e.before_url&&e.after_url).length}/${filtered.length}`,'Before + after')}</div><section class="panel"><div class="panel-head"><div><div class="panel-title">Selected records</div><div class="panel-desc">${rangeLabel(start,end)}</div></div><div class="page-actions"><button class="btn" id="rangeCsv" ${filtered.length?'':'disabled'}>CSV</button><button class="btn btn-primary" id="rangePdf" ${filtered.length?'':'disabled'}>Export PDF</button></div></div><div class="panel-body" style="padding:0">${personalTable(filtered)}</div></section>`;document.getElementById('rangeCsv')?.addEventListener('click',()=>exportPersonalCsv(filtered));document.getElementById('rangePdf')?.addEventListener('click',()=>exportReport(filtered,state.profile.full_name));bindEvidenceButtons();};
    if(preset==='custom')renderRange(defaultStart,defaultEnd);else{const [start,end]=getRange(preset);renderRange(start,end);}document.querySelectorAll('[data-preset]').forEach(btn=>btn.onclick=()=>{const next=btn.dataset.preset;localStorage.setItem(REPORT_RANGE_KEY,next);if(next==='custom')return renderPersonalReports();const [start,end]=getRange(next);document.querySelectorAll('.report-preset').forEach(x=>x.classList.toggle('btn-primary',x.dataset.preset===next));document.getElementById('customRange').classList.add('is-hidden');renderRange(start,end);});document.getElementById('applyRange')?.addEventListener('click',()=>{const from=document.getElementById('reportFrom').value,to=document.getElementById('reportTo').value;if(!from||!to)return toast('Choose both From and To dates.','error');const start=new Date(`${from}T00:00:00`),end=new Date(`${to}T23:59:59.999`);if(end<start)return toast('To date must be after From date.','error');renderRange(start,end);});
  }

  function exportPersonalCsv(entries){const rows=[['Task','Notes','Date','Start','End','Break','Recorded Time','Evidence'],...entries.map(e=>[e.title,e.notes||'',fmtDate(e.started_at),fmtTime(e.started_at),fmtTime(e.ended_at),fmtDuration(breakMsFor(e)),fmtDuration(personalDurationMs(e)),evidenceStatus(e)])];const csv=rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n');download(`workwatch-time-record-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv');}

  async function renderAuditHistory(){page().innerHTML=head('Edit History','Permanent record of corrections made to completed time entries.')+'<section class="panel"><div class="panel-body"><div class="empty"><strong>Loading edit history…</strong></div></div></section>';const {data,error}=await sb.from('work_entry_audit').select('*').order('edited_at',{ascending:false}).limit(200);if(error){page().innerHTML=head('Edit History','Permanent record of corrections made to completed time entries.')+`<section class="panel"><div class="panel-body"><div class="empty"><strong>Could not load edit history</strong><span>${esc(error.message)}</span></div></div></section>`;return;}const rows=data||[],describe=row=>{const oldV=row.old_values||{},newV=row.new_values||{},changes=[];if(oldV.title!==newV.title)changes.push(`Task: “${oldV.title||''}” → “${newV.title||''}”`);if(oldV.notes!==newV.notes)changes.push('Notes updated');if(oldV.started_at!==newV.started_at)changes.push(`Start: ${fmtTime(oldV.started_at)} → ${fmtTime(newV.started_at)}`);if(oldV.ended_at!==newV.ended_at)changes.push(`End: ${fmtTime(oldV.ended_at)} → ${fmtTime(newV.ended_at)}`);return changes.join(' · ')||'Record updated';};page().innerHTML=head('Edit History','Permanent record of corrections made to completed time entries.')+`<section class="panel"><div class="panel-body" style="padding:0">${rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Edited</th><th>Task</th><th>Changes</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${fmtDate(row.edited_at)}<div class="td-sub">${fmtTime(row.edited_at)}</div></td><td class="td-main">${esc(row.new_values?.title||'Time record')}</td><td>${esc(describe(row))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><strong>No corrections yet</strong><span>Edited completed records will be logged here automatically.</span></div>'}</div></section>`;}

  exportReport = function (arr, preparedFor) {
    const rows=[...(arr||[])].sort((a,b)=>new Date(a.started_at)-new Date(b.started_at));if(!rows.length)return toast('No time records available to export.','error');
    const total=personalTotalMs(rows),totalBreak=rows.reduce((sum,e)=>sum+breakMsFor(e),0),completed=rows.filter(e=>e.status==='completed').length,verified=rows.filter(e=>e.before_url&&e.after_url).length,generated=new Date(),reportDate=generated.toISOString().slice(0,10),reportId=`WW-${reportDate.replace(/-/g,'')}-${String(rows.length).padStart(3,'0')}`,period=`${fmtDate(rows[0].started_at)} – ${fmtDate(rows[rows.length-1].started_at)}`,name=preparedFor||state.profile?.full_name||'John Mark';
    const proofCard=(label,time,url,empty)=>`<figure class="proof-card-print"><figcaption><strong>${label}</strong><span>${time}</span></figcaption><div class="proof-image-print">${url?`<img src="${esc(url)}" alt="${label} screenshot evidence">`:`<div class="proof-empty-print">${empty}</div>`}</div></figure>`;
    const timeRows=rows.map((e,i)=>`<tr><td class="center">${i+1}</td><td>${fmtDate(e.started_at)}</td><td><strong>${esc(e.title)}</strong>${e.notes?`<div class="task-note-inline">${esc(e.notes)}</div>`:''}</td><td class="nowrap">${fmtTime(e.started_at)}</td><td class="nowrap">${fmtTime(e.ended_at)}</td><td class="mono nowrap">${fmtDuration(breakMsFor(e))}</td><td class="mono nowrap">${fmtDuration(personalDurationMs(e))}</td><td>${esc(evidenceStatus(e))}</td></tr>`).join('');
    const proofBlocks=rows.map((e,i)=>`<section class="proof-block"><div class="proof-head"><div><div class="proof-count">TASK ${String(i+1).padStart(2,'0')}</div><h3>${esc(e.title)}</h3>${e.notes?`<p>${esc(e.notes)}</p>`:''}</div><div class="proof-time"><span>${fmtDate(e.started_at)}</span><strong>${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}</strong><small>${fmtDuration(personalDurationMs(e))} recorded</small></div></div><div class="proof-grid-print">${proofCard('BEFORE',fmtTime(e.started_at),e.before_url,'Before proof unavailable')}${proofCard('DURING',e.during_at?fmtTime(e.during_at):'Optional',e.during_url,'Optional — not provided')}${proofCard('AFTER',e.ended_at?fmtTime(e.ended_at):'Pending',e.after_url,'After proof pending')}</div></section>`).join('');
    const win=open('','_blank');if(!win)return toast('Allow pop-ups to open the printable record.','error');win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkWatch_${reportDate}</title><style>*{box-sizing:border-box}body{margin:0;background:#edf1f5;color:#101828;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.45}@page{size:A4 portrait;margin:10mm}.toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:center;padding:10px;background:#101828}.toolbar button{border:0;border-radius:6px;background:#fff;color:#101828;padding:9px 15px;font-weight:800;cursor:pointer}.sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:11mm 12mm 12mm;box-shadow:0 2px 16px rgba(16,24,40,.09)}.header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #101828;padding-bottom:10px}.brand{font-weight:900;letter-spacing:.16em;font-size:13px;padding-top:2px}.meta{text-align:right;color:#667085;font-size:8px}.meta strong{display:block;color:#101828;font-size:10px;margin-bottom:2px}.record-info{display:grid;grid-template-columns:1.3fr 1fr;border:1px solid #cfd4dc;margin-top:13px}.record-info>div{padding:8px 9px}.record-info>div+div{border-left:1px solid #d9dde4}.label{display:block;color:#667085;font-size:7.5px;text-transform:uppercase;letter-spacing:.09em;margin-bottom:2px}.value{font-weight:800;font-size:10px}.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cfd4dc;border-top:0}.summary>div{padding:8px 9px;border-right:1px solid #d9dde4}.summary>div:last-child{border-right:0}.summary strong{display:block;font-size:15px;margin-top:2px}.section-title{margin:16px 0 6px;font-size:9px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#f2f4f7;border:1px solid #cfd4dc;padding:5px;font-size:7px;letter-spacing:.04em;text-transform:uppercase;text-align:left}td{border:1px solid #d9dde4;padding:5px;vertical-align:top;word-wrap:break-word}.center{text-align:center}.nowrap{white-space:nowrap}.mono{font-family:Consolas,monospace}.task-note-inline{color:#667085;font-size:8px;margin-top:2px}.total-row td{background:#f8fafc;font-weight:900}.proof-block{margin-top:11px;border:1px solid #cfd4dc;break-inside:avoid;page-break-inside:avoid}.proof-head{display:flex;justify-content:space-between;gap:14px;padding:8px 9px;border-bottom:1px solid #d9dde4;background:#fafbfc}.proof-count{font-size:7px;font-weight:900;letter-spacing:.12em;color:#667085}.proof-head h3{font-size:11px;margin:2px 0}.proof-head p{margin:2px 0 0;color:#667085;font-size:8px}.proof-time{text-align:right;white-space:nowrap}.proof-time span,.proof-time small{display:block;color:#667085;font-size:8px}.proof-time strong{display:block;font-size:9px;margin:1px 0}.proof-grid-print{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px}.proof-card-print{margin:0;border:1px solid #d9dde4;background:#fff}.proof-card-print figcaption{display:flex;justify-content:space-between;gap:6px;padding:5px 6px;background:#f8fafc;border-bottom:1px solid #e4e7ec;font-size:7.5px}.proof-card-print figcaption span{color:#667085}.proof-image-print{height:48mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f7f8fa}.proof-image-print img{display:block;width:100%;height:100%;object-fit:contain}.proof-empty-print{padding:12px;color:#98a2b3;text-align:center;font-size:8px}.footer{margin-top:12px;border-top:1px solid #e4e7ec;padding-top:6px;color:#98a2b3;font-size:7.5px;text-align:center;letter-spacing:.02em}@media print{body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.proof-block{break-inside:avoid;page-break-inside:avoid}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet"><header class="header"><div class="brand">WORKWATCH</div><div class="meta"><strong>${esc(reportId)}</strong>Generated ${generated.toLocaleString()}</div></header><section class="record-info"><div><span class="label">VA Name</span><span class="value">${esc(name)}</span></div><div><span class="label">Record Period</span><span class="value">${esc(period)}</span></div></section><section class="summary"><div><span class="label">Recorded Time</span><strong class="mono">${fmtDuration(total)}</strong></div><div><span class="label">Completed Tasks</span><strong>${completed}</strong></div><div><span class="label">Break Time</span><strong class="mono">${fmtDuration(totalBreak)}</strong></div><div><span class="label">Verified Tasks</span><strong>${verified}/${rows.length}</strong></div></section><div class="section-title">Detailed Time Record</div><table><thead><tr><th>#</th><th>Date</th><th>Task</th><th>Start</th><th>End</th><th>Break</th><th>Recorded</th><th>Evidence</th></tr></thead><tbody>${timeRows}<tr class="total-row"><td colspan="5">TOTAL</td><td class="mono">${fmtDuration(totalBreak)}</td><td class="mono">${fmtDuration(total)}</td><td>${verified} verified</td></tr></tbody></table><div class="section-title">Work Proof</div>${proofBlocks}<footer class="footer">Generated through WorkWatch • Developed by John Mark</footer></main></body></html>`);win.document.close();
  };

  updateTimers = function(){const current=openEntry();document.querySelectorAll('[data-active-timer]').forEach(el=>{if(current)el.textContent=fmtDuration(personalDurationMs(current));});document.querySelectorAll('[data-break-timer]').forEach(el=>{if(current)el.textContent=breakMsFor(current)?`Break ${fmtDuration(breakMsFor(current))}`:'No break time';});maybeProofReminder(current);};
  function maybeProofReminder(entry){if(!entry||entry.status!=='active'||entry.during_path||reminderSeen.has(entry.id))return;const minutes=Math.max(1,Number(localStorage.getItem(REMINDER_MINUTES_KEY)||60));if(personalDurationMs(entry)<minutes*60000)return;reminderSeen.add(entry.id);const message=`You’ve been working for ${minutes} minutes. Add a During screenshot if you want extra proof.`;toast(message);if('Notification' in window&&Notification.permission==='granted')new Notification('WorkWatch proof reminder',{body:message});}

  if (!state.profile && !state.user) authView();
})();