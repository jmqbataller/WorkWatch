(() => {
  const icons = {
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  };

  function closeMobileNav() {
    document.body.classList.remove('nav-open');
    document.querySelector('.mobile-nav')?.setAttribute('aria-expanded', 'false');
  }

  function addMobileNavigation() {
    const topbar = document.querySelector('.topbar');
    const sidebar = document.querySelector('.sidebar');
    if (!topbar || !sidebar) return;

    if (!topbar.querySelector('.mobile-nav')) {
      const button = document.createElement('button');
      button.className = 'mobile-nav';
      button.type = 'button';
      button.setAttribute('aria-label', 'Open navigation');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = icons.menu;
      button.onclick = () => {
        const open = document.body.classList.toggle('nav-open');
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        button.innerHTML = open ? icons.close : icons.menu;
      };
      topbar.prepend(button);
    }

    let overlay = document.querySelector('.mobile-overlay');
    if (!overlay) {
      overlay = document.createElement('button');
      overlay.className = 'mobile-overlay';
      overlay.type = 'button';
      overlay.setAttribute('aria-label', 'Close navigation');
      overlay.onclick = closeMobileNav;
      document.body.appendChild(overlay);
    }

    sidebar.querySelectorAll('.nav-btn').forEach(button => {
      if (button.dataset.mobileBound) return;
      button.dataset.mobileBound = 'true';
      button.addEventListener('click', closeMobileNav);
    });
  }

  function addTopbarContext() {
    const actions = document.querySelector('.top-actions');
    if (!actions || actions.querySelector('.top-date')) return;
    const date = document.createElement('span');
    date.className = 'top-date';
    date.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric'
    }).format(new Date());
    actions.prepend(date);
  }

  function improveSemantics() {
    document.querySelectorAll('.logout-btn').forEach(button => {
      button.title = 'Sign out';
      button.setAttribute('aria-label', 'Sign out');
    });
    document.querySelectorAll('.wordmark').forEach(mark => mark.setAttribute('aria-label', 'JM WorkLog'));
    document.querySelectorAll('.upload-box').forEach(box => {
      if (box.dataset.dragBound) return;
      box.dataset.dragBound = 'true';
      ['dragenter', 'dragover'].forEach(name => box.addEventListener(name, event => {
        event.preventDefault();
        box.classList.add('is-dragging');
      }));
      ['dragleave', 'drop'].forEach(name => box.addEventListener(name, () => box.classList.remove('is-dragging')));
    });
  }

  function enhance() {
    addMobileNavigation();
    addTopbarContext();
    improveSemantics();
  }

  let queued = false;
  const scheduleEnhance = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  };

  new MutationObserver(scheduleEnhance).observe(document.getElementById('app'), {
    childList: true,
    subtree: true
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeMobileNav();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMobileNav();
  });
  scheduleEnhance();
})();
