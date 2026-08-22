(() => {
  const params = new URLSearchParams(location.search);
  const shareToken = params.get('share');
  if (shareToken) {
    const currentAuthView = authView;
    renderShell = function () { return currentAuthView(); };
  }

  let attempts = 0;
  const boot = setInterval(async () => {
    attempts += 1;
    if (shareToken) {
      if (attempts > 30) clearInterval(boot);
      return;
    }
    if (state.profile?.role === 'system_admin' && window.WorkWatchSuite && !window.WorkWatchSuite.loaded) {
      clearInterval(boot);
      try { await loadWorkspace(); } catch (error) { console.warn('WorkWatch suite bootstrap:', error?.message || error); }
      return;
    }
    if (window.WorkWatchSuite?.loaded || attempts > 30) clearInterval(boot);
  }, 250);
})();
