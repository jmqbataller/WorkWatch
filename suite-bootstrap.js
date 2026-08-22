(() => {
  const params = new URLSearchParams(location.search);
  const shareToken = params.get('share');

  async function repairFinalizedLocks() {
    if (!sb || state.profile?.role !== 'system_admin' || !window.WorkWatchSuite?.loaded) return;
    for (const report of window.WorkWatchSuite.reports || []) {
      const ids = new Set(report.entry_ids || []);
      const missing = (state.entries || []).filter(entry => ids.has(entry.id) && entry.employee_id === state.profile.id && !entry.locked_at);
      if (!missing.length) continue;
      const { error } = await sb.from('work_entries').update({ locked_at: report.finalized_at, locked_report_code: report.report_code }).in('id', missing.map(entry => entry.id)).eq('employee_id', state.profile.id);
      if (!error) missing.forEach(entry => { entry.locked_at = report.finalized_at; entry.locked_report_code = report.report_code; });
    }
  }

  if (shareToken) {
    const currentAuthView = authView;
    renderShell = function () { return currentAuthView(); };
  } else {
    const suiteLoadWorkspace = loadWorkspace;
    loadWorkspace = async function () {
      const result = await suiteLoadWorkspace();
      await repairFinalizedLocks();
      if (state.profile?.role === 'system_admin' && window.WorkWatchSuite?.loaded && state.view === 'dashboard') {
        renderShell();
      }
      return result;
    };
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
