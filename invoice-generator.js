(() => {
  const OWNER = 'system_admin';
  const RECEIPT_BUCKET = 'payment-receipts';
  const RATE_KEY = 'jm_worklog_invoice_rate_usd';
  const baseNavFor = navFor;
  const baseTitleFor = titleFor;
  const baseRenderPage = renderPage;
  const baseLoadWorkspace = loadWorkspace;

  const billing = window.JMWorkLogBilling = window.JMWorkLogBilling || {
    invoices: [],
    items: [],
    loaded: false,
    schemaReady: true
  };
  const selectedEntryIds = new Set();

  const pro = () => window.WorkWatchPro || {};
  const own = () => pro().own?.() || (state.entries || [])
    .filter(entry => entry.employee_id === state.profile?.id && !entry.deleted_at)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const breakMs = entry => pro().breakMs?.(entry) ?? Math.max(0, Number(entry.break_seconds || 0) * 1000);
  const workMs = entry => pro().workMs?.(entry) ?? Math.max(0,
    new Date(entry.ended_at || Date.now()) - new Date(entry.started_at) - breakMs(entry)
  );
  const dateKey = value => pro().dateKey?.(value) || (() => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  })();
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
  const decimalHours = seconds => (Math.max(0, Number(seconds || 0)) / 3600).toFixed(2);
  const statusLabel = status => ({ not_paid: 'Not Paid', pending: 'Pending', paid: 'Paid' })[status] || status;
  const safeFileName = value => String(value || 'receipt').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'receipt';

  billing.statusLabel = statusLabel;
  billing.computeInvoiceTotal = computeInvoiceTotal;
  billing.computeEarnings = computeEarnings;

  navFor = function (role) {
    const nav = baseNavFor(role);
    if (role !== OWNER || nav.some(([view]) => view === 'invoices')) return nav;
    const next = [...nav];
    const weeklyIndex = next.findIndex(([view]) => view === 'weekly-summary');
    const customIndex = next.findIndex(([view]) => view === 'custom-export');
    const reportsIndex = next.findIndex(([view]) => view === 'reports');
    const insertAt = weeklyIndex >= 0 ? weeklyIndex + 1 : customIndex >= 0 ? customIndex + 1 : reportsIndex >= 0 ? reportsIndex + 1 : 2;
    next.splice(insertAt, 0, ['invoices', 'Invoices', 'report']);
    return next;
  };

  titleFor = function (role, view) {
    if (role === OWNER && view === 'invoices') return 'Invoices';
    return baseTitleFor(role, view);
  };

  renderPage = function (role) {
    if (role === OWNER && state.view === 'invoices') return renderInvoices();
    return baseRenderPage(role);
  };

  loadWorkspace = async function () {
    const result = await baseLoadWorkspace();
    if (state.profile?.role === OWNER && !state.demoRole) {
      await refreshBilling();
      if (state.view === 'invoices') renderShell();
    }
    return result;
  };

  async function refreshBilling() {
    if (!sb || !state.profile?.id) return;
    const [{ data: invoices, error: invoiceError }, { data: items, error: itemError }] = await Promise.all([
      sb.from('invoices').select('*').eq('user_id', state.profile.id).order('created_at', { ascending: false }),
      sb.from('invoice_items').select('*').eq('user_id', state.profile.id).order('created_at', { ascending: true })
    ]);
    if (invoiceError || itemError) {
      billing.schemaReady = false;
      billing.loaded = true;
      console.warn('Invoice data:', invoiceError?.message || itemError?.message);
      return;
    }
    billing.schemaReady = true;
    billing.items = items || [];
    billing.invoices = await Promise.all((invoices || []).map(async invoice => ({
      ...invoice,
      receipt_url: invoice.receipt_path ? await signedReceipt(invoice.receipt_path) : null
    })));
    billing.loaded = true;
  }

  async function signedReceipt(path) {
    const { data, error } = await sb.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
  }

  function startOfWeek(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  }

  function computeEarnings(invoices, now = new Date()) {
    const current = new Date(now);
    const today = dateKey(current);
    const week = startOfWeek(current);
    const paid = (invoices || []).filter(invoice => invoice.status === 'paid' && invoice.paid_at);
    const sum = predicate => paid.filter(predicate).reduce((total, invoice) => total + Number(invoice.total_amount || 0), 0);
    return {
      today: sum(invoice => dateKey(invoice.paid_at) === today),
      week: sum(invoice => new Date(invoice.paid_at) >= week && new Date(invoice.paid_at) <= current),
      month: sum(invoice => {
        const paidAt = new Date(invoice.paid_at);
        return paidAt.getFullYear() === current.getFullYear() && paidAt.getMonth() === current.getMonth();
      }),
      year: sum(invoice => new Date(invoice.paid_at).getFullYear() === current.getFullYear()),
      allTime: sum(() => true),
      outstanding: (invoices || []).filter(invoice => invoice.status !== 'paid').reduce((total, invoice) => total + Number(invoice.total_amount || 0), 0),
      pending: (invoices || []).filter(invoice => invoice.status === 'pending').reduce((total, invoice) => total + Number(invoice.total_amount || 0), 0),
      notPaid: (invoices || []).filter(invoice => invoice.status === 'not_paid').reduce((total, invoice) => total + Number(invoice.total_amount || 0), 0)
    };
  }

  function computeInvoiceTotal(entries, rate) {
    const hourlyRate = Number(rate || 0);
    return (entries || []).reduce((total, entry) => total + Math.round((workMs(entry) / 3600000 * hourlyRate + Number.EPSILON) * 100) / 100, 0);
  }

  function renderInvoices() {
    if (!billing.loaded && !state.demoRole) {
      page().innerHTML = head('Invoices', 'Create task-based USD invoices and track received payments.') + '<section class="panel"><div class="empty"><strong>Loading invoices…</strong></div></section>';
      refreshBilling().then(() => state.view === 'invoices' && renderInvoices());
      return;
    }
    if (!billing.schemaReady) {
      page().innerHTML = head('Invoices', 'Create task-based USD invoices and track received payments.') + '<section class="panel"><div class="empty"><strong>Invoice storage is unavailable</strong><span>Refresh the page. If this continues, the invoice database migration needs to be applied.</span></div></section>';
      return;
    }

    const earnings = computeEarnings(billing.invoices);
    const completed = own().filter(entry => entry.status === 'completed');
    const invoicedIds = new Set(billing.items.map(item => item.work_entry_id).filter(Boolean));
    const available = completed.filter(entry => !invoicedIds.has(entry.id));
    const clients = [...new Set(available.map(entry => entry.client_label).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    page().innerHTML = head(
      'Invoice Generator',
      'Bill completed work in USD, update payment status yourself, and keep private payment receipts.'
    ) + `
      <div class="invoice-earnings-grid">
        ${earningCard('Today', earnings.today, 'Paid today')}
        ${earningCard('This week', earnings.week, 'Paid since Monday')}
        ${earningCard('This month', earnings.month, 'Paid this month')}
        ${earningCard('This year', earnings.year, 'Paid this year')}
        ${earningCard('All time', earnings.allTime, 'Total received')}
      </div>
      <div class="invoice-outstanding">
        <span><strong>${money(earnings.outstanding)}</strong> outstanding</span>
        <span>${money(earnings.pending)} pending</span>
        <span>${money(earnings.notPaid)} not paid</span>
      </div>
      <section class="panel invoice-builder">
        <div class="panel-head"><div><div class="panel-title">Create invoice</div><div class="panel-desc">Choose one or more completed tasks and set your USD hourly rate.</div></div></div>
        <form class="panel-body invoice-form" id="invoiceForm">
          <div class="invoice-form-grid">
            <div class="field"><label>Bill to / Client</label><input class="input" id="invoiceClient" maxlength="160" required placeholder="e.g. Setiba Medical Spa"></div>
            <div class="field"><label>Client email <span class="suite-optional">optional</span></label><input class="input" id="invoiceEmail" type="email" maxlength="254" placeholder="client@example.com"></div>
            <div class="field"><label>Hourly rate (USD)</label><div class="invoice-money-input"><span>$</span><input class="input" id="invoiceRate" type="number" min="0.01" max="1000000" step="0.01" required value="${esc(localStorage.getItem(RATE_KEY) || '')}" placeholder="0.00"></div></div>
            <div class="field"><label>Due date <span class="suite-optional">optional</span></label><input class="input" id="invoiceDue" type="date" min="${dateKey(new Date())}"></div>
            <div class="field invoice-notes-field"><label>Invoice notes <span class="suite-optional">optional</span></label><textarea class="textarea" id="invoiceNotes" maxlength="3000" placeholder="Payment details or a short message for the client"></textarea></div>
          </div>
          <div class="invoice-task-head">
            <div><strong>Select billable tasks</strong><span>${available.length} uninvoiced completed task${available.length === 1 ? '' : 's'}</span></div>
            <div class="invoice-task-actions">
              <select class="select" id="invoiceClientFilter"><option value="">All clients</option>${clients.map(client => `<option value="${esc(client)}">${esc(client)}</option>`).join('')}</select>
              <button class="btn btn-sm" id="invoiceSelectVisible" type="button">Select visible</button>
              <button class="btn btn-sm" id="invoiceClear" type="button">Clear</button>
            </div>
          </div>
          <div id="invoiceTaskList">${invoiceTaskList(available)}</div>
          <div class="invoice-selection-summary">
            <div><span>Selected tasks</span><strong id="invoiceSelectedCount">0</strong></div>
            <div><span>Recorded time</span><strong class="mono" id="invoiceSelectedTime">00:00:00</strong></div>
            <div><span>Hourly rate</span><strong id="invoiceSelectedRate">$0.00</strong></div>
            <div class="invoice-selection-total"><span>Invoice total</span><strong id="invoiceSelectedTotal">$0.00</strong></div>
          </div>
          <div class="task-actions"><button class="btn btn-primary" id="invoiceGenerate" type="submit" disabled>Generate invoice</button></div>
        </form>
      </section>
      <section class="panel invoice-history">
        <div class="panel-head"><div><div class="panel-title">Invoice history</div><div class="panel-desc">${billing.invoices.length} saved invoice${billing.invoices.length === 1 ? '' : 's'}</div></div></div>
        <div class="panel-body" style="padding:0">${invoiceHistoryTable()}</div>
      </section>`;

    bindInvoiceBuilder(available);
    bindInvoiceHistory();
    updateInvoiceSelection(available);
  }

  function earningCard(label, value, subtitle) {
    return `<article class="metric invoice-earning-card"><div class="metric-k">${label}</div><div class="metric-v">${money(value)}</div><div class="metric-s">${subtitle}</div></article>`;
  }

  function invoiceTaskList(entries) {
    if (!entries.length) return '<div class="empty"><strong>No uninvoiced completed tasks</strong><span>Complete a new task or review your invoice history below.</span></div>';
    return `<div class="table-wrap"><table class="table invoice-task-table"><thead><tr><th></th><th>Task</th><th>Date</th><th>Client / Project</th><th>Recorded</th></tr></thead><tbody>${entries.map(entry => `<tr data-invoice-task-row="${entry.id}"><td><input type="checkbox" data-invoice-task="${entry.id}" ${selectedEntryIds.has(entry.id) ? 'checked' : ''}></td><td><div class="td-main">${esc(entry.title)}</div><div class="td-sub">${esc(entry.notes || '')}</div></td><td>${fmtDate(entry.started_at)}</td><td>${esc([entry.client_label, entry.project_label].filter(Boolean).join(' · ') || '—')}</td><td class="mono">${fmtDuration(workMs(entry))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function bindInvoiceBuilder(entries) {
    const form = document.getElementById('invoiceForm');
    if (!form) return;
    const filter = document.getElementById('invoiceClientFilter');
    const visibleEntries = () => entries.filter(entry => !filter.value || entry.client_label === filter.value);
    const bindChecks = () => document.querySelectorAll('[data-invoice-task]').forEach(input => {
      input.onchange = () => {
        if (input.checked) selectedEntryIds.add(input.dataset.invoiceTask);
        else selectedEntryIds.delete(input.dataset.invoiceTask);
        autoFillClient(entries);
        updateInvoiceSelection(entries);
      };
    });
    bindChecks();
    filter.onchange = () => {
      const visible = visibleEntries();
      document.getElementById('invoiceTaskList').innerHTML = invoiceTaskList(visible);
      bindChecks();
    };
    document.getElementById('invoiceSelectVisible').onclick = () => {
      visibleEntries().forEach(entry => selectedEntryIds.add(entry.id));
      document.getElementById('invoiceTaskList').innerHTML = invoiceTaskList(visibleEntries());
      bindChecks();
      autoFillClient(entries);
      updateInvoiceSelection(entries);
    };
    document.getElementById('invoiceClear').onclick = () => {
      selectedEntryIds.clear();
      document.getElementById('invoiceTaskList').innerHTML = invoiceTaskList(visibleEntries());
      bindChecks();
      updateInvoiceSelection(entries);
    };
    document.getElementById('invoiceRate').oninput = () => updateInvoiceSelection(entries);
    form.onsubmit = event => createInvoice(event, entries);
  }

  function autoFillClient(entries) {
    const field = document.getElementById('invoiceClient');
    if (!field || field.value.trim()) return;
    const selected = entries.filter(entry => selectedEntryIds.has(entry.id));
    const clients = [...new Set(selected.map(entry => entry.client_label).filter(Boolean))];
    if (clients.length === 1) field.value = clients[0];
  }

  function updateInvoiceSelection(entries) {
    const selected = entries.filter(entry => selectedEntryIds.has(entry.id));
    const rate = Number(document.getElementById('invoiceRate')?.value || 0);
    const total = computeInvoiceTotal(selected, rate);
    const totalTime = selected.reduce((sum, entry) => sum + workMs(entry), 0);
    document.getElementById('invoiceSelectedCount').textContent = selected.length;
    document.getElementById('invoiceSelectedTime').textContent = fmtDuration(totalTime);
    document.getElementById('invoiceSelectedRate').textContent = money(rate);
    document.getElementById('invoiceSelectedTotal').textContent = money(total);
    document.getElementById('invoiceGenerate').disabled = !selected.length || !(rate > 0);
  }

  async function createInvoice(event, entries) {
    event.preventDefault();
    if (state.demoRole) return toast('Demo mode does not write invoices.', 'error');
    const selected = entries.filter(entry => selectedEntryIds.has(entry.id));
    const client = document.getElementById('invoiceClient').value.trim();
    const email = document.getElementById('invoiceEmail').value.trim();
    const due = document.getElementById('invoiceDue').value || null;
    const notes = document.getElementById('invoiceNotes').value.trim();
    const rate = Number(document.getElementById('invoiceRate').value);
    if (!selected.length || !client || !(rate > 0)) return toast('Choose tasks, enter a client, and set a valid USD rate.', 'error');
    const button = event.submitter;
    button.disabled = true;
    button.textContent = 'Generating…';
    localStorage.setItem(RATE_KEY, rate.toFixed(2));
    const { data, error } = await sb.rpc('create_personal_invoice', {
      p_client_name: client,
      p_client_email: email,
      p_due_on: due,
      p_notes: notes,
      p_hourly_rate: rate,
      p_entry_ids: selected.map(entry => entry.id)
    });
    if (error) {
      button.disabled = false;
      button.textContent = 'Generate invoice';
      return toast(error.message, 'error');
    }
    selectedEntryIds.clear();
    await refreshBilling();
    renderInvoices();
    toast(`${data?.invoice_number || 'Invoice'} generated.`);
  }

  function invoiceHistoryTable() {
    if (!billing.invoices.length) return '<div class="empty"><strong>No invoices yet</strong><span>Your generated invoices will appear here.</span></div>';
    return `<div class="table-wrap"><table class="table invoice-history-table"><thead><tr><th>Invoice</th><th>Client</th><th>Issued / Due</th><th>Tasks / Hours</th><th>Total</th><th>Payment status</th><th>Receipt</th><th></th></tr></thead><tbody>${billing.invoices.map(invoice => {
      const items = itemsFor(invoice.id);
      const seconds = items.reduce((sum, item) => sum + Number(item.recorded_seconds || 0), 0);
      return `<tr><td><div class="td-main">${esc(invoice.invoice_number)}</div><div class="td-sub">${invoice.status === 'paid' && invoice.paid_at ? `Paid ${fmtDate(invoice.paid_at)}` : 'USD invoice'}</div></td><td><div class="td-main">${esc(invoice.client_name)}</div><div class="td-sub">${esc(invoice.client_email || '')}</div></td><td>${fmtDate(invoice.issued_on)}<div class="td-sub">${invoice.due_on ? `Due ${fmtDate(invoice.due_on)}` : 'No due date'}</div></td><td>${items.length} task${items.length === 1 ? '' : 's'}<div class="td-sub mono">${fmtDuration(seconds * 1000)}</div></td><td><strong>${money(invoice.total_amount)}</strong><div class="td-sub">@ ${money(invoice.hourly_rate)}/hr</div></td><td><select class="select invoice-status-select status-${invoice.status}" data-invoice-status="${invoice.id}"><option value="not_paid" ${invoice.status === 'not_paid' ? 'selected' : ''}>Not Paid</option><option value="pending" ${invoice.status === 'pending' ? 'selected' : ''}>Pending</option><option value="paid" ${invoice.status === 'paid' ? 'selected' : ''}>Paid</option></select></td><td>${receiptCell(invoice)}</td><td><button class="btn btn-sm" data-invoice-pdf="${invoice.id}">View invoice</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function receiptCell(invoice) {
    if (invoice.status !== 'paid') return '<span class="invoice-receipt-muted">Available when paid</span>';
    return `<div class="invoice-receipt-actions"><input type="file" id="receipt-${invoice.id}" data-invoice-receipt="${invoice.id}" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><button class="btn btn-sm" data-receipt-choose="${invoice.id}">${invoice.receipt_path ? 'Replace' : 'Upload'} receipt</button>${invoice.receipt_url ? `<button class="btn btn-sm" data-receipt-view="${invoice.id}">View</button>` : ''}</div>`;
  }

  function bindInvoiceHistory() {
    document.querySelectorAll('[data-invoice-status]').forEach(select => {
      select.onchange = () => updateInvoiceStatus(select.dataset.invoiceStatus, select.value);
    });
    document.querySelectorAll('[data-invoice-pdf]').forEach(button => {
      button.onclick = () => openInvoicePdf(button.dataset.invoicePdf);
    });
    document.querySelectorAll('[data-receipt-choose]').forEach(button => {
      button.onclick = () => document.getElementById(`receipt-${button.dataset.receiptChoose}`)?.click();
    });
    document.querySelectorAll('[data-invoice-receipt]').forEach(input => {
      input.onchange = () => input.files?.[0] && uploadReceipt(input.dataset.invoiceReceipt, input.files[0]);
    });
    document.querySelectorAll('[data-receipt-view]').forEach(button => {
      button.onclick = () => {
        const invoice = billing.invoices.find(item => item.id === button.dataset.receiptView);
        if (invoice?.receipt_url) window.open(invoice.receipt_url, '_blank', 'noopener');
      };
    });
  }

  async function updateInvoiceStatus(id, status) {
    const invoice = billing.invoices.find(item => item.id === id);
    if (!invoice || !['not_paid', 'pending', 'paid'].includes(status)) return;
    if (invoice.receipt_path && status !== 'paid' && !confirm('Changing this invoice from Paid will remove its stored payment receipt. Continue?')) {
      renderInvoices();
      return;
    }
    const payload = {
      status,
      paid_at: status === 'paid' ? (invoice.paid_at || new Date().toISOString()) : null,
      updated_at: new Date().toISOString()
    };
    if (status !== 'paid') payload.receipt_path = null;
    const { error } = await sb.from('invoices').update(payload).eq('id', id).eq('user_id', state.profile.id);
    if (error) {
      renderInvoices();
      return toast(error.message, 'error');
    }
    if (invoice.receipt_path && status !== 'paid') await sb.storage.from(RECEIPT_BUCKET).remove([invoice.receipt_path]);
    await refreshBilling();
    renderInvoices();
    toast(`Invoice marked ${statusLabel(status)}.`);
  }

  async function uploadReceipt(id, file) {
    const invoice = billing.invoices.find(item => item.id === id);
    if (!invoice || invoice.status !== 'paid') return toast('Mark the invoice as Paid before uploading a receipt.', 'error');
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) return toast('Receipt must be a JPG, PNG, WebP, or PDF file.', 'error');
    if (file.size > 10 * 1024 * 1024) return toast('Receipt must be 10 MB or smaller.', 'error');
    const path = `${state.profile.id}/${invoice.id}/${Date.now()}-${safeFileName(file.name)}`;
    toast('Uploading payment receipt…');
    const { error: uploadError } = await sb.storage.from(RECEIPT_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
    if (uploadError) return toast(uploadError.message, 'error');
    const { error: updateError } = await sb.from('invoices').update({ receipt_path: path, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', state.profile.id);
    if (updateError) {
      await sb.storage.from(RECEIPT_BUCKET).remove([path]);
      return toast(updateError.message, 'error');
    }
    if (invoice.receipt_path) await sb.storage.from(RECEIPT_BUCKET).remove([invoice.receipt_path]);
    await refreshBilling();
    renderInvoices();
    toast('Payment receipt saved privately.');
  }

  function itemsFor(invoiceId) {
    return billing.items.filter(item => item.invoice_id === invoiceId).sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  }

  function openInvoicePdf(id) {
    const invoice = billing.invoices.find(item => item.id === id);
    const items = itemsFor(id);
    if (!invoice || !items.length) return toast('Invoice details are unavailable.', 'error');
    const totalSeconds = items.reduce((sum, item) => sum + Number(item.recorded_seconds || 0), 0);
    const status = statusLabel(invoice.status);
    const receiptIsImage = invoice.receipt_url && /\.(jpe?g|png|webp)(\?|$)/i.test(invoice.receipt_path || '');
    const win = open('', '_blank');
    if (!win) return toast('Allow pop-ups to open the printable invoice.', 'error');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(invoice.invoice_number)} - JM WorkLog</title><style>
      *{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#101828;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5}@page{size:A4 portrait;margin:12mm}.toolbar{position:sticky;top:0;display:flex;justify-content:center;padding:10px;background:#101828}.toolbar button{border:0;border-radius:6px;padding:9px 15px;background:#fff;color:#101828;font-weight:800}.sheet{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:14mm;box-shadow:0 2px 16px #10182818}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #101828;padding-bottom:16px}.brand{font-size:12px;font-weight:900;letter-spacing:.16em}.head h1{font-size:30px;margin:6px 0 0}.invoice-meta{text-align:right}.invoice-meta strong{display:block;font-size:15px}.status{display:inline-block;margin-top:6px;padding:3px 7px;border:1px solid #101828;border-radius:999px;font-size:8px;font-weight:900;text-transform:uppercase}.addresses{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:24px 0}.label{display:block;color:#667085;font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.addresses strong{display:block;margin-top:5px;font-size:13px}.dates{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.dates div{border:1px solid #d0d5dd;padding:8px}.dates b{display:block;margin-top:2px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d0d5dd;padding:8px;text-align:left;vertical-align:top;word-wrap:break-word}th{background:#f2f4f7;font-size:8px;text-transform:uppercase}.right{text-align:right}.mono{font-family:Consolas,monospace}.item-note{color:#667085;font-size:9px;margin-top:2px}.totals{width:48%;margin:14px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e4e7ec}.totals .grand{font-size:16px;font-weight:900;border-bottom:2px solid #101828}.notes,.receipt{margin-top:24px;border:1px solid #d0d5dd;padding:12px;break-inside:avoid}.notes p{white-space:pre-wrap}.receipt img{display:block;max-width:100%;max-height:105mm;margin:10px auto 0;object-fit:contain}.footer{margin-top:28px;padding-top:9px;border-top:1px solid #d0d5dd;text-align:center;color:#667085;font-size:8px}@media print{body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet">
      <header class="head"><div><div class="brand">JM WORKLOG</div><h1>Invoice</h1></div><div class="invoice-meta"><strong>${esc(invoice.invoice_number)}</strong><span class="status">${esc(status)}</span></div></header>
      <section class="addresses"><div><span class="label">From</span><strong>${esc(state.profile?.full_name || 'John Mark')}</strong><span>Personal Work Record</span></div><div><span class="label">Bill to</span><strong>${esc(invoice.client_name)}</strong><span>${esc(invoice.client_email || '')}</span><div class="dates"><div><span class="label">Issued</span><b>${fmtDate(invoice.issued_on)}</b></div><div><span class="label">Due</span><b>${invoice.due_on ? fmtDate(invoice.due_on) : 'Upon receipt'}</b></div></div></div></section>
      <table><thead><tr><th>#</th><th>Task / Description</th><th>Date</th><th class="right">Hours</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead><tbody>${items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${esc(item.title)}</strong>${item.description ? `<div class="item-note">${esc(item.description)}</div>` : ''}${item.client_label || item.project_label ? `<div class="item-note">${esc([item.client_label, item.project_label].filter(Boolean).join(' · '))}</div>` : ''}</td><td>${fmtDate(item.started_at)}</td><td class="right mono">${decimalHours(item.recorded_seconds)}</td><td class="right">${money(item.hourly_rate)}</td><td class="right"><strong>${money(item.line_amount)}</strong></td></tr>`).join('')}</tbody></table>
      <div class="totals"><div><span>Recorded time</span><strong class="mono">${fmtDuration(totalSeconds * 1000)}</strong></div><div><span>Subtotal</span><strong>${money(invoice.subtotal)}</strong></div><div class="grand"><span>Total (USD)</span><strong>${money(invoice.total_amount)}</strong></div></div>
      ${invoice.notes ? `<section class="notes"><span class="label">Notes</span><p>${esc(invoice.notes)}</p></section>` : ''}
      ${invoice.status === 'paid' ? `<section class="receipt"><span class="label">Payment confirmation</span><strong>Paid ${invoice.paid_at ? fmtDate(invoice.paid_at) : ''}</strong>${invoice.receipt_path ? (receiptIsImage ? `<img src="${esc(invoice.receipt_url)}" alt="Payment receipt">` : '<p>A payment receipt PDF is stored privately in JM WorkLog.</p>') : '<p>Payment marked received. No receipt uploaded yet.</p>'}</section>` : ''}
      <footer class="footer">Generated through JM WorkLog · Personal Work Record</footer>
    </main></body></html>`);
    win.document.close();
  }
})();
