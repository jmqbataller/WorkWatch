let CONFIG = window.WORKWATCH_CONFIG || {};
let sb = null;
let channel = null;
let tick = null;

const state = {
  user: null,
  profile: null,
  membership: null,
  org: null,
  entries: [],
  team: [],
  orgs: [],
  users: [],
  view: 'dashboard',
  authMode: 'signin',
  demoRole: null,
  beforeFile: null,
  afterFile: null
};

const DEMO = {
  org: { id: 'demo-org', name: 'Northstar Digital Co.', code: 'NORTH-24' },
  users: [
    { id: 'demo-admin', full_name: 'John Mark Bataller', email: 'admin@workwatch.demo', role: 'system_admin', status: 'active' },
    { id: 'demo-employer', full_name: 'Claire Morgan', email: 'claire@northstar.demo', role: 'employer', status: 'active' },
    { id: 'demo-va-1', full_name: 'Alex Rivera', email: 'alex@northstar.demo', role: 'employee', status: 'active' },
    { id: 'demo-va-2', full_name: 'Mika Santos', email: 'mika@northstar.demo', role: 'employee', status: 'active' }
  ]
};

const app = document.getElementById('app');
const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = v => new Date(v).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const fmtTime = v => v ? new Date(v).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}) : '—';
const initials = n => (n||'User').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const durationMs = e => Math.max(0,(e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at));
const fmtDuration = ms => { const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; };
const totalMs = arr => arr.reduce((a,e)=>a+durationMs(e),0);
const isToday = v => new Date(v).toDateString() === new Date().toDateString();
const toast = (msg,type='') => { const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=msg; document.getElementById('toastRoot').appendChild(el); setTimeout(()=>el.remove(),3200); };
const icon = n => ({dashboard:'◫',clock:'◷',users:'◎',building:'▦',report:'≡',logout:'↗'})[n] || '•';

async function loadRuntimeConfig(){
  try{
    const r = await fetch('/api/config',{cache:'no-store'});
    if(r.ok){ const d=await r.json(); if(d.configured){ CONFIG={...CONFIG,SUPABASE_URL:d.supabaseUrl,SUPABASE_PUBLISHABLE_KEY:d.supabasePublishableKey,DEMO_MODE:false,APP_NAME:d.appName||'WorkWatch'}; } }
  }catch{}
}

function authView(){
  const signin = state.authMode === 'signin';
  app.innerHTML = `<section class="auth-shell">
    <aside class="auth-brand"><div class="wordmark"><span class="wordmark-mark">W</span><span>WorkWatch</span></div><div class="auth-message"><div class="auth-kicker">Workforce time & evidence</div><h1>Clear hours. Live work status. Verifiable progress.</h1><p>Professional task-based tracking for virtual assistants, employees, and employers.</p><div class="auth-proof"><div class="proof"><strong>Live</strong><span>Team status</span></div><div class="proof"><strong>2×</strong><span>Evidence per task</span></div><div class="proof"><strong>PDF</strong><span>Client-ready reports</span></div></div></div><div class="auth-foot">Role-based access · Private evidence · Realtime updates</div></aside>
    <main class="auth-main"><div class="auth-card"><h2>${signin?'Welcome back':'Create account'}</h2><p>${signin?'Sign in to your WorkWatch workspace.':'New accounts begin as Employee / VA until assigned by an administrator.'}</p>
      ${CONFIG.DEMO_MODE!==false?'<div class="demo-banner"><strong>Demo mode.</strong> Explore all three dashboards while Supabase is not connected.</div>':''}
      <form id="authForm">${signin?'':`<div class="field"><label>Full name</label><input class="input" id="name" required></div>`}<div class="field"><label>Email</label><input class="input" id="email" type="email" required></div><div class="field"><label>Password</label><input class="input" id="password" type="password" minlength="6" required></div><button class="btn btn-primary btn-lg">${signin?'Sign in':'Create account'}</button></form>
      ${CONFIG.DEMO_MODE!==false?`<div class="auth-sep">Preview as</div><div class="demo-grid"><button class="demo-btn" data-demo="employee">Employee</button><button class="demo-btn" data-demo="employer">Employer</button><button class="demo-btn" data-demo="system_admin">System Admin</button></div>`:''}
      <div class="auth-switch">${signin?'Need an account?':'Already registered?'} <button class="link-btn" id="authSwitch">${signin?'Create one':'Sign in'}</button></div>
    </div></main></section>`;
  document.getElementById('authSwitch').onclick=()=>{state.authMode=signin?'signup':'signin';authView();};
  document.getElementById('authForm').onsubmit=handleAuth;
  document.querySelectorAll('[data-demo]').forEach(b=>b.onclick=()=>startDemo(b.dataset.demo));
}

async function handleAuth(e){
  e.preventDefault(); if(!sb){toast('Supabase is not connected yet.','error');return;}
  const email=document.getElementById('email').value.trim(), password=document.getElementById('password').value;
  try{
    if(state.authMode==='signin'){
      const {error}=await sb.auth.signInWithPassword({email,password}); if(error) throw error;
    }else{
      const full_name=document.getElementById('name').value.trim();
      const {error}=await sb.auth.signUp({email,password,options:{data:{full_name}}}); if(error) throw error;
      toast('Account created. Check your email if confirmation is enabled.');
    }
  }catch(err){toast(err.message||'Authentication failed.','error');}
}

function startDemo(role){
  state.demoRole=role; state.org=DEMO.org; state.profile=DEMO.users.find(u=>u.role===role)||DEMO.users[2];
  if(role==='employee') state.profile=DEMO.users[2];
  state.team=DEMO.users.filter(u=>u.role==='employee');
  state.orgs=[DEMO.org,{id:'o2',name:'Luma Commerce',code:'LUMA-71'}]; state.users=DEMO.users;
  const now=Date.now();
  state.entries=[
    {id:'e1',organization_id:DEMO.org.id,employee_id:'demo-va-1',employee_name:'Alex Rivera',title:'Website content audit',notes:'Review service pages and CTAs.',status:'active',started_at:new Date(now-38*60000).toISOString(),ended_at:null,before_url:'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=70'},
    {id:'e2',organization_id:DEMO.org.id,employee_id:'demo-va-2',employee_name:'Mika Santos',title:'Inbox organization',notes:'Categorize client support emails.',status:'completed',started_at:new Date(now-95*60000).toISOString(),ended_at:new Date(now-30*60000).toISOString(),before_url:'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=70',after_url:'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=900&q=70'}
  ];
  renderShell();
}

function navFor(role){
  if(role==='employee') return [['dashboard','My Workday','clock'],['history','Work History','report']];
  if(role==='employer') return [['dashboard','Live Dashboard','dashboard'],['team','Team','users'],['reports','Reports','report']];
  return [['dashboard','System Overview','dashboard'],['organizations','Organizations','building'],['users','Users & Roles','users'],['reports','Reports','report']];
}

function renderShell(){
  clearInterval(tick); const role=state.profile?.role||state.demoRole;
  const nav=navFor(role);
  app.innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="wordmark"><span class="wordmark-mark">W</span><span>WorkWatch</span><span class="role-pill">${esc(roleLabel(role))}</span></div><div class="nav-label">Workspace</div><nav class="nav">${nav.map(([v,l,i])=>`<button class="nav-btn ${state.view===v?'active':''}" data-view="${v}"><span class="nav-icon">${icon(i)}</span>${l}</button>`).join('')}</nav><div class="sidebar-spacer"></div><div class="sidebar-user"><div class="avatar">${initials(state.profile?.full_name)}</div><div class="user-copy"><div class="user-name">${esc(state.profile?.full_name||'User')}</div><div class="user-email">${esc(state.profile?.email||'')}</div></div><button class="logout-btn" id="logout">${icon('logout')}</button></div></aside><main class="main"><header class="topbar"><div><div class="top-title">${titleFor(role,state.view)}</div><div class="top-sub">${esc(state.org?.name||'WorkWatch')}</div></div><div class="top-actions">${role==='employer'?'<span class="live-chip"><span class="live-dot"></span>Realtime</span>':''}</div></header><div class="page" id="page"></div></main></div>`;
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;renderShell();});
  document.getElementById('logout').onclick=logout;
  renderPage(role); tick=setInterval(()=>updateTimers(),1000);
}

function roleLabel(r){return ({employee:'Employee / VA',employer:'Employer',system_admin:'System Admin'})[r]||r;}
function titleFor(r,v){const m={employee:{dashboard:'My Workday',history:'Work History'},employer:{dashboard:'Live Dashboard',team:'Team',reports:'Reports'},system_admin:{dashboard:'System Overview',organizations:'Organizations',users:'Users & Roles',reports:'Reports'}};return m[r]?.[v]||'WorkWatch';}
function page(){return document.getElementById('page');}
function head(title,sub,actions=''){return `<div class="pagehead"><div><h1>${title}</h1><p>${sub}</p></div><div class="page-actions">${actions}</div></div>`;}
function metric(k,v,s=''){return `<div class="metric"><div class="metric-k">${k}</div><div class="metric-v">${v}</div><div class="metric-s">${s}</div></div>`;}

function renderPage(role){
  if(role==='employee') return state.view==='history'?renderEmployeeHistory():renderEmployeeDashboard();
  if(role==='employer') return state.view==='team'?renderEmployerTeam():state.view==='reports'?renderReports():renderEmployerDashboard();
  return state.view==='organizations'?renderAdminOrgs():state.view==='users'?renderAdminUsers():state.view==='reports'?renderReports():renderAdminDashboard();
}

function ownEntries(){return state.entries.filter(e=>e.employee_id===state.profile.id).sort((a,b)=>new Date(b.started_at)-new Date(a.started_at));}
function activeEntry(id=state.profile.id){return state.entries.find(e=>e.employee_id===id&&e.status==='active');}
function employeeName(id){return state.team.find(x=>x.id===id)?.full_name||state.users.find(x=>x.id===id)?.full_name||state.profile?.full_name||'Employee';}

function renderEmployeeDashboard(){
  const own=ownEntries(), active=activeEntry(), today=own.filter(e=>isToday(e.started_at));
  page().innerHTML=head('My Workday','Track each task with start/end evidence.',`<button class="btn" id="exportToday">Export today</button>`)+`<div class="grid metrics">${metric('Tracked today',fmtDuration(totalMs(today)),'Active task updates live')}${metric('Completed tasks',today.filter(e=>e.status==='completed').length,'Today')}${metric('Current status',active?'Working':'Idle',active?active.title:'No active task')}${metric('Evidence sets',today.filter(e=>e.before_url&&e.after_url).length,'Before + after')}</div><div class="grid split"><section class="panel"><div class="panel-head"><div><div class="panel-title">Task timer</div><div class="panel-desc">Before screenshot is required to start; after screenshot is required to finish.</div></div></div><div class="panel-body">${active?activeTaskForm(active):newTaskForm()}</div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Today’s activity</div><div class="panel-desc">Idle gaps are not counted.</div></div></div><div class="panel-body" style="padding:0">${entriesTable(today)}</div></section></div>`;
  document.getElementById('exportToday').onclick=()=>exportReport(today,state.profile.full_name,state.org?.name||'Client');
  bindEmployeeForms(); bindEvidenceButtons();
}

function newTaskForm(){return `<form id="startForm"><div class="form-grid"><div class="full field"><label>Task name</label><input class="input" id="taskTitle" maxlength="120" required placeholder="e.g. Website audit"></div><div class="full field"><label>Notes</label><textarea class="textarea" id="taskNotes" maxlength="500" placeholder="What will you work on?"></textarea></div><div class="full upload-box"><strong>Before screenshot</strong><p>Required proof of your starting state.</p><input id="beforeFile" type="file" accept="image/jpeg,image/png,image/webp" required></div></div><div class="task-actions"><button class="btn btn-primary">Start task</button></div></form>`;}
function activeTaskForm(e){return `<div class="tracker-card active"><div class="tracker-copy"><div class="tracker-state">Working now</div><div class="tracker-task">${esc(e.title)}</div><div class="tracker-meta">Started ${fmtTime(e.started_at)}</div></div><div class="timer" data-active-timer>${fmtDuration(durationMs(e))}</div></div><div class="notice"><strong>${esc(e.notes||'No notes')}</strong></div><form id="finishForm"><div class="upload-box" style="margin-top:14px"><strong>After screenshot</strong><p>Required proof before completing this task.</p><input id="afterFile" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="task-actions"><button class="btn btn-primary">Finish task</button></div></form>`;}

function bindEmployeeForms(){
  const start=document.getElementById('startForm'); if(start) start.onsubmit=startTask;
  const finish=document.getElementById('finishForm'); if(finish) finish.onsubmit=finishTask;
}

async function startTask(ev){
  ev.preventDefault(); if(state.demoRole){toast('Demo mode does not write data.');return;}
  const file=document.getElementById('beforeFile').files[0], title=document.getElementById('taskTitle').value.trim(), notes=document.getElementById('taskNotes').value.trim();
  if(!file||!state.org){toast('Before screenshot and organization are required.','error');return;}
  try{
    const id=crypto.randomUUID(), path=await uploadEvidence(file,id,'before');
    const {error}=await sb.from('work_entries').insert({id,organization_id:state.org.id,employee_id:state.profile.id,title,notes,before_path:path,status:'active'}); if(error) throw error;
    await loadWorkspace(); toast('Task started.');
  }catch(err){toast(err.message||'Could not start task.','error');}
}

async function finishTask(ev){
  ev.preventDefault(); if(state.demoRole){toast('Demo mode does not write data.');return;}
  const current=activeEntry(), file=document.getElementById('afterFile').files[0]; if(!current||!file)return;
  try{
    const path=await uploadEvidence(file,current.id,'after');
    const {error}=await sb.from('work_entries').update({status:'completed',ended_at:new Date().toISOString(),after_path:path}).eq('id',current.id); if(error) throw error;
    await loadWorkspace(); toast('Task completed.');
  }catch(err){toast(err.message||'Could not finish task.','error');}
}

async function uploadEvidence(file,entryId,stage){
  if(file.size>10*1024*1024) throw new Error('Screenshot must be 10 MB or smaller.');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase(), path=`${state.profile.id}/${entryId}/${stage}.${ext}`;
  const {error}=await sb.storage.from('evidence').upload(path,file,{upsert:true,contentType:file.type}); if(error) throw error; return path;
}
async function signed(path){if(!path)return null;const {data,error}=await sb.storage.from('evidence').createSignedUrl(path,3600);return error?null:data.signedUrl;}
async function hydrate(arr){return Promise.all((arr||[]).map(async e=>({...e,before_url:await signed(e.before_path),after_url:await signed(e.after_path)})));}

function renderEmployeeHistory(){const own=ownEntries(); page().innerHTML=head('Work History','Review completed and active task records.',`<button class="btn" id="csv">CSV</button><button class="btn btn-primary" id="pdf">Client report</button>`)+`<section class="panel"><div class="panel-body" style="padding:0">${entriesTable(own)}</div></section>`;document.getElementById('csv').onclick=()=>exportCsv(own);document.getElementById('pdf').onclick=()=>exportReport(own,state.profile.full_name,state.org?.name||'Client');bindEvidenceButtons();}

function renderEmployerDashboard(){
  const today=state.entries.filter(e=>isToday(e.started_at)), active=today.filter(e=>e.status==='active');
  page().innerHTML=head('Live Dashboard',`Live status for ${esc(state.org?.name||'your organization')}.`,`<button class="btn btn-primary" id="teamExport">Export today</button>`)+`<div class="grid metrics">${metric('Working now',active.length,`of ${state.team.length} employees`)}${metric('Tracked today',fmtDuration(totalMs(today)),'Across visible tasks')}${metric('Completed',today.filter(e=>e.status==='completed').length,'Tasks today')}${metric('Evidence complete',today.filter(e=>e.before_url&&e.after_url).length,'Verified task sets')}</div><section class="panel"><div class="panel-head"><div><div class="panel-title">Team status</div><div class="panel-desc">Updates automatically as employees start or finish tasks.</div></div><span class="live-chip"><span class="live-dot"></span>Realtime</span></div><div class="panel-body" style="padding:0">${teamTable(today)}</div></section>`;
  document.getElementById('teamExport').onclick=()=>exportReport(today,'Team',state.org?.name||'Client'); bindEvidenceButtons();
}

function teamTable(entries){
  if(!state.team.length)return '<div class="empty"><strong>No employees assigned</strong><span>System Admin can assign employees to this organization.</span></div>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th>Status</th><th>Current task</th><th>Since</th><th>Today</th></tr></thead><tbody>${state.team.map(u=>{const own=entries.filter(e=>e.employee_id===u.id),a=own.find(e=>e.status==='active');return `<tr><td><div class="worker ${a?'worker-live':''}"><div class="avatar">${initials(u.full_name)}</div><div><div class="td-main">${esc(u.full_name)}</div><div class="td-sub">${esc(u.email||'')}</div></div></div></td><td><span class="status ${a?'live':'idle'}">${a?'Working':'Idle'}</span></td><td>${a?esc(a.title):'—'}</td><td>${a?fmtTime(a.started_at):'—'}</td><td class="mono">${fmtDuration(totalMs(own))}</td></tr>`}).join('')}</tbody></table></div>`;
}

function renderEmployerTeam(){page().innerHTML=head('Team','Employee activity and visible time records.')+`<section class="panel"><div class="panel-body" style="padding:0">${teamTable(state.entries.filter(e=>isToday(e.started_at)))}</div></section><section class="panel" style="margin-top:16px"><div class="panel-head"><div class="panel-title">Recent work entries</div></div><div class="panel-body" style="padding:0">${entriesTable(state.entries)}</div></section>`;bindEvidenceButtons();}

function renderAdminDashboard(){page().innerHTML=head('System Overview','Manage WorkWatch organizations, roles, and activity.')+`<div class="grid metrics">${metric('Organizations',state.orgs.length,'Client workspaces')}${metric('Platform users',state.users.length,'All roles')}${metric('Working now',state.entries.filter(e=>e.status==='active').length,'Active tasks')}${metric('Tasks loaded',state.entries.length,'Recent activity')}</div><div class="grid split"><section class="panel"><div class="panel-head"><div class="panel-title">Organizations</div></div><div class="panel-body" style="padding:0">${orgTable()}</div></section><section class="panel"><div class="panel-head"><div class="panel-title">Recent users</div></div><div class="panel-body" style="padding:0">${userTable(false)}</div></section></div>`;}

function renderAdminOrgs(){page().innerHTML=head('Organizations','Create and manage employer workspaces.',`<button class="btn btn-primary" id="addOrg">New organization</button>`)+`<section class="panel"><div class="panel-body" style="padding:0">${orgTable()}</div></section>`;document.getElementById('addOrg').onclick=createOrgPrompt;}
function orgTable(){return `<div class="table-wrap"><table class="table"><thead><tr><th>Organization</th><th>Code</th><th>Created</th></tr></thead><tbody>${state.orgs.map(o=>`<tr><td class="td-main">${esc(o.name)}</td><td><span class="org-code">${esc(o.code)}</span></td><td>${o.created_at?fmtDate(o.created_at):'—'}</td></tr>`).join('')||'<tr><td colspan="3">No organizations yet.</td></tr>'}</tbody></table></div>`;}
async function createOrgPrompt(){if(state.demoRole){toast('Demo mode does not write data.');return;}const name=prompt('Organization name');if(!name)return;const code=(prompt('Organization code')||'').trim().toUpperCase();if(!code)return;const {error}=await sb.from('organizations').insert({name:name.trim(),code});if(error)toast(error.message,'error');else{toast('Organization created.');await loadWorkspace();}}

function renderAdminUsers(){page().innerHTML=head('Users & Roles','Assign account roles and organization access.')+`<section class="panel"><div class="panel-body" style="padding:0">${userTable(true)}</div></section>`;if(!state.demoRole){document.querySelectorAll('[data-role]').forEach(s=>s.onchange=()=>updateRole(s.dataset.role,s.value));document.querySelectorAll('[data-org]').forEach(s=>s.onchange=()=>updateMembership(s.dataset.org,s.value));}}
function userTable(editable){return `<div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Organization</th><th>Status</th></tr></thead><tbody>${state.users.map(u=>`<tr><td><div class="td-main">${esc(u.full_name)}</div><div class="td-sub">${esc(u.email)}</div></td><td>${editable?`<select class="select" data-role="${u.id}"><option value="employee" ${u.role==='employee'?'selected':''}>Employee</option><option value="employer" ${u.role==='employer'?'selected':''}>Employer</option><option value="system_admin" ${u.role==='system_admin'?'selected':''}>System Admin</option></select>`:roleLabel(u.role)}</td><td>${editable?`<select class="select" data-org="${u.id}"><option value="">Unassigned</option>${state.orgs.map(o=>`<option value="${o.id}" ${u.organization_id===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select>`:esc(u.organization_name||'—')}</td><td><span class="status ${u.status==='active'?'completed':'pending'}">${esc(u.status)}</span></td></tr>`).join('')}</tbody></table></div>`;}
async function updateRole(id,role){const {error}=await sb.from('profiles').update({role}).eq('id',id);if(error)toast(error.message,'error');else{toast('Role updated.');await loadWorkspace();}}
async function updateMembership(id,orgId){const u=state.users.find(x=>x.id===id),type=u?.role==='employer'?'employer':'employee';const {data:existing}=await sb.from('organization_members').select('id').eq('user_id',id).maybeSingle();let error=null;if(existing?.id&&!orgId)({error}=await sb.from('organization_members').delete().eq('id',existing.id));else if(existing?.id)({error}=await sb.from('organization_members').update({organization_id:orgId,member_type:type}).eq('id',existing.id));else if(orgId)({error}=await sb.from('organization_members').insert({organization_id:orgId,user_id:id,member_type:type}));if(error)toast(error.message,'error');else{toast('Organization assignment updated.');await loadWorkspace();}}

function renderReports(){const arr=state.profile.role==='employee'?ownEntries():state.entries;page().innerHTML=head('Reports','Export the records available to your account.',`<button class="btn" id="csv">CSV timesheet</button><button class="btn btn-primary" id="pdf">Client report</button>`)+`<div class="grid metrics">${metric('Entries',arr.length,'Loaded records')}${metric('Tracked time',fmtDuration(totalMs(arr)),'Active entries included')}${metric('Completed',arr.filter(e=>e.status==='completed').length,'Finished tasks')}${metric('Evidence sets',arr.filter(e=>e.before_url&&e.after_url).length,'Before + after')}</div><section class="panel"><div class="panel-body" style="padding:0">${entriesTable(arr)}</div></section>`;document.getElementById('csv').onclick=()=>exportCsv(arr);document.getElementById('pdf').onclick=()=>exportReport(arr,state.profile.role==='employee'?state.profile.full_name:'Team',state.org?.name||'WorkWatch');bindEvidenceButtons();}

function entriesTable(arr){if(!arr.length)return '<div class="empty"><strong>No work entries</strong><span>Tracked tasks will appear here.</span></div>';return `<div class="table-wrap"><table class="table"><thead><tr><th>Employee / Task</th><th>Date</th><th>Start</th><th>End</th><th>Duration</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${[...arr].sort((a,b)=>new Date(b.started_at)-new Date(a.started_at)).map(e=>`<tr><td><div class="td-main">${esc(e.title)}</div><div class="td-sub">${esc(e.employee_name||employeeName(e.employee_id))}</div></td><td>${fmtDate(e.started_at)}</td><td>${fmtTime(e.started_at)}</td><td>${fmtTime(e.ended_at)}</td><td class="mono">${fmtDuration(durationMs(e))}</td><td><span class="status ${e.status==='active'?'live':'completed'}">${e.status}</span></td><td>${e.before_url||e.after_url?`<button class="btn btn-sm" data-evidence="${e.id}">View</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`;}
function bindEvidenceButtons(){document.querySelectorAll('[data-evidence]').forEach(b=>b.onclick=()=>showEvidence(b.dataset.evidence));}
function showEvidence(id){const e=state.entries.find(x=>x.id===id);if(!e)return;const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal"><div class="modal-head"><div><h3>${esc(e.title)}</h3><p>${esc(e.employee_name||employeeName(e.employee_id))} · ${fmtDate(e.started_at)}</p></div><button class="modal-close">×</button></div><div class="modal-body"><div class="evidence-pair"><figure><figcaption>Before</figcaption>${e.before_url?`<img src="${esc(e.before_url)}">`:'No image'}</figure><figure><figcaption>After</figcaption>${e.after_url?`<img src="${esc(e.after_url)}">`:'Pending'}</figure></div></div></div>`;wrap.onclick=x=>{if(x.target===wrap||x.target.classList.contains('modal-close'))wrap.remove();};document.body.appendChild(wrap);}

function exportCsv(arr){const rows=[['Employee','Task','Notes','Date','Start','End','Duration','Status'],...arr.map(e=>[e.employee_name||employeeName(e.employee_id),e.title,e.notes||'',fmtDate(e.started_at),fmtTime(e.started_at),fmtTime(e.ended_at),fmtDuration(durationMs(e)),e.status])];const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');download(`workwatch-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv');}
function download(name,data,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
function exportReport(arr,preparedFor,client){const rows=[...arr].sort((a,b)=>new Date(a.started_at)-new Date(b.started_at));const total=totalMs(rows);const evidence=rows.filter(e=>e.before_url||e.after_url).map((e,i)=>`<section class="ev"><h3>${i+1}. ${esc(e.title)}</h3><p>${esc(e.employee_name||employeeName(e.employee_id))} · ${fmtDate(e.started_at)} · ${fmtTime(e.started_at)}–${fmtTime(e.ended_at)}</p><div class="pair"><figure><figcaption>Before</figcaption>${e.before_url?`<img src="${esc(e.before_url)}">`:'—'}</figure><figure><figcaption>After</figcaption>${e.after_url?`<img src="${esc(e.after_url)}">`:'Pending'}</figure></div></section>`).join('');const w=open('','_blank');w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>WorkWatch Report</title><style>@page{size:A4;margin:14mm}body{font:10px Arial;color:#101828}h1{margin:3px 0;font-size:22px}.head{display:flex;justify-content:space-between;border-bottom:1px solid #d0d5dd;padding-bottom:12px}.brand{color:#2563eb;font-weight:800;text-transform:uppercase}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.card{border:1px solid #e4e7ec;border-radius:7px;padding:9px}.card strong{display:block;font-size:16px;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #e4e7ec;text-align:left}th{background:#f9fafb;font-size:8px;text-transform:uppercase}.ev{page-break-inside:avoid;border-top:1px solid #d0d5dd;margin-top:16px;padding-top:10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair img{width:100%;height:210px;object-fit:contain;border:1px solid #e4e7ec}.toolbar{position:fixed;right:15px;top:15px}.toolbar button{background:#2563eb;color:#fff;border:0;border-radius:7px;padding:8px 10px}@media print{.toolbar{display:none}}</style></head><body><div class="toolbar"><button onclick="print()">Save as PDF / Print</button></div><div class="head"><div><div class="brand">WorkWatch</div><h1>Time & Work Evidence Report</h1><p>Prepared for ${esc(preparedFor)}</p></div><div><strong>${esc(client)}</strong><p>${new Date().toLocaleString()}</p></div></div><div class="cards"><div class="card">Tracked time<strong>${fmtDuration(total)}</strong></div><div class="card">Entries<strong>${rows.length}</strong></div><div class="card">Completed<strong>${rows.filter(e=>e.status==='completed').length}</strong></div></div><table><thead><tr><th>Employee</th><th>Task</th><th>Date</th><th>Start</th><th>End</th><th>Duration</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(e.employee_name||employeeName(e.employee_id))}</td><td>${esc(e.title)}</td><td>${fmtDate(e.started_at)}</td><td>${fmtTime(e.started_at)}</td><td>${fmtTime(e.ended_at)}</td><td>${fmtDuration(durationMs(e))}</td></tr>`).join('')}</tbody></table>${evidence?`<h2>Work evidence</h2>${evidence}`:''}<p style="margin-top:18px;color:#667085">Idle gaps between tasks are excluded from tracked time.</p></body></html>`);w.document.close();}

function updateTimers(){document.querySelectorAll('[data-active-timer]').forEach(el=>{const e=activeEntry();if(e)el.textContent=fmtDuration(durationMs(e));});if(state.profile?.role==='employer'&&state.view==='dashboard')document.querySelectorAll('.worker-live').forEach(()=>{});}

async function logout(){clearInterval(tick); if(channel&&sb)await sb.removeChannel(channel); channel=null;if(state.demoRole){state.demoRole=null;state.profile=null;state.view='dashboard';authView();return;}await sb.auth.signOut();state.user=state.profile=null;authView();}

async function loadWorkspace(){
  if(state.demoRole){renderShell();return;}
  const {data:{user}}=await sb.auth.getUser(); if(!user){authView();return;} state.user=user;
  const {data:profile,error:pe}=await sb.from('profiles').select('*').eq('id',user.id).single(); if(pe){toast(pe.message,'error');return;} state.profile=profile;
  const {data:membership}=await sb.from('organization_members').select('id,organization_id,member_type,organizations(id,name,code,created_at)').eq('user_id',user.id).maybeSingle(); state.membership=membership||null;state.org=membership?.organizations||null;
  if(profile.role==='employee') await loadEmployee(); else if(profile.role==='employer') await loadEmployer(); else await loadAdmin();
  subscribe(); renderShell();
}
async function loadEmployee(){const {data,error}=await sb.from('work_entries').select('*').eq('employee_id',state.user.id).order('started_at',{ascending:false}).limit(200);if(error)throw error;state.entries=(await hydrate(data)).map(e=>({...e,employee_name:state.profile.full_name}));state.team=[];}
async function loadEmployer(){if(!state.org){state.entries=[];state.team=[];return;}const [{data:members,error:me},{data:entries,error:ee}]=await Promise.all([sb.from('organization_members').select('user_id,member_type,profiles(id,full_name,email,role,status)').eq('organization_id',state.org.id),sb.from('work_entries').select('*').eq('organization_id',state.org.id).order('started_at',{ascending:false}).limit(500)]);if(me)throw me;if(ee)throw ee;state.team=(members||[]).filter(x=>x.member_type==='employee').map(x=>x.profiles).filter(Boolean);const names=Object.fromEntries(state.team.map(x=>[x.id,x.full_name]));state.entries=(await hydrate(entries)).map(e=>({...e,employee_name:names[e.employee_id]||'Employee'}));}
async function loadAdmin(){const [{data:orgs},{data:profiles},{data:members},{data:entries}]=await Promise.all([sb.from('organizations').select('*').order('created_at',{ascending:false}),sb.from('profiles').select('*').order('created_at',{ascending:false}),sb.from('organization_members').select('id,organization_id,user_id,member_type,organizations(name)'),sb.from('work_entries').select('*').order('started_at',{ascending:false}).limit(500)]);state.orgs=orgs||[];const mm=Object.fromEntries((members||[]).map(m=>[m.user_id,m]));state.users=(profiles||[]).map(p=>({...p,organization_id:mm[p.id]?.organization_id||null,organization_name:mm[p.id]?.organizations?.name||null}));state.team=state.users.filter(x=>x.role==='employee');const names=Object.fromEntries(state.users.map(x=>[x.id,x.full_name]));state.entries=(await hydrate(entries||[])).map(e=>({...e,employee_name:names[e.employee_id]||'Employee'}));}
function subscribe(){if(channel)sb.removeChannel(channel);if(state.profile.role==='system_admin')return;const filter=state.profile.role==='employee'?`employee_id=eq.${state.user.id}`:`organization_id=eq.${state.org?.id}`;channel=sb.channel(`workwatch-${state.user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'work_entries',filter},()=>loadWorkspace()).subscribe();}

async function init(){
  await loadRuntimeConfig();
  if(CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_PUBLISHABLE_KEY){
    try{const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');sb=createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_PUBLISHABLE_KEY);CONFIG.DEMO_MODE=false;sb.auth.onAuthStateChange((_e,s)=>{if(s?.user)setTimeout(loadWorkspace,0);});const {data:{session}}=await sb.auth.getSession();if(session?.user){await loadWorkspace();return;}}catch(err){console.error(err);toast('Supabase initialization failed.','error');}
  }
  authView();
}

init();
