(() => {
  const baseHydrate = hydrate;
  const reminderUploadLabel = 'Add During Evidence';

  const currentPersonalEntry = () => (state.entries || []).find(entry =>
    entry.employee_id === state.profile?.id && entry.status === 'active'
  );

  const breakMs = entry => Math.max(0, Number(entry?.break_seconds || 0)) * 1000;
  const recordedMs = entry => {
    if (!entry?.started_at) return 0;
    const end = entry.ended_at ? new Date(entry.ended_at) : new Date();
    let paused = breakMs(entry);
    if (entry.status === 'paused' && entry.paused_at) paused += Math.max(0, Date.now() - new Date(entry.paused_at).getTime());
    return Math.max(0, end - new Date(entry.started_at) - paused);
  };

  hydrate = async function (arr) {
    const hydrated = await baseHydrate(arr);
    if (!sb || !state.user || !hydrated.length) return hydrated;

    const ids = hydrated.map(entry => entry.id).filter(Boolean);
    if (!ids.length) return hydrated;

    const { data, error } = await sb
      .from('work_entry_during_evidence')
      .select('id,work_entry_id,path,captured_at,created_at')
      .in('work_entry_id', ids)
      .order('captured_at', { ascending: true });

    if (error) {
      console.warn('Could not load multiple During evidence:', error.message);
      return hydrated;
    }

    const grouped = new Map();
    for (const row of data || []) {
      if (!grouped.has(row.work_entry_id)) grouped.set(row.work_entry_id, []);
      grouped.get(row.work_entry_id).push(row);
    }

    return Promise.all(hydrated.map(async entry => {
      const rows = grouped.get(entry.id) || [];
      const evidence = await Promise.all(rows.map(async row => ({
        ...row,
        url: await signed(row.path)
      })));

      if (entry.during_path && !evidence.some(item => item.path === entry.during_path)) {
        evidence.push({
          id: `legacy-${entry.id}`,
          work_entry_id: entry.id,
          path: entry.during_path,
          captured_at: entry.during_at,
          created_at: entry.during_at,
          url: entry.during_url
        });
      }

      evidence.sort((a, b) => new Date(a.captured_at || 0) - new Date(b.captured_at || 0));
      const latest = evidence[evidence.length - 1];

      return {
        ...entry,
        during_evidence: evidence,
        during_url: latest?.url || entry.during_url || null,
        during_at: latest?.captured_at || entry.during_at || null,
        during_path: latest?.path || entry.during_path || null
      };
    }));
  };

  function patchDuringForm() {
    const form = document.getElementById('personalDuringForm');
    if (!form || form.dataset.multiDuringReady === '1') return;
    form.dataset.multiDuringReady = '1';

    const input = form.querySelector('#duringFile');
    const button = form.querySelector('button[type="submit"]');
    const heading = form.querySelector('.proof-stage-heading strong');
    const description = form.querySelector('.proof-stage-heading p');
    const current = (state.entries || []).find(entry =>
      entry.employee_id === state.profile?.id && (entry.status === 'active' || entry.status === 'paused')
    );
    const list = current?.during_evidence || [];

    if (heading) heading.innerHTML = `During evidence <span class="proof-optional">Optional</span><span class="multi-proof-badge">${list.length}</span>`;
    if (description) description.textContent = list.length
      ? `${list.length} During evidence saved. You can keep adding more while the task is active.`
      : 'Upload one or multiple work-in-progress screenshots. You can add more later.';

    if (input) {
      input.multiple = true;
      input.setAttribute('multiple', '');
      input.addEventListener('change', () => {
        const count = input.files?.length || 0;
        if (button) button.textContent = count ? `Add ${count} Evidence${count === 1 ? '' : 's'}` : reminderUploadLabel;
      });
    }
    if (button) button.textContent = reminderUploadLabel;

    const uploadBox = form.querySelector('.upload-box');
    if (uploadBox && !uploadBox.querySelector('.during-evidence-summary')) {
      const summary = document.createElement('div');
      summary.className = 'during-evidence-summary';
      summary.innerHTML = `<div class="during-evidence-count"><strong>${list.length}</strong> saved During evidence${list.length === 1 ? '' : 's'}</div>${list.length ? `<button class="btn btn-sm" type="button" data-evidence="${current.id}">View all evidence</button>` : ''}`;
      const grid = document.createElement('div');
      grid.className = 'during-mini-grid';
      grid.innerHTML = list.slice(-6).map((item, index) => `
        <div class="during-mini-card">
          ${item.url ? `<img src="${esc(item.url)}" alt="During evidence ${list.length - Math.min(6, list.length) + index + 1}">` : ''}
          <span>During ${list.length - Math.min(6, list.length) + index + 1} · ${item.captured_at ? fmtTime(item.captured_at) : '—'}</span>
        </div>`).join('');
      const hint = document.createElement('div');
      hint.className = 'during-upload-hint';
      hint.textContent = 'No fixed screenshot-count limit in WorkWatch. Each file can be up to 10 MB.';
      const headingWrap = form.querySelector('.proof-stage-heading');
      if (headingWrap) headingWrap.insertAdjacentElement('afterend', summary);
      if (list.length) summary.insertAdjacentElement('afterend', grid);
      const fileInput = form.querySelector('#duringFile');
      if (fileInput) fileInput.insertAdjacentElement('afterend', hint);
    }

    bindEvidenceButtons();
  }

  const observer = new MutationObserver(() => patchDuringForm());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(patchDuringForm);

  document.addEventListener('submit', async event => {
    if (event.target?.id !== 'personalDuringForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const current = currentPersonalEntry();
    const input = document.getElementById('duringFile');
    const files = Array.from(input?.files || []);
    const button = event.submitter || event.target.querySelector('button[type="submit"]');

    if (!current) return toast('Resume the task before adding During evidence.', 'error');
    if (!files.length) return toast('Choose one or more During screenshots first.', 'error');

    if (button) {
      button.disabled = true;
      button.textContent = `Uploading 0/${files.length}…`;
    }

    let saved = 0;
    const failures = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        try {
          const stage = `during-${Date.now()}-${index}-${crypto.randomUUID().slice(0, 8)}`;
          const path = await uploadEvidence(file, current.id, stage);
          const capturedAt = new Date().toISOString();
          const { error } = await sb.from('work_entry_during_evidence').insert({
            work_entry_id: current.id,
            user_id: state.profile.id,
            path,
            captured_at: capturedAt
          });
          if (error) throw error;
          saved += 1;
          if (button) button.textContent = `Uploading ${saved}/${files.length}…`;
        } catch (error) {
          failures.push(`${file.name}: ${error.message || 'upload failed'}`);
        }
      }

      await loadWorkspace();
      if (saved) toast(`${saved} During evidence${saved === 1 ? '' : 's'} added.`);
      if (failures.length) toast(`${failures.length} file${failures.length === 1 ? '' : 's'} could not be saved.`, 'error');
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = reminderUploadLabel;
      }
    }
  }, true);

  showEvidence = function (id) {
    const entry = (state.entries || []).find(item => item.id === id);
    if (!entry) return;
    const during = entry.during_evidence || [];

    const proofCard = (label, timestamp, url, missingText) => `
      <figure class="proof-card">
        <figcaption><strong>${label}</strong><span>${timestamp || '—'}</span></figcaption>
        ${url ? `<img src="${esc(url)}" alt="${label} work evidence">` : `<div class="proof-missing">${missingText}</div>`}
      </figure>`;

    const cards = [
      proofCard('Before', fmtTime(entry.started_at), entry.before_url, 'No before proof'),
      ...during.map((item, index) => proofCard(`During ${index + 1}`, item.captured_at ? fmtTime(item.captured_at) : '—', item.url, 'Evidence unavailable')),
      proofCard('After', entry.ended_at ? fmtTime(entry.ended_at) : 'Pending', entry.after_url, 'Pending until task is finished')
    ].join('');

    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal modal-wide">
      <div class="modal-head">
        <div><h3>${esc(entry.title)}</h3><p>${fmtDate(entry.started_at)} · ${during.length} During evidence${during.length === 1 ? '' : 's'}</p></div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body"><div class="evidence-triplet multi-evidence-grid">${cards}</div></div>
    </div>`;
    wrap.onclick = ev => {
      if (ev.target === wrap || ev.target.classList.contains('modal-close')) wrap.remove();
    };
    document.body.appendChild(wrap);
  };

  exportReport = function (arr, preparedFor) {
    const rows = [...(arr || [])].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    if (!rows.length) return toast('No time records available to export.', 'error');

    const total = rows.reduce((sum, entry) => sum + recordedMs(entry), 0);
    const totalBreak = rows.reduce((sum, entry) => sum + breakMs(entry), 0);
    const completed = rows.filter(entry => entry.status === 'completed').length;
    const verified = rows.filter(entry => entry.before_url && entry.after_url).length;
    const period = `${fmtDate(rows[0].started_at)} – ${fmtDate(rows[rows.length - 1].started_at)}`;
    const generated = new Date();
    const reportDate = generated.toISOString().slice(0, 10);
    const reportId = `WW-${reportDate.replace(/-/g, '')}-${String(rows.length).padStart(3, '0')}`;
    const name = preparedFor || state.profile?.full_name || 'John Mark';

    const evidenceLabel = entry => {
      const count = (entry.during_evidence || []).length;
      return entry.before_url && entry.after_url
        ? `Before · ${count ? `${count} During · ` : ''}After`
        : entry.before_url ? 'Before only' : 'No evidence';
    };

    const timeRows = rows.map((entry, index) => `<tr>
      <td class="center">${index + 1}</td><td>${fmtDate(entry.started_at)}</td>
      <td><strong>${esc(entry.title)}</strong>${entry.notes ? `<div class="task-note-inline">${esc(entry.notes)}</div>` : ''}</td>
      <td class="nowrap">${fmtTime(entry.started_at)}</td><td class="nowrap">${fmtTime(entry.ended_at)}</td>
      <td class="mono nowrap">${fmtDuration(breakMs(entry))}</td><td class="mono nowrap">${fmtDuration(recordedMs(entry))}</td>
      <td>${esc(evidenceLabel(entry))}</td></tr>`).join('');

    const proofCard = (label, time, url, emptyText) => `<figure class="proof-card-print"><figcaption><strong>${label}</strong><span>${time}</span></figcaption><div class="proof-image-print">${url ? `<img src="${esc(url)}" alt="${label} screenshot evidence">` : `<div class="proof-empty-print">${emptyText}</div>`}</div></figure>`;

    const proofBlocks = rows.map((entry, index) => {
      const during = entry.during_evidence || [];
      const duringCards = during.map((item, proofIndex) => proofCard(`DURING ${proofIndex + 1}`, item.captured_at ? fmtTime(item.captured_at) : '—', item.url, 'Evidence unavailable')).join('');
      return `<section class="proof-block"><div class="proof-head"><div><div class="proof-count">TASK ${String(index + 1).padStart(2, '0')}</div><h3>${esc(entry.title)}</h3>${entry.notes ? `<p>${esc(entry.notes)}</p>` : ''}</div><div class="proof-time"><span>${fmtDate(entry.started_at)}</span><strong>${fmtTime(entry.started_at)} – ${fmtTime(entry.ended_at)}</strong><small>${fmtDuration(recordedMs(entry))} recorded</small></div></div><div class="proof-grid-print multi-proof-grid-print">${proofCard('BEFORE', fmtTime(entry.started_at), entry.before_url, 'Before proof unavailable')}${duringCards}${proofCard('AFTER', entry.ended_at ? fmtTime(entry.ended_at) : 'Pending', entry.after_url, 'After proof pending')}</div></section>`;
    }).join('');

    const win = open('', '_blank');
    if (!win) return toast('Allow pop-ups to open the printable record.', 'error');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkWatch_${reportDate}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#edf1f5;color:#101828;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.45}@page{size:A4 portrait;margin:10mm}.toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:center;padding:10px;background:#101828}.toolbar button{border:0;border-radius:6px;background:#fff;color:#101828;padding:9px 15px;font-weight:800;cursor:pointer}.sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:11mm 12mm 12mm;box-shadow:0 2px 16px rgba(16,24,40,.09)}.header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #101828;padding-bottom:10px}.brand{font-weight:900;letter-spacing:.16em;font-size:13px;padding-top:2px}.meta{text-align:right;color:#667085;font-size:8px}.meta strong{display:block;color:#101828;font-size:10px;margin-bottom:2px}.record-info{display:grid;grid-template-columns:1.3fr 1fr;border:1px solid #cfd4dc;margin-top:13px}.record-info>div{padding:8px 9px}.record-info>div+div{border-left:1px solid #d9dde4}.label{display:block;color:#667085;font-size:7.5px;text-transform:uppercase;letter-spacing:.09em;margin-bottom:2px}.value{font-weight:800;font-size:10px}.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cfd4dc;border-top:0}.summary>div{padding:8px 9px;border-right:1px solid #d9dde4}.summary>div:last-child{border-right:0}.summary strong{display:block;font-size:15px;margin-top:2px}.section-title{margin:16px 0 6px;font-size:9px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#f2f4f7;border:1px solid #cfd4dc;padding:5px;font-size:7px;letter-spacing:.04em;text-transform:uppercase;text-align:left}td{border:1px solid #d9dde4;padding:5px;vertical-align:top;word-wrap:break-word}.center{text-align:center}.nowrap{white-space:nowrap}.mono{font-family:Consolas,monospace}.task-note-inline{color:#667085;font-size:8px;margin-top:2px}.total-row td{background:#f8fafc;font-weight:900}.proof-block{margin-top:11px;border:1px solid #cfd4dc;break-inside:avoid;page-break-inside:avoid}.proof-head{display:flex;justify-content:space-between;gap:14px;padding:8px 9px;border-bottom:1px solid #d9dde4;background:#fafbfc}.proof-count{font-size:7px;font-weight:900;letter-spacing:.12em;color:#667085}.proof-head h3{font-size:11px;margin:2px 0}.proof-head p{margin:2px 0 0;color:#667085;font-size:8px}.proof-time{text-align:right;white-space:nowrap}.proof-time span,.proof-time small{display:block;color:#667085;font-size:8px}.proof-time strong{display:block;font-size:9px;margin:1px 0}.proof-grid-print{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px}.proof-card-print{margin:0;border:1px solid #d9dde4;background:#fff}.proof-card-print figcaption{display:flex;justify-content:space-between;gap:6px;padding:5px 6px;background:#f8fafc;border-bottom:1px solid #e4e7ec;font-size:7.5px}.proof-card-print figcaption span{color:#667085}.proof-image-print{height:48mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f7f8fa}.proof-image-print img{display:block;width:100%;height:100%;object-fit:contain}.proof-empty-print{padding:12px;color:#98a2b3;text-align:center;font-size:8px}.footer{margin-top:12px;border-top:1px solid #e4e7ec;padding-top:6px;color:#98a2b3;font-size:7.5px;text-align:center;letter-spacing:.02em}@media print{body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.proof-block{break-inside:avoid;page-break-inside:avoid}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet"><header class="header"><div class="brand">WORKWATCH</div><div class="meta"><strong>${esc(reportId)}</strong>Generated ${generated.toLocaleString()}</div></header><section class="record-info"><div><span class="label">VA Name</span><span class="value">${esc(name)}</span></div><div><span class="label">Record Period</span><span class="value">${esc(period)}</span></div></section><section class="summary"><div><span class="label">Recorded Time</span><strong class="mono">${fmtDuration(total)}</strong></div><div><span class="label">Completed Tasks</span><strong>${completed}</strong></div><div><span class="label">Break Time</span><strong class="mono">${fmtDuration(totalBreak)}</strong></div><div><span class="label">Verified Tasks</span><strong>${verified}/${rows.length}</strong></div></section><div class="section-title">Detailed Time Record</div><table><thead><tr><th>#</th><th>Date</th><th>Task</th><th>Start</th><th>End</th><th>Break</th><th>Recorded</th><th>Evidence</th></tr></thead><tbody>${timeRows}<tr class="total-row"><td colspan="5">TOTAL</td><td class="mono">${fmtDuration(totalBreak)}</td><td class="mono">${fmtDuration(total)}</td><td>${verified} verified</td></tr></tbody></table><div class="section-title">Work Proof</div>${proofBlocks}<footer class="footer">Generated through WorkWatch • Developed by John Mark</footer></main></body></html>`);
    win.document.close();
  };
})();
