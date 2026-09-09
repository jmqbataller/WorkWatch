(() => {
  // Keep login/workspace hydration responsive even when a user has hundreds of
  // private evidence images. All callers of signed() automatically benefit.
  const SIGNED_URL_TTL_MS = 50 * 60 * 1000;
  const signedCache = new Map();
  let pending = [];
  let flushScheduled = false;
  let workspaceLoad = null;

  const originalSigned = signed;
  const originalLoadWorkspace = loadWorkspace;
  const originalHandleAuth = handleAuth;

  async function flushSignedQueue() {
    flushScheduled = false;
    const batch = pending;
    pending = [];
    if (!batch.length) return;

    const paths = [...new Set(batch.map(item => item.path))];
    const resolved = new Map();

    try {
      const { data, error } = await sb.storage.from('evidence').createSignedUrls(paths, 3600);
      if (error) throw error;

      paths.forEach((path, index) => {
        const item = (data || []).find(row => row?.path === path) || (data || [])[index];
        const url = item?.signedUrl || item?.signedURL || null;
        if (url) {
          signedCache.set(path, { url, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
          resolved.set(path, url);
        }
      });
    } catch (error) {
      console.warn('Batch evidence signing failed; continuing without blocking login.', error?.message || error);
    }

    batch.forEach(item => item.resolve(resolved.get(item.path) || signedCache.get(item.path)?.url || null));

    if (pending.length && !flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushSignedQueue);
    }
  }

  signed = function(path) {
    if (!path) return Promise.resolve(null);
    const cached = signedCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);

    return new Promise(resolve => {
      pending.push({ path, resolve });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flushSignedQueue);
      }
    });
  };

  // Prevent auth state + session recovery + realtime callbacks from launching
  // duplicate full workspace hydrations at the same time.
  loadWorkspace = function(...args) {
    if (workspaceLoad) return workspaceLoad;
    workspaceLoad = Promise.resolve()
      .then(() => originalLoadWorkspace(...args))
      .finally(() => { workspaceLoad = null; });
    return workspaceLoad;
  };

  // Give immediate feedback while authentication completes. If auth fails,
  // the original handler shows the error and this restores the button.
  handleAuth = async function(event) {
    const form = event?.currentTarget || event?.target;
    const button = form?.querySelector?.('button[type="submit"], button.btn-primary');
    const originalText = button?.textContent || 'Sign in';
    if (button) {
      button.disabled = true;
      button.textContent = state.authMode === 'signin' ? 'Signing in…' : 'Creating account…';
    }
    try {
      return await originalHandleAuth(event);
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  };

  window.WorkWatchLoginPerformance = {
    clearSignedUrlCache() { signedCache.clear(); },
    getCachedEvidenceCount() { return signedCache.size; },
    getWorkspaceLoadState() { return workspaceLoad ? 'loading' : 'idle'; },
    fallbackSigned: originalSigned
  };
})();