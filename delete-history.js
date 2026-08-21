(() => {
  const OWNER_ROLE = 'system_admin';
  const baseRenderPage = renderPage;

  function historyEntries() {
    return (state.entries || [])
      .filter(entry => entry.employee_id === state.profile?.id)
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  }

  function addDeleteButtons() {
    if (state.profile?.role !== OWNER_ROLE || state.view !== 'history') return;

    document.querySelectorAll('[data-edit-entry]').forEach(editButton => {
      const cell = editButton.closest('td');
      if (!cell || cell.querySelector('[data-delete-entry]')) return;

      const id = editButton.dataset.editEntry;
      const entry = historyEntries().find(item => item.id === id);
      if (!entry || entry.status !== 'completed') return;

      cell.classList.add('history-actions-cell');
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn-sm btn-danger-outline';
      deleteButton.dataset.deleteEntry = id;
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => openDeleteConfirm(entry));
      cell.appendChild(deleteButton);
    });
  }

  function collectEvidencePaths(entry) {
    const paths = new Set();
    [entry.before_path, entry.during_path, entry.after_path].filter(Boolean).forEach(path => paths.add(path));
    (entry.during_evidence || []).forEach(item => {
      if (item?.path) paths.add(item.path);
    });
    return [...paths];
  }

  function openDeleteConfirm(entry) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal delete-history-modal">
        <div class="modal-head">
          <div>
            <h3>Delete work record?</h3>
            <p>This permanently removes the time record and its screenshot evidence.</p>
          </div>
          <button class="modal-close" type="button">×</button>
        </div>
        <div class="modal-body">
          <div class="delete-record-summary">
            <strong>${esc(entry.title)}</strong>
            <span>${fmtDate(entry.started_at)} · ${fmtTime(entry.started_at)} – ${fmtTime(entry.ended_at)}</span>
          </div>
          <div class="delete-warning">This action cannot be undone.</div>
          <div class="task-actions">
            <button class="btn modal-cancel" type="button">Cancel</button>
            <button class="btn btn-danger" id="confirmDeleteWorkEntry" type="button">Delete record</button>
          </div>
        </div>
      </div>`;

    const close = () => wrap.remove();
    wrap.addEventListener('click', event => {
      if (event.target === wrap || event.target.classList.contains('modal-close') || event.target.classList.contains('modal-cancel')) close();
    });

    wrap.querySelector('#confirmDeleteWorkEntry').addEventListener('click', async event => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Deleting…';

      try {
        const paths = collectEvidencePaths(entry);
        const { error } = await sb
          .from('work_entries')
          .delete()
          .eq('id', entry.id)
          .eq('employee_id', state.profile.id)
          .eq('status', 'completed');
        if (error) throw error;

        let storageWarning = false;
        if (paths.length) {
          const { error: storageError } = await sb.storage.from('evidence').remove(paths);
          if (storageError) {
            console.warn('Work record deleted but some evidence files could not be removed:', storageError.message);
            storageWarning = true;
          }
        }

        close();
        await loadWorkspace();
        toast(storageWarning ? 'Work record deleted. Some old evidence files may need cleanup.' : 'Work record and evidence deleted.');
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Delete record';
        toast(error.message || 'Could not delete the work record.', 'error');
      }
    });

    document.body.appendChild(wrap);
  }

  renderPage = function (role) {
    const result = baseRenderPage(role);
    queueMicrotask(addDeleteButtons);
    return result;
  };

  const observer = new MutationObserver(() => addDeleteButtons());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
