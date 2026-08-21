(() => {
  const originalBindEmployeeForms = bindEmployeeForms;

  const orgNameForEntry = (entry, fallback = 'WorkWatch') => {
    const fromAdminList = (state.orgs || []).find(o => o.id === entry.organization_id)?.name;
    if (fromAdminList) return fromAdminList;
    if (state.org?.id === entry.organization_id && state.org?.name) return state.org.name;
    return fallback;
  };

  const proofStatus = entry => {
    if (entry.before_url && entry.after_url) return entry.during_url ? 'Before · During · After' : 'Before · After';
    if (entry.before_url) return 'Before only';
    return 'No evidence';
  };

  hydrate = async function (arr) {
    return Promise.all((arr || []).map(async entry => ({
      ...entry,
      before_url: await signed(entry.before_path),
      during_url: await signed(entry.during_path),
      after_url: await signed(entry.after_path)
    })));
  };

  activeTaskForm = function (entry) {
    return `
      <div class="tracker-card active">
        <div class="tracker-copy">
          <div class="tracker-state">Working now</div>
          <div class="tracker-task">${esc(entry.title)}</div>
          <div class="tracker-meta">Started ${fmtTime(entry.started_at)}</div>
        </div>
        <div class="timer" data-active-timer>${fmtDuration(durationMs(entry))}</div>
      </div>
      <div class="notice"><strong>${esc(entry.notes || 'No notes')}</strong></div>

      <form id="duringForm" class="proof-stage-form">
        <div class="upload-box" style="margin-top:14px">
          <div class="proof-stage-heading">
            <div>
              <strong>During screenshot <span class="proof-optional">Optional</span></strong>
              <p>${entry.during_at ? `Work-in-progress proof saved at ${fmtTime(entry.during_at)}.` : 'Capture one screenshot while the task is in progress.'}</p>
            </div>
            ${entry.during_url ? `<button class="btn btn-sm" type="button" data-evidence="${entry.id}">View proof</button>` : ''}
          </div>
          <input id="duringFile" type="file" accept="image/jpeg,image/png,image/webp">
          <div class="task-actions proof-stage-actions">
            <button class="btn" type="submit">${entry.during_path ? 'Replace during proof' : 'Save during proof'}</button>
          </div>
        </div>
      </form>

      <form id="finishForm">
        <div class="upload-box" style="margin-top:14px">
          <strong>After screenshot</strong>
          <p>Required proof before completing this task.</p>
          <input id="afterFile" type="file" accept="image/jpeg,image/png,image/webp" required>
        </div>
        <div class="task-actions"><button class="btn btn-primary">Finish task</button></div>
      </form>`;
  };

  bindEmployeeForms = function () {
    originalBindEmployeeForms();
    const duringForm = document.getElementById('duringForm');
    if (duringForm) duringForm.onsubmit = saveDuringProof;
  };

  async function saveDuringProof(event) {
    event.preventDefault();
    if (state.demoRole) {
      toast('Demo mode does not write data.');
      return;
    }

    const current = activeEntry();
    const file = document.getElementById('duringFile')?.files?.[0];
    const button = event.submitter || event.currentTarget?.querySelector('button[type="submit"]');

    if (!current) {
      toast('No active task found.', 'error');
      return;
    }
    if (!file) {
      toast('Choose a during screenshot first.', 'error');
      return;
    }
    if (button?.disabled) return;

    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Saving…';
    }

    try {
      const path = await uploadEvidence(file, current.id, 'during');
      const capturedAt = new Date().toISOString();
      const { error } = await sb.from('work_entries')
        .update({ during_path: path, during_at: capturedAt })
        .eq('id', current.id)
        .eq('status', 'active');
      if (error) throw error;
      await loadWorkspace();
      toast('During proof saved.');
    } catch (err) {
      toast(err.message || 'Could not save during proof.', 'error');
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Save during proof';
      }
    }
  }

  showEvidence = function (id) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry) return;

    const proofCard = (label, timestamp, url, missingText) => `
      <figure class="proof-card">
        <figcaption><strong>${label}</strong><span>${timestamp || '—'}</span></figcaption>
        ${url ? `<img src="${esc(url)}" alt="${label} work evidence">` : `<div class="proof-missing">${missingText}</div>`}
      </figure>`;

    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal modal-wide">
      <div class="modal-head">
        <div><h3>${esc(entry.title)}</h3><p>${esc(entry.employee_name || employeeName(entry.employee_id))} · ${fmtDate(entry.started_at)}</p></div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div class="evidence-triplet">
          ${proofCard('Before', fmtTime(entry.started_at), entry.before_url, 'No before proof')}
          ${proofCard('During', entry.during_at ? fmtTime(entry.during_at) : 'Optional', entry.during_url, 'Not provided (optional)')}
          ${proofCard('After', entry.ended_at ? fmtTime(entry.ended_at) : 'Pending', entry.after_url, 'Pending until task is finished')}
        </div>
      </div>
    </div>`;
    wrap.onclick = event => {
      if (event.target === wrap || event.target.classList.contains('modal-close')) wrap.remove();
    };
    document.body.appendChild(wrap);
  };

  exportCsv = function (arr) {
    const rows = [
      ['Employee', 'Organization / Client', 'Task', 'Notes', 'Date', 'Start', 'During Proof Time', 'End', 'Duration', 'Status', 'Evidence'],
      ...arr.map(entry => [
        entry.employee_name || employeeName(entry.employee_id),
        orgNameForEntry(entry, state.org?.name || 'WorkWatch'),
        entry.title,
        entry.notes || '',
        fmtDate(entry.started_at),
        fmtTime(entry.started_at),
        entry.during_at ? fmtTime(entry.during_at) : '',
        fmtTime(entry.ended_at),
        fmtDuration(durationMs(entry)),
        entry.status,
        proofStatus(entry)
      ])
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`workwatch-time-record-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  };

  exportReport = function (arr, preparedFor, client) {
    const rows = [...arr].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    const total = totalMs(rows);
    const completed = rows.filter(entry => entry.status === 'completed');
    const days = new Set(rows.map(entry => new Date(entry.started_at).toDateString())).size;
    const verified = rows.filter(entry => entry.before_url && entry.after_url).length;
    const organizations = [...new Set(rows.map(entry => orgNameForEntry(entry, client)).filter(Boolean))];
    const clientLabel = organizations.length === 1 ? organizations[0] : organizations.length > 1 ? 'Multiple client workspaces' : (client || 'WorkWatch');
    const period = rows.length ? `${fmtDate(rows[0].started_at)} – ${fmtDate(rows[rows.length - 1].started_at)}` : fmtDate(new Date());
    const generated = new Date();
    const reportDate = generated.toISOString().slice(0, 10);
    const reportId = `WW-${reportDate.replace(/-/g, '')}-${String(rows.length).padStart(3, '0')}`;

    const evidencePages = rows.map((entry, index) => {
      const employee = entry.employee_name || employeeName(entry.employee_id);
      const organization = orgNameForEntry(entry, clientLabel);
      const proofRow = (label, timestamp, url, note) => `
        <div class="evidence-row">
          <div class="evidence-label"><strong>${label}</strong><span>${timestamp}</span></div>
          <div class="evidence-image">${url ? `<img src="${esc(url)}" alt="${label} evidence">` : `<div class="evidence-placeholder">${note}</div>`}</div>
        </div>`;

      return `<section class="evidence-page">
        <div class="evidence-page-head">
          <div><div class="brandline">WORKWATCH</div><h2>Work Evidence Record</h2></div>
          <div class="record-no">Record ${index + 1} of ${rows.length}</div>
        </div>
        <div class="record-grid">
          <div><span>Employee / Worker</span><strong>${esc(employee)}</strong></div>
          <div><span>Organization / Client</span><strong>${esc(organization)}</strong></div>
          <div><span>Task</span><strong>${esc(entry.title)}</strong></div>
          <div><span>Date</span><strong>${fmtDate(entry.started_at)}</strong></div>
          <div><span>Start</span><strong>${fmtTime(entry.started_at)}</strong></div>
          <div><span>End</span><strong>${fmtTime(entry.ended_at)}</strong></div>
          <div><span>Tracked Duration</span><strong>${fmtDuration(durationMs(entry))}</strong></div>
          <div><span>Status</span><strong>${esc(entry.status)}</strong></div>
        </div>
        ${entry.notes ? `<div class="task-note"><span>Task notes</span><p>${esc(entry.notes)}</p></div>` : ''}
        <div class="proof-sequence-title">Evidence sequence</div>
        ${proofRow('BEFORE', fmtTime(entry.started_at), entry.before_url, 'Before proof unavailable')}
        ${proofRow('DURING', entry.during_at ? fmtTime(entry.during_at) : 'Optional', entry.during_url, 'No during proof provided — optional')}
        ${proofRow('AFTER', entry.ended_at ? fmtTime(entry.ended_at) : 'Pending', entry.after_url, 'After proof pending')}
        <div class="page-foot">WorkWatch · ${esc(reportId)} · Evidence ${index + 1}</div>
      </section>`;
    }).join('');

    const w = open('', '_blank');
    if (!w) {
      toast('Allow pop-ups to export the printable report.', 'error');
      return;
    }

    w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WorkWatch_Time_Record_${reportDate}</title>
  <style>
    *{box-sizing:border-box} body{margin:0;background:#eef1f5;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.45}
    @page{size:A4 portrait;margin:12mm}
    .toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:center;gap:8px;padding:10px;background:#111827;color:white}
    .toolbar button{border:0;border-radius:6px;padding:9px 14px;font-weight:700;cursor:pointer}.toolbar .primary{background:#fff;color:#111827}
    .sheet,.evidence-page{width:210mm;min-height:297mm;margin:12px auto;background:white;padding:12mm;position:relative;box-shadow:0 2px 14px rgba(15,23,42,.08)}
    .doc-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:10px}
    .brandline{font-weight:900;font-size:12px;letter-spacing:.15em}.doc-head h1,.evidence-page h2{font-size:21px;margin:4px 0 0}.doc-meta{text-align:right;color:#475467}.doc-meta strong{display:block;color:#111827;font-size:11px}
    .info-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:0;border:1px solid #cfd4dc;margin-top:14px}.info-grid>div,.record-grid>div{padding:8px 9px;border-right:1px solid #d9dde4;border-bottom:1px solid #d9dde4}.info-grid>div:nth-child(3n){border-right:0}.info-grid span,.record-grid span,.task-note span{display:block;color:#667085;font-size:8px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}.info-grid strong,.record-grid strong{font-size:10px}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cfd4dc;border-top:0}.summary>div{padding:9px;border-right:1px solid #d9dde4}.summary>div:last-child{border-right:0}.summary span{display:block;text-transform:uppercase;color:#667085;font-size:8px;letter-spacing:.08em}.summary strong{display:block;font-size:17px;margin-top:2px}
    .section-title{font-size:10px;text-transform:uppercase;letter-spacing:.12em;margin:18px 0 7px;font-weight:800}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#f2f4f7;border:1px solid #cfd4dc;padding:6px 5px;text-transform:uppercase;font-size:7.5px;letter-spacing:.05em;text-align:left}td{border:1px solid #d9dde4;padding:6px 5px;vertical-align:top;word-break:break-word}.mono{font-family:Consolas,monospace;white-space:nowrap}.total-row td{font-weight:800;background:#f8fafc}
    .cert{margin-top:16px;border:1px solid #cfd4dc;padding:10px}.cert h3{margin:0 0 5px;font-size:10px}.cert p{margin:0;color:#475467}
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:28px}.sig-line{border-top:1px solid #111827;padding-top:5px}.sig-line strong{display:block}.sig-line span{color:#667085;font-size:8px}
    .sheet-foot,.page-foot{position:absolute;left:12mm;right:12mm;bottom:8mm;border-top:1px solid #e4e7ec;padding-top:4px;color:#98a2b3;font-size:7.5px;display:flex;justify-content:space-between}
    .evidence-page{page-break-before:always;break-before:page}.evidence-page-head{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:9px}.record-no{color:#667085}.record-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #cfd4dc;margin-top:12px}.record-grid>div:nth-child(2n){border-right:0}.task-note{margin-top:9px;border:1px solid #d9dde4;padding:8px}.task-note p{margin:2px 0 0}.proof-sequence-title{font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin:12px 0 6px}
    .evidence-row{display:grid;grid-template-columns:24mm 1fr;border:1px solid #cfd4dc;margin-bottom:7px;min-height:58mm;break-inside:avoid}.evidence-label{padding:8px;background:#f8fafc;border-right:1px solid #d9dde4}.evidence-label strong{display:block;font-size:10px}.evidence-label span{display:block;color:#667085;margin-top:3px}.evidence-image{display:flex;align-items:center;justify-content:center;padding:5px;overflow:hidden}.evidence-image img{max-width:100%;max-height:54mm;object-fit:contain}.evidence-placeholder{color:#98a2b3;text-align:center;padding:20px}
    @media print{body{background:white}.toolbar{display:none}.sheet,.evidence-page{width:auto;min-height:273mm;margin:0;box-shadow:none;padding:0}.sheet-foot,.page-foot{left:0;right:0;bottom:0}}
  </style>
</head>
<body>
  <div class="toolbar"><button class="primary" onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close</button></div>
  <section class="sheet">
    <div class="doc-head">
      <div><div class="brandline">WORKWATCH</div><h1>Verified Time Record</h1></div>
      <div class="doc-meta"><strong>${esc(reportId)}</strong><span>Generated ${generated.toLocaleString()}</span></div>
    </div>
    <div class="info-grid">
      <div><span>Employee / Worker</span><strong>${esc(preparedFor || 'Team')}</strong></div>
      <div><span>Organization / Client</span><strong>${esc(clientLabel)}</strong></div>
      <div><span>Record Period</span><strong>${esc(period)}</strong></div>
    </div>
    <div class="summary">
      <div><span>Total Recorded Time</span><strong>${fmtDuration(total)}</strong></div>
      <div><span>Completed Tasks</span><strong>${completed.length}</strong></div>
      <div><span>Work Days</span><strong>${days}</strong></div>
      <div><span>Verified Entries</span><strong>${verified}/${rows.length}</strong></div>
    </div>
    <div class="section-title">Detailed time record</div>
    <table>
      <thead><tr><th style="width:7%">#</th><th style="width:12%">Date</th><th style="width:18%">Client</th><th>Task</th><th style="width:10%">Start</th><th style="width:10%">End</th><th style="width:12%">Duration</th><th style="width:14%">Evidence</th></tr></thead>
      <tbody>
        ${rows.map((entry, index) => `<tr>
          <td>${index + 1}</td>
          <td>${fmtDate(entry.started_at)}</td>
          <td>${esc(orgNameForEntry(entry, clientLabel))}</td>
          <td><strong>${esc(entry.title)}</strong>${entry.notes ? `<br><span style="color:#667085">${esc(entry.notes)}</span>` : ''}</td>
          <td class="mono">${fmtTime(entry.started_at)}</td>
          <td class="mono">${fmtTime(entry.ended_at)}</td>
          <td class="mono">${fmtDuration(durationMs(entry))}</td>
          <td>${esc(proofStatus(entry))}</td>
        </tr>`).join('')}
        <tr class="total-row"><td colspan="6">TOTAL RECORDED TIME</td><td class="mono">${fmtDuration(total)}</td><td>${verified} verified</td></tr>
      </tbody>
    </table>
    <div class="cert">
      <h3>Time Record Certification</h3>
      <p>This report records task-based time captured in WorkWatch. Idle gaps between tasks are excluded. Completed entries include required Before and After evidence; During evidence is optional and may be included as additional work-in-progress verification.</p>
    </div>
    <div class="signatures">
      <div class="sig-line"><strong>Employee / Contractor Signature</strong><span>Name / Signature / Date</span></div>
      <div class="sig-line"><strong>Employer / Reviewer Verification</strong><span>Name / Signature / Date</span></div>
    </div>
    <div class="sheet-foot"><span>WorkWatch · Verified Time Record</span><span>${esc(reportId)}</span></div>
  </section>
  ${evidencePages}
</body>
</html>`);
    w.document.close();
  };
})();
