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
  const observer = new MutationObserver(enhanceTemplates);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(enhanceTemplates);
})();
