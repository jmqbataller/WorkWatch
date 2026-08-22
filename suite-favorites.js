(() => {
  function enhanceTemplates() {
    if (state.profile?.role !== 'system_admin' || state.view !== 'templates' || !window.WorkWatchSuite?.loaded) return;
    document.querySelectorAll('[data-use-template]').forEach(useButton => {
      const id = useButton.dataset.useTemplate;
      const row = useButton.closest('tr');
      const cell = useButton.closest('td');
      if (!row || !cell || cell.querySelector(`[data-toggle-favorite="${id}"]`)) return;
      const template = window.WorkWatchSuite.templates.find(item => item.id === id);
      if (!template) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm';
      button.dataset.toggleFavorite = id;
      button.textContent = template.favorite ? '★ Favorite' : '☆ Favorite';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const next = !template.favorite;
        const { error } = await sb.from('task_templates').update({ favorite: next }).eq('id', id).eq('user_id', state.profile.id);
        if (error) { button.disabled = false; return toast(error.message, 'error'); }
        template.favorite = next;
        button.textContent = next ? '★ Favorite' : '☆ Favorite';
        button.disabled = false;
        toast(next ? 'Template added to favorites.' : 'Template removed from favorites.');
      });
      cell.insertBefore(button, useButton.nextSibling);
      cell.insertBefore(document.createTextNode(' '), button);
    });
  }

  function replaceVaNameLabel(root = document) {
    root.querySelectorAll('.suite-share-summary span, .record-info .label').forEach(label => {
      if (label.textContent.trim().toLowerCase() === 'va name') label.textContent = 'Full Name';
    });
  }

  const nativeOpen = window.open.bind(window);
  window.open = function (...args) {
    const child = nativeOpen(...args);
    if (child?.document?.write) {
      const nativeWrite = child.document.write.bind(child.document);
      child.document.write = (...parts) => nativeWrite(...parts.map(part =>
        typeof part === 'string' ? part.replace(/>VA Name</g, '>Full Name<') : part
      ));
    }
    return child;
  };

  const observer = new MutationObserver(() => {
    enhanceTemplates();
    replaceVaNameLabel();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(() => {
    enhanceTemplates();
    replaceVaNameLabel();
  });
})();
