(() => {
  const originalNewTaskForm = newTaskForm;
  const originalBindEmployeeForms = bindEmployeeForms;
  const originalRenderEmployeeDashboard = renderEmployeeDashboard;
  const originalStartTask = startTask;
  const originalFinishTask = finishTask;

  function keepLatestToastOnly() {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const items = [...root.querySelectorAll('.toast')];
    if (items.length > 1) items.slice(0, -1).forEach(item => item.remove());
  }

  const toastRoot = document.getElementById('toastRoot');
  if (toastRoot) {
    new MutationObserver(keepLatestToastOnly).observe(toastRoot, { childList: true });
  }

  newTaskForm = function () {
    if (!state.org) {
      return `
        <div class="empty" style="padding:34px 20px">
          <strong>Waiting for organization assignment</strong>
          <span>Your account is active, but a System Admin still needs to assign you to an employer or client workspace before you can track time.</span>
          <button class="btn" id="refreshAssignment" type="button" style="margin-top:14px">Refresh access</button>
        </div>`;
    }
    return originalNewTaskForm();
  };

  bindEmployeeForms = function () {
    originalBindEmployeeForms();
    const refresh = document.getElementById('refreshAssignment');
    if (refresh) {
      refresh.onclick = async () => {
        refresh.disabled = true;
        refresh.textContent = 'Checking…';
        try {
          await loadWorkspace();
        } finally {
          if (document.body.contains(refresh)) {
            refresh.disabled = false;
            refresh.textContent = 'Refresh access';
          }
        }
      };
    }
  };

  renderEmployeeDashboard = function () {
    originalRenderEmployeeDashboard();
    if (!state.org) {
      const exportButton = document.getElementById('exportToday');
      if (exportButton) {
        exportButton.disabled = true;
        exportButton.title = 'Organization assignment is required before exporting a client report.';
      }
    }
  };

  startTask = async function (event) {
    event.preventDefault();
    if (!state.org) return;

    const button = event.submitter || event.currentTarget?.querySelector('button[type="submit"], button');
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Starting…';
    }

    try {
      await originalStartTask(event);
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Start task';
      }
    }
  };

  finishTask = async function (event) {
    event.preventDefault();
    const button = event.submitter || event.currentTarget?.querySelector('button[type="submit"], button');
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Finishing…';
    }

    try {
      await originalFinishTask(event);
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Finish task';
      }
    }
  };
})();
