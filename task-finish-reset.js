(() => {
  const PENDING_FINISH_KEY = 'ww_task_finish_reset_pending';
  const RESET_ON_RELOAD_KEY = 'ww_task_finish_reset_reloading';
  const DRAFT_KEY = 'ww_task_draft_v2';
  const DRAFT_KEYS = [
    DRAFT_KEY,
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
      if (field) {
        field.value = '';
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
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

    // Clearing the fields above can trigger the draft persistence listeners.
    // Remove the draft again after those synchronous change handlers finish.
    clearStoredTaskDraft();
  };

  const ownTasks = () => {
    if (typeof state === 'undefined' || !state.profile?.id) return [];
    return (state.entries || []).filter(entry => entry.employee_id === state.profile.id && !entry.deleted_at);
  };

  const activeTask = () => ownTasks()
    .filter(entry => entry.status === 'active' || entry.status === 'paused')
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0] || null;

  const completedTask = id => ownTasks().find(entry => entry.id === id && entry.status === 'completed');

  const latestCompletedTask = () => ownTasks()
    .filter(entry => entry.status === 'completed')
    .sort((a, b) => new Date(b.ended_at || b.started_at || 0) - new Date(a.ended_at || a.started_at || 0))[0] || null;

  const readDraft = () => {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') || {}; }
    catch { return {}; }
  };

  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ');

  let checking = null;
  let checkCount = 0;

  const stopChecking = () => {
    if (checking) clearInterval(checking);
    checking = null;
    checkCount = 0;
  };

  const finishIsConfirmed = pendingId => {
    if (completedTask(pendingId)) return true;

    // Fallback for render/load timing: once the submitted task is no longer
    // active and the Finish form has disappeared, the successful completion
    // render has occurred. Failed submissions keep the task/form active.
    const active = activeTask();
    const finishForm = document.getElementById('personalFinishForm') || document.getElementById('finishForm');
    return !active && !finishForm && ownTasks().some(entry => entry.id === pendingId && entry.status === 'completed');
  };

  const resetAfterConfirmedFinish = () => {
    const pendingId = sessionStorage.getItem(PENDING_FINISH_KEY);
    if (!pendingId || !finishIsConfirmed(pendingId)) return false;

    stopChecking();
    sessionStorage.setItem(RESET_ON_RELOAD_KEY, '1');
    clearStoredTaskDraft();
    clearVisibleTaskForm();

    // A reload is intentional here: workwatch-enhancements.js keeps the chosen
    // Before image in a closure for draft recovery. Reloading is the reliable
    // way to discard that in-memory File object after a completed task.
    setTimeout(() => location.reload(), 50);
    return true;
  };

  const startChecking = () => {
    stopChecking();
    checking = setInterval(() => {
      checkCount += 1;
      if (resetAfterConfirmedFinish() || checkCount >= 120) stopChecking();
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

  // workwatch-enhancements.js writes drafts on unload/visibility changes.
  // These listeners run after it and remove any stale re-save during reset.
  window.addEventListener('beforeunload', keepDraftClearedDuringReset);
  window.addEventListener('pagehide', keepDraftClearedDuringReset);

  // Repair drafts left behind by tasks that were completed before this fix was
  // deployed. We only clear when there is no active task and the saved draft
  // exactly matches the most recently completed task, so normal unfinished
  // drafts continue to survive tab switches/reloads.
  let legacyAttempts = 0;
  const repairLegacyFinishedDraft = () => {
    legacyAttempts += 1;
    const draft = readDraft();
    const draftTitle = normalize(draft.taskTitle);

    if (!draftTitle) return true;
    if (activeTask()) return true;

    const latest = latestCompletedTask();
    if (!latest) return legacyAttempts >= 80;

    const sameTitle = draftTitle === normalize(latest.title);
    const sameNotes = normalize(draft.taskNotes) === normalize(latest.notes);

    if (sameTitle && sameNotes) {
      clearStoredTaskDraft();
      clearVisibleTaskForm();
      return true;
    }

    return true;
  };

  if (sessionStorage.getItem(RESET_ON_RELOAD_KEY) === '1') {
    clearStoredTaskDraft();
    sessionStorage.removeItem(PENDING_FINISH_KEY);
    sessionStorage.removeItem(RESET_ON_RELOAD_KEY);
  } else if (sessionStorage.getItem(PENDING_FINISH_KEY)) {
    startChecking();
  }

  const legacyTimer = setInterval(() => {
    if (repairLegacyFinishedDraft() || legacyAttempts >= 80) clearInterval(legacyTimer);
  }, 250);
})();
