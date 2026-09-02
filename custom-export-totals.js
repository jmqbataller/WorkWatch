(() => {
  const TOTAL_ID = 'wwCustomExportTotalRecorded';

  function parseSelectionSummary(text = '') {
    const countMatch = text.match(/(\d+)\s+task/i);
    const durationMatch = text.match(/(\d{2,}:\d{2}:\d{2})/);
    return {
      count: countMatch ? Number(countMatch[1]) : 0,
      duration: durationMatch ? durationMatch[1] : '00:00:00'
    };
  }

  function patchCustomExportTotal() {
    if (typeof state === 'undefined' || state.view !== 'custom-export') return;

    const summary = document.getElementById('wwSelectionSummary');
    const toolbar = document.querySelector('.ww-export-toolbar');
    if (!summary || !toolbar) return;

    const { count, duration } = parseSelectionSummary(summary.textContent || '');
    const expectedSummary = `${count} task${count === 1 ? '' : 's'} selected · Total recorded ${duration}`;
    if (summary.textContent !== expectedSummary) summary.textContent = expectedSummary;

    let total = document.getElementById(TOTAL_ID);
    if (!total) {
      total = document.createElement('div');
      total.id = TOTAL_ID;
      total.className = 'ww-export-live-total';
      total.innerHTML = `
        <div>
          <span>Total hours recorded</span>
          <strong data-ww-total-recorded>00:00:00</strong>
        </div>
        <small>Automatically totals the recorded time of every selected task. Break time remains excluded.</small>`;
      toolbar.insertAdjacentElement('afterend', total);
    }

    const value = total.querySelector('[data-ww-total-recorded]');
    if (value && value.textContent !== duration) value.textContent = duration;
    total.classList.toggle('has-selection', count > 0);
  }

  const observer = new MutationObserver(() => queueMicrotask(patchCustomExportTotal));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  document.addEventListener('change', event => {
    if (event.target?.matches?.('[data-ww-export-id], #wwExportClient, #wwExportProject, #wwExportDay')) {
      queueMicrotask(patchCustomExportTotal);
    }
  });

  document.addEventListener('input', event => {
    if (event.target?.id === 'wwExportSearch') queueMicrotask(patchCustomExportTotal);
  });

  const style = document.createElement('style');
  style.textContent = `
    .ww-export-live-total{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;padding:14px 16px;border:1px solid #d0d5dd;border-radius:10px;background:#fff}
    .ww-export-live-total>div{display:flex;align-items:baseline;gap:12px;min-width:0}
    .ww-export-live-total span{font-size:12px;font-weight:700;color:#475467;text-transform:uppercase;letter-spacing:.04em}
    .ww-export-live-total strong{font-family:Consolas,monospace;font-size:24px;line-height:1;color:#101828}
    .ww-export-live-total small{color:#667085;text-align:right;line-height:1.4}
    @media(max-width:700px){.ww-export-live-total{align-items:flex-start;flex-direction:column}.ww-export-live-total small{text-align:left}.ww-export-live-total>div{width:100%;justify-content:space-between}}
  `;
  document.head.appendChild(style);

  queueMicrotask(patchCustomExportTotal);
})();
