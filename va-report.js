(() => {
  const evidenceLabel = entry => {
    if (entry.before_url && entry.after_url) return entry.during_url ? 'Before · During · After' : 'Before · After';
    if (entry.before_url) return 'Before only';
    return 'No evidence';
  };

  const proofCard = (label, time, url, emptyText) => `
    <figure class="proof-card-print">
      <figcaption><strong>${label}</strong><span>${time}</span></figcaption>
      <div class="proof-image-print">
        ${url ? `<img src="${esc(url)}" alt="${label} screenshot evidence">` : `<div class="proof-empty-print">${emptyText}</div>`}
      </div>
    </figure>`;

  exportReport = function (arr, preparedFor) {
    const rows = [...(arr || [])].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    if (!rows.length) {
      toast('No time records available to export.', 'error');
      return;
    }

    const total = totalMs(rows);
    const completed = rows.filter(entry => entry.status === 'completed');
    const workDays = new Set(rows.map(entry => new Date(entry.started_at).toDateString())).size;
    const verified = rows.filter(entry => entry.before_url && entry.after_url).length;
    const period = `${fmtDate(rows[0].started_at)} – ${fmtDate(rows[rows.length - 1].started_at)}`;
    const generated = new Date();
    const reportDate = generated.toISOString().slice(0, 10);
    const reportId = `WW-${reportDate.replace(/-/g, '')}-${String(rows.length).padStart(3, '0')}`;
    const vaName = preparedFor || state.profile?.full_name || 'Virtual Assistant';

    const timeRows = rows.map((entry, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${fmtDate(entry.started_at)}</td>
        <td><strong>${esc(entry.title)}</strong>${entry.notes ? `<div class="task-note-inline">${esc(entry.notes)}</div>` : ''}</td>
        <td class="nowrap">${fmtTime(entry.started_at)}</td>
        <td class="nowrap">${fmtTime(entry.ended_at)}</td>
        <td class="mono nowrap">${fmtDuration(durationMs(entry))}</td>
        <td>${esc(evidenceLabel(entry))}</td>
      </tr>`).join('');

    const proofBlocks = rows.map((entry, index) => `
      <section class="proof-block">
        <div class="proof-head">
          <div>
            <div class="proof-count">TASK ${String(index + 1).padStart(2, '0')}</div>
            <h3>${esc(entry.title)}</h3>
            ${entry.notes ? `<p>${esc(entry.notes)}</p>` : ''}
          </div>
          <div class="proof-time">
            <span>${fmtDate(entry.started_at)}</span>
            <strong>${fmtTime(entry.started_at)} – ${fmtTime(entry.ended_at)}</strong>
            <small>${fmtDuration(durationMs(entry))}</small>
          </div>
        </div>
        <div class="proof-grid-print">
          ${proofCard('BEFORE', fmtTime(entry.started_at), entry.before_url, 'Before proof unavailable')}
          ${proofCard('DURING', entry.during_at ? fmtTime(entry.during_at) : 'Optional', entry.during_url, 'Optional — not provided')}
          ${proofCard('AFTER', entry.ended_at ? fmtTime(entry.ended_at) : 'Pending', entry.after_url, 'After proof pending')}
        </div>
      </section>`).join('');

    const win = open('', '_blank');
    if (!win) {
      toast('Allow pop-ups to open the printable VA time record.', 'error');
      return;
    }

    win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WorkWatch_VA_Time_Record_${reportDate}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:#edf1f5;color:#101828;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.45}
    @page{size:A4 portrait;margin:10mm}
    .toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:center;padding:10px;background:#101828}
    .toolbar button{border:0;border-radius:6px;background:#fff;color:#101828;padding:9px 15px;font-weight:800;cursor:pointer}
    .sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:11mm 12mm 12mm;box-shadow:0 2px 16px rgba(16,24,40,.09)}
    .header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #101828;padding-bottom:10px}
    .brand{font-weight:900;letter-spacing:.16em;font-size:11px}
    h1{font-size:22px;margin:4px 0 0;letter-spacing:-.02em}
    .meta{text-align:right;color:#667085;font-size:8px}.meta strong{display:block;color:#101828;font-size:10px;margin-bottom:2px}
    .record-info{display:grid;grid-template-columns:1.3fr 1fr;border:1px solid #cfd4dc;margin-top:13px}
    .record-info>div{padding:8px 9px}.record-info>div+div{border-left:1px solid #d9dde4}
    .label{display:block;color:#667085;font-size:7.5px;text-transform:uppercase;letter-spacing:.09em;margin-bottom:2px}.value{font-weight:800;font-size:10px}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cfd4dc;border-top:0}
    .summary>div{padding:8px 9px;border-right:1px solid #d9dde4}.summary>div:last-child{border-right:0}
    .summary strong{display:block;font-size:16px;margin-top:2px}
    .section-title{margin:16px 0 6px;font-size:9px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#f2f4f7;border:1px solid #cfd4dc;padding:5px 5px;font-size:7px;letter-spacing:.05em;text-transform:uppercase;text-align:left}td{border:1px solid #d9dde4;padding:5px;vertical-align:top;word-wrap:break-word}th:nth-child(1){width:6%}th:nth-child(2){width:13%}th:nth-child(3){width:30%}th:nth-child(4),th:nth-child(5){width:10%}th:nth-child(6){width:13%}th:nth-child(7){width:18%}
    .center{text-align:center}.nowrap{white-space:nowrap}.mono{font-family:Consolas,monospace}.task-note-inline{color:#667085;font-size:8px;margin-top:2px;font-weight:400}
    .total-row td{background:#f8fafc;font-weight:900}
    .proof-block{margin-top:11px;border:1px solid #cfd4dc;break-inside:avoid;page-break-inside:avoid}
    .proof-head{display:flex;justify-content:space-between;gap:14px;padding:8px 9px;border-bottom:1px solid #d9dde4;background:#fafbfc}.proof-count{font-size:7px;font-weight:900;letter-spacing:.12em;color:#667085}.proof-head h3{font-size:11px;margin:2px 0}.proof-head p{margin:2px 0 0;color:#667085;font-size:8px}.proof-time{text-align:right;white-space:nowrap}.proof-time span,.proof-time small{display:block;color:#667085;font-size:8px}.proof-time strong{display:block;font-size:9px;margin:1px 0}
    .proof-grid-print{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px}
    .proof-card-print{margin:0;border:1px solid #d9dde4;background:#fff;min-width:0}.proof-card-print figcaption{display:flex;justify-content:space-between;gap:6px;padding:5px 6px;background:#f8fafc;border-bottom:1px solid #e4e7ec;font-size:7.5px}.proof-card-print figcaption span{color:#667085}.proof-image-print{height:48mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#f7f8fa}.proof-image-print img{display:block;width:100%;height:100%;object-fit:contain}.proof-empty-print{padding:12px;color:#98a2b3;text-align:center;font-size:8px}
    .note{margin-top:13px;padding:8px 9px;border:1px solid #d9dde4;background:#fafbfc;color:#475467;font-size:8px}.note strong{color:#101828}
    .footer{margin-top:12px;border-top:1px solid #e4e7ec;padding-top:5px;color:#98a2b3;font-size:7px;display:flex;justify-content:space-between;gap:10px}
    @media(max-width:850px){.sheet{width:100%;margin:0;padding:18px}.proof-grid-print{grid-template-columns:1fr}.proof-image-print{height:220px}.record-info{grid-template-columns:1fr}.record-info>div+div{border-left:0;border-top:1px solid #d9dde4}.summary{grid-template-columns:1fr 1fr}}
    @media print{body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.proof-block{break-inside:avoid;page-break-inside:avoid}}
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <main class="sheet">
    <header class="header">
      <div><div class="brand">WORKWATCH</div><h1>VA Time Record</h1></div>
      <div class="meta"><strong>${esc(reportId)}</strong>Generated ${generated.toLocaleString()}</div>
    </header>

    <section class="record-info">
      <div><span class="label">VA Name</span><span class="value">${esc(vaName)}</span></div>
      <div><span class="label">Record Period</span><span class="value">${esc(period)}</span></div>
    </section>

    <section class="summary">
      <div><span class="label">Total Recorded Time</span><strong class="mono">${fmtDuration(total)}</strong></div>
      <div><span class="label">Completed Tasks</span><strong>${completed.length}</strong></div>
      <div><span class="label">Work Days</span><strong>${workDays}</strong></div>
      <div><span class="label">Verified Tasks</span><strong>${verified}/${rows.length}</strong></div>
    </section>

    <div class="section-title">Detailed Time Record</div>
    <table>
      <thead><tr><th>#</th><th>Date</th><th>Task</th><th>Start</th><th>End</th><th>Duration</th><th>Evidence</th></tr></thead>
      <tbody>${timeRows}<tr class="total-row"><td colspan="5">TOTAL RECORDED TIME</td><td class="mono">${fmtDuration(total)}</td><td>${verified} verified</td></tr></tbody>
    </table>

    <div class="section-title">Work Proof</div>
    ${proofBlocks}

    <div class="note"><strong>Time Record Note:</strong> This VA record contains task-based time captured in WorkWatch. Idle gaps between tasks are excluded. Before and After screenshots are required for completed tasks; During screenshots are optional work-in-progress evidence.</div>
    <footer class="footer"><span>WorkWatch · VA Time Record</span><span>${esc(reportId)}</span></footer>
  </main>
</body>
</html>`);
    win.document.close();
  };
})();
