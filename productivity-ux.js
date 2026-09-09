(() => {
  const GROUP_STATE_KEY = 'jm_worklog_nav_groups';
  const COMPACT_KEY = 'jm_worklog_compact_ui';
  const previewUrls = new WeakMap();
  const saveTimers = new WeakMap();

  const navGroups = [
    { id: 'track', label: 'Track', views: ['dashboard', 'history', 'calendar'] },
    { id: 'reports', label: 'Reports', views: ['reports', 'custom-export', 'weekly-summary', 'invoices', 'finalized'] },
    { id: 'manage', label: 'Manage', views: ['templates', 'clients'] },
    { id: 'insights', label: 'Insights', views: ['journal', 'analytics'] },
    { id: 'system', label: 'Workspace', views: ['audit', 'trash', 'storage', 'settings', 'organizations', 'users', 'team'] }
  ];

  const metricIcons = {
    time: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    task: '<svg viewBox="0 0 24 24"><path d="M8 6h11M8 12h11M8 18h11"/><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"/></svg>',
    status: '<svg viewBox="0 0 24 24"><path d="M5 19V8m7 11V5m7 14v-7"/></svg>',
    proof: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m6 17 4-4 3 3 2-2 3 3"/></svg>'
  };

  const parseStoredObject = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  };

  function groupNavigation() {
    const nav = document.querySelector('.sidebar .nav');
    if (!nav || nav.dataset.grouped === 'true') return;
    const buttons = [...nav.querySelectorAll(':scope > .nav-btn')];
    if (buttons.length < 4) return;
    nav.dataset.grouped = 'true';
    const collapsed = parseStoredObject(GROUP_STATE_KEY);

    navGroups.forEach(group => {
      const members = buttons.filter(button => group.views.includes(button.dataset.view));
      if (!members.length) return;
      const section = document.createElement('section');
      section.className = 'nav-group';
      section.dataset.navGroup = group.id;
      const hasSavedState = Object.prototype.hasOwnProperty.call(collapsed, group.id);
      const defaultCollapsed = ['manage', 'insights', 'system'].includes(group.id);
      const isCollapsed = (hasSavedState ? Boolean(collapsed[group.id]) : defaultCollapsed) && !members.some(button => button.classList.contains('active'));
      section.classList.toggle('is-collapsed', isCollapsed);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nav-group-toggle';
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.innerHTML = `<span>${group.label}</span><span class="nav-group-chevron">⌄</span>`;
      toggle.onclick = () => {
        const closed = section.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!closed));
        const next = parseStoredObject(GROUP_STATE_KEY);
        next[group.id] = closed;
        localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(next));
      };

      const items = document.createElement('div');
      items.className = 'nav-group-items';
      members.forEach(button => items.appendChild(button));
      section.append(toggle, items);
      nav.appendChild(section);
    });

    const grouped = new Set(navGroups.flatMap(group => group.views));
    const remaining = buttons.filter(button => !grouped.has(button.dataset.view));
    if (remaining.length) {
      const section = document.createElement('section');
      section.className = 'nav-group';
      section.innerHTML = '<div class="nav-group-static">More</div><div class="nav-group-items"></div>';
      remaining.forEach(button => section.lastElementChild.appendChild(button));
      nav.appendChild(section);
    }
  }

  function goToNewTask() {
    if (typeof state === 'undefined') return;
    if (state.view !== 'dashboard') {
      state.view = 'dashboard';
      renderShell();
    }
    requestAnimationFrame(() => {
      const title = document.getElementById('taskTitle');
      if (title) {
        title.scrollIntoView({ behavior: 'smooth', block: 'center' });
        title.focus();
      } else {
        document.querySelector('.tracker-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('Finish your active task before starting another one.');
      }
    });
  }

  function addTopbarActions() {
    const actions = document.querySelector('.top-actions');
    if (!actions) return;
    const canTrackTasks = ['system_admin', 'employee'].includes(state?.profile?.role);
    if (canTrackTasks && !actions.querySelector('.ux-quick-task')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm btn-primary ux-quick-task';
      button.innerHTML = '<span aria-hidden="true">＋</span><span>New task</span>';
      button.onclick = goToNewTask;
      actions.appendChild(button);
    }
    if (!actions.querySelector('.ux-compact-toggle')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm ux-compact-toggle';
      button.setAttribute('aria-pressed', String(document.body.classList.contains('compact-ui')));
      button.textContent = document.body.classList.contains('compact-ui') ? 'Comfortable' : 'Compact';
      button.onclick = () => {
        const compact = document.body.classList.toggle('compact-ui');
        localStorage.setItem(COMPACT_KEY, compact ? '1' : '0');
        button.setAttribute('aria-pressed', String(compact));
        button.textContent = compact ? 'Comfortable' : 'Compact';
      };
      actions.appendChild(button);
    }
    if (!actions.querySelector('.ux-sync-status')) {
      const status = document.createElement('span');
      status.className = 'ux-sync-status';
      actions.prepend(status);
    }
    updateConnectionStatus();
  }

  function updateConnectionStatus() {
    const online = navigator.onLine;
    document.querySelectorAll('.ux-sync-status').forEach(status => {
      if (status.dataset.online === String(online)) return;
      status.dataset.online = String(online);
      status.classList.toggle('is-offline', !online);
      status.innerHTML = `<span></span>${online ? 'Online' : 'Offline'}`;
    });
  }

  function addWorkflowGuidance() {
    const start = document.getElementById('personalStartForm') || document.getElementById('startForm');
    if (start && !start.querySelector('.ux-workflow')) {
      start.insertAdjacentHTML('afterbegin', `<div class="ux-workflow" aria-label="Task setup progress">
        <span class="is-active"><i>1</i>Task details</span><b></b><span><i>2</i>Before proof</span><b></b><span><i>3</i>Start timer</span>
      </div>`);
    }

    const active = document.querySelector('.tracker-card.active, .tracker-card.paused');
    const body = active?.closest('.panel-body');
    if (body && !body.querySelector('.ux-workflow')) {
      body.insertAdjacentHTML('afterbegin', `<div class="ux-workflow ux-workflow-active" aria-label="Active task progress">
        <span class="is-done"><i>✓</i>Started</span><b></b><span class="is-active"><i>2</i>During work</span><b></b><span><i>3</i>After proof</span><b></b><span><i>4</i>Finish</span>
      </div>`);
    }
  }

  function collapseOptionalFields() {
    const form = document.getElementById('personalStartForm');
    const grid = form?.querySelector('.form-grid');
    if (!grid || grid.querySelector('.ux-optional-fields')) return;
    const ids = ['clientPresetSelect', 'clientLabel', 'projectLabel', 'taskChecklist', 'clientInstructions'];
    const fields = ids.map(id => document.getElementById(id)?.closest('.field, .pro-instructions')).filter(Boolean);
    if (!fields.length) return;
    const details = document.createElement('details');
    details.className = 'full ux-optional-fields';
    details.innerHTML = '<summary><span>Optional task details</span><small>Client, project and checklist</small></summary><div class="ux-optional-grid"></div>';
    const wrapper = details.lastElementChild;
    grid.insertBefore(details, fields[0]);
    fields.forEach(field => wrapper.appendChild(field));
  }

  function addStickySession() {
    const topbar = document.querySelector('.topbar');
    const active = document.querySelector('.tracker-card.active, .tracker-card.paused');
    let sticky = document.querySelector('.ux-sticky-session');
    if (!topbar || !active) {
      sticky?.remove();
      return;
    }
    if (!sticky) {
      sticky = document.createElement('div');
      sticky.className = 'ux-sticky-session';
      topbar.insertAdjacentElement('afterend', sticky);
    }
    const task = active.querySelector('.tracker-task')?.textContent?.trim() || 'Active task';
    const stateText = active.querySelector('.tracker-state')?.textContent?.trim() || 'Working';
    const time = active.querySelector('[data-active-timer]')?.textContent || '00:00:00';
    const paused = active.classList.contains('paused');
    const signature = `${task}:${stateText}:${paused}`;
    if (sticky.dataset.signature === signature) return;
    sticky.dataset.signature = signature;
    sticky.innerHTML = `<div class="ux-sticky-live"><span></span>${stateText}</div><strong>${task}</strong><time data-active-timer>${time}</time><div class="ux-sticky-actions"><button class="btn btn-sm" data-sticky-pause>${paused ? 'Resume' : 'Pause'}</button><button class="btn btn-sm btn-primary" data-sticky-finish>Finish</button></div>`;
    sticky.querySelector('[data-sticky-pause]').onclick = () => document.getElementById(paused ? 'resumeTask' : 'pauseTask')?.click();
    sticky.querySelector('[data-sticky-finish]').onclick = () => {
      const form = document.getElementById('personalFinishForm') || document.getElementById('finishForm');
      form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form?.querySelector('input[type="file"]')?.focus();
    };
  }

  function filesFromClipboard(event) {
    return [...(event.clipboardData?.items || [])]
      .filter(item => item.kind === 'file' && /^image\//i.test(item.type || ''))
      .map(item => item.getAsFile()).filter(Boolean);
  }

  function assignFiles(input, files) {
    if (!input || !files.length) return false;
    try {
      const transfer = new DataTransfer();
      files.slice(0, input.multiple ? files.length : 1).forEach(file => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch { return false; }
  }

  function clearPreviewUrls(box) {
    (previewUrls.get(box) || []).forEach(url => URL.revokeObjectURL(url));
    previewUrls.delete(box);
  }

  function renderUploadPreview(box, input) {
    clearPreviewUrls(box);
    box.querySelector('.ux-upload-preview')?.remove();
    const files = [...(input.files || [])];
    const stateEl = box.querySelector('.ux-upload-state');
    if (!files.length) {
      box.classList.remove('has-file');
      if (stateEl) stateEl.textContent = 'Paste, drop, or choose an image';
      return;
    }
    box.classList.add('has-file');
    const urls = files.slice(0, 3).map(file => URL.createObjectURL(file));
    previewUrls.set(box, urls);
    const preview = document.createElement('div');
    preview.className = 'ux-upload-preview';
    const thumbs = urls.map((url, index) => `<img src="${url}" alt="Selected evidence ${index + 1}">`).join('');
    preview.innerHTML = `<div class="ux-upload-thumbs">${thumbs}</div><div><strong>${files.length === 1 ? files[0].name : `${files.length} images selected`}</strong><span>Ready to upload</span></div><button class="btn btn-sm" type="button" data-replace>Replace</button><button class="btn btn-sm btn-ghost" type="button" data-remove>Remove</button>`;
    preview.querySelector('[data-replace]').onclick = () => input.click();
    preview.querySelector('[data-remove]').onclick = () => {
      try { input.files = new DataTransfer().files; } catch { input.value = ''; }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    input.insertAdjacentElement('afterend', preview);
    if (stateEl) stateEl.textContent = 'Evidence ready';
  }

  function improveUploader(box) {
    if (box.dataset.uxUploader === 'true') return;
    const input = box.querySelector('input[type="file"]');
    if (!input) return;
    box.dataset.uxUploader = 'true';
    box.tabIndex = 0;
    box.setAttribute('role', 'group');
    box.insertAdjacentHTML('afterbegin', '<div class="ux-upload-state">Paste, drop, or choose an image</div>');
    input.addEventListener('change', () => renderUploadPreview(box, input));
    box.addEventListener('paste', event => {
      if (event.target.closest('[data-paste-task]')) return;
      const files = filesFromClipboard(event);
      if (!files.length) return;
      event.preventDefault();
      if (assignFiles(input, files)) toast(`${files.length} screenshot${files.length === 1 ? '' : 's'} pasted.`);
    });
    box.addEventListener('dragover', event => event.preventDefault());
    box.addEventListener('drop', event => {
      event.preventDefault();
      const files = [...(event.dataTransfer?.files || [])].filter(file => /^image\//i.test(file.type));
      if (assignFiles(input, files)) toast(`${files.length} screenshot${files.length === 1 ? '' : 's'} added.`);
    });
    if (input.files?.length) renderUploadPreview(box, input);
  }

  function bindUploadProgress() {
    document.querySelectorAll('form').forEach(form => {
      if (form.dataset.uxUploadProgress || !form.querySelector('.upload-box input[type="file"]')) return;
      form.dataset.uxUploadProgress = 'true';
      form.addEventListener('submit', () => {
        const stateEl = form.querySelector('.ux-upload-state');
        if (stateEl) stateEl.textContent = 'Uploading securely…';
        form.querySelector('.upload-box')?.classList.add('is-uploading');
      });
    });
  }

  function bindAutosaveStatus() {
    const form = document.getElementById('personalStartForm');
    if (!form || form.dataset.uxAutosave === 'true') return;
    form.dataset.uxAutosave = 'true';
    let status = form.querySelector('[data-draft-status]');
    if (!status) {
      status = document.createElement('div');
      status.dataset.draftStatus = '';
      form.querySelector('.task-actions')?.insertAdjacentElement('beforebegin', status);
    }
    status.className = 'ww-draft-status ux-autosave-status is-saved';
    status.innerHTML = '<span></span>Draft ready · saved on this device';
    form.addEventListener('input', () => {
      status.className = 'ww-draft-status ux-autosave-status is-saving';
      status.innerHTML = '<span></span>Saving draft…';
      clearTimeout(saveTimers.get(form));
      saveTimers.set(form, setTimeout(() => {
        status.className = 'ww-draft-status ux-autosave-status is-saved';
        status.innerHTML = `<span></span>Draft saved · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      }, 450));
    });
  }

  function enhanceEmptyStates() {
    document.querySelectorAll('.empty').forEach(empty => {
      if (empty.dataset.uxEmpty || empty.querySelector('button')) return;
      const text = empty.textContent.toLowerCase();
      if (!/no work entries|no matching|no records|no data yet/.test(text)) return;
      empty.dataset.uxEmpty = 'true';
      empty.classList.add('ux-empty-state');
      const canTrackTasks = ['system_admin', 'employee'].includes(state?.profile?.role);
      if (canTrackTasks && /no work entries|no records/.test(text)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-primary';
        button.textContent = 'Start a task';
        button.onclick = goToNewTask;
        empty.appendChild(button);
      }
    });
  }

  function labelResponsiveTables() {
    document.querySelectorAll('.table').forEach(table => {
      const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(row => {
        [...row.children].forEach((cell, index) => {
          const label = labels[index] || 'Details';
          if (cell.dataset.label !== label) cell.dataset.label = label;
        });
      });
      if (table.dataset.cardReady !== 'true') table.dataset.cardReady = 'true';
    });
  }

  function enhanceMetrics() {
    document.querySelectorAll('.metric').forEach((metric, index) => {
      if (metric.querySelector('.ux-metric-icon')) return;
      const label = metric.querySelector('.metric-k')?.textContent.toLowerCase() || '';
      const key = /time|recorded|tracked|break/.test(label) ? 'time' : /task|completed/.test(label) ? 'task' : /evidence|verified|proof/.test(label) ? 'proof' : 'status';
      const icon = document.createElement('span');
      icon.className = `ux-metric-icon ux-metric-${key}`;
      icon.innerHTML = metricIcons[key] || metricIcons.status;
      metric.appendChild(icon);
      metric.style.setProperty('--metric-order', index);
    });
    const metrics = document.querySelector('.page > .metrics');
    const target = document.getElementById('suiteTargetPanel');
    if (metrics && target && metrics.nextElementSibling !== target) metrics.insertAdjacentElement('afterend', target);
  }

  function enhance() {
    groupNavigation();
    addTopbarActions();
    addWorkflowGuidance();
    collapseOptionalFields();
    addStickySession();
    document.querySelectorAll('.upload-box').forEach(improveUploader);
    bindUploadProgress();
    bindAutosaveStatus();
    enhanceEmptyStates();
    labelResponsiveTables();
    enhanceMetrics();
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  };

  if (localStorage.getItem(COMPACT_KEY) === '1') document.body.classList.add('compact-ui');
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  window.addEventListener('beforeunload', () => document.querySelectorAll('.upload-box').forEach(clearPreviewUrls));
  new MutationObserver(schedule).observe(document.getElementById('app'), { childList: true, subtree: true });
  schedule();
})();
