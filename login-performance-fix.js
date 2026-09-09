(() => {
  const SIGNED_URL_TTL_MS = 50 * 60 * 1000;
  const signedCache = new Map();
  let pending = [];
  let flushScheduled = false;

  async function flushSignedQueue() {
    flushScheduled = false;
    const batch = pending;
    pending = [];
    if (!batch.length || !sb) return batch.forEach(item => item.resolve(null));

    const paths = [...new Set(batch.map(item => item.path))];
    const resolved = new Map();

    try {
      const { data, error } = await sb.storage.from('evidence').createSignedUrls(paths, 3600);
      if (error) throw error;
      paths.forEach((path, index) => {
        const row = (data || []).find(item => item?.path === path) || (data || [])[index];
        const url = row?.signedUrl || row?.signedURL || null;
        if (url) {
          signedCache.set(path, { url, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
          resolved.set(path, url);
        }
      });
    } catch (error) {
      console.warn('Evidence URL batch signing failed:', error?.message || error);
    }

    batch.forEach(item => item.resolve(resolved.get(item.path) || signedCache.get(item.path)?.url || null));
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

  window.WorkWatchEvidenceBatch = {
    clear() { signedCache.clear(); },
    cachedCount() { return signedCache.size; }
  };
})();
