(() => {
  const PENDING_FINISH_KEY = 'ww_task_finish_reset_pending';
  const RESET_ON_RELOAD_KEY = 'ww_task_finish_reset_reloading';
  const DRAFT_KEYS = [
    'ww_task_draft_v2',
    'ww_task_draft_pending_start',
    'ww_pending_checklist',
    'ww_task_prefill'
  ];

  const clearStoredTaskDraft = () => {
    DRAFT_KEYS.forEach(key => sessionStorage.removeItem(key));
  };

  const clearVisibleTaskForm = () => {
    const form = document.getElementById('personalStartForm') || document.getElementById('startForm');
    if (!form) return;

    try { form.reset(); } catch {}

    ['taskTitle', 'taskNotes', 'clientPresetSelect', 'clientLabel', 'projectLabel', 'taskChecklist'].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.value = '';
    });

    form.querySelectorAll('input[type="file"]').forEach(input => {
      try { input.value = ''; } catch {}
    });
    form.querySelectorAll('.ux-upload-preview, [data-draft-file-note]').forEach(node => node.remove());
    form.querySelectorAll('.upload-box').forEach(box => {
      box.classList.remove('has-file', 'is-uploading', 'is-dragging');
      const status = box.querySelector('.ux-upload-state');
      if (status) status.textContent = 'Paste, drop, or choose an image';
    });

    const draftStatus = form.querySelector('[data-draft-status]');
    if (draftStatus) {
      draftStatus.className = 'ww-draft-status ux-autosave-status is-saved';
      draftStatus.innerHTML = '<span></span>Draft ready · saved on this device';
    }

    form.querySelectorAll('details').forEach(details => { details.open = false; });
  };

  const activeTask = () => (typeof state !== 'undefined' ? (state.entries || []) : [])
    .filter(entry => entry.employee_id === state.profile?.id && (entry.status === 'active' || entry.status === 'paused'))
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0] || null;

  const completedTask = id => (typeof state !== 'undefined' ? (state.entries || []) : [])
    .find(entry => entry.id === id && entry.status === 'completed');

  let checking = null;
  let checkCount = 0;

  const stopChecking = () => {
    if (checking) clearInterval(checking);
    checking = null;
    checkCount = 0;
  };

  const resetAfterConfirmedFinish = () => {
    const pendingId = sessionStorage.getItem(PENDING_FINISH_KEY);
    if (!pendingId) return false;
    if (!completedTask(pendingId)) return false;

    stopChecking();
    sessionStorage.setItem(RESET_ON_RELOAD_KEY, '1');
    clearStoredTaskDraft();
    clearVisibleTaskForm();

    // Reload once so the in-memory Before screenshot cache from the completed
    // task is discarded too. Auth/session data remains intact.
    setTimeout(() => location.reload(), 30);
    return true;
  };

  const startChecking = () => {
    stopChecking();
    checking = setInterval(() => {
      checkCount += 1;
      if (resetAfterConfirmedFinish() || checkCount >= 80) stopChecking();
    }, 250);
  };

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!form || (form.id !== 'personalFinishForm' && form.id !== 'finishForm')) return;
    const task = activeTask();
    if (!task?.id) return;
    sessionStorage.setItem(PENDING_FINISH_KEY, task.id);
    startChecking();
  }, true);

  const keepDraftClearedDuringReset = () => {
    if (sessionStorage.getItem(RESET_ON_RELOAD_KEY) === '1') clearStoredTaskDraft();
  };

  // workwatch-enhancements.js saves drafts during unload/visibility changes.
  // These later listeners remove that stale save after a confirmed Finish.
  window.addEventListener('beforeunload', keepDraftClearedDuringReset);
  window.addEventListener('pagehide', keepDraftClearedDuringReset);

  if (sessionStorage.getItem(RESET_ON_RELOAD_KEY) === '1') {
    clearStoredTaskDraft();
    sessionStorage.removeItem(PENDING_FINISH_KEY);
    sessionStorage.removeItem(RESET_ON_RELOAD_KEY);
  } else if (sessionStorage.getItem(PENDING_FINISH_KEY)) {
    startChecking();
  }
})();
