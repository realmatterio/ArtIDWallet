/* ==========================================================================
   wallet-ui.js

   Presentation behaviour shared by the human and agent wallets. Everything
   here works from markup attributes, so neither page's wallet logic needs to
   know about it:

     [data-theme-toggle]          cycles light / dark (saved per viewer)
     .rs-wallet-card              sheen follows the pointer
     [data-filter-target="id"]    search box that filters the cards in #id
     [data-receive-from="id"]     opens the receive sheet for the address in
                                  #id's title attribute
     [data-scroll-to="id"]        scrolls to #id and focuses its first control
     [data-click="id"]            forwards the click to #id
     [data-live-preview]          artwork card that mirrors the register form
   ========================================================================== */

(function (global) {
  'use strict';

  var THEME_KEY = 'artid.theme';
  var $ = function (id) { return document.getElementById(id); };

  /* --- theme ------------------------------------------------------------- */

  function currentTheme() {
    var set = document.documentElement.dataset.theme;
    if (set) return set;
    return global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (error) { /* won't persist */ }
    applyTheme(next);
  }

  /* --- wallet card sheen --------------------------------------------------- */

  function bindSheen(card) {
    if (card.dataset.sheen) return;
    card.dataset.sheen = '1';
    card.addEventListener('pointermove', function (event) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((event.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      card.style.setProperty('--my', ((event.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    });
    card.addEventListener('pointerleave', function () {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    });
  }

  /* --- search filters ------------------------------------------------------ */

  var ITEMS = '.rs-piece, .rs-art-card, .rs-person';

  function applyFilter(input) {
    var target = $(input.dataset.filterTarget);
    if (!target) return;
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    target.querySelectorAll(ITEMS).forEach(function (item) {
      var hit = !q || item.textContent.toLowerCase().indexOf(q) !== -1;
      item.hidden = !hit;
      if (hit) shown++;
    });
    var empty = target.querySelector(':scope > .rs-filter-empty');
    var any = target.querySelector(ITEMS);
    if (q && any && !shown) {
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'rs-filter-empty';
        target.appendChild(empty);
      }
      empty.textContent = 'Nothing matches “' + input.value.trim() + '”.';
    } else if (empty) {
      empty.remove();
    }
  }

  function bindFilter(input) {
    var target = $(input.dataset.filterTarget);
    if (!target) return;
    input.addEventListener('input', function () { applyFilter(input); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && input.value) { input.value = ''; applyFilter(input); }
    });
    // the page re-renders the grid freely; keep the filter applied afterwards
    new MutationObserver(function (records) {
      var external = records.some(function (r) {
        return Array.prototype.some.call(r.addedNodes, function (n) { return !(n.classList && n.classList.contains('rs-filter-empty')); });
      });
      if (external && input.value) applyFilter(input);
    }).observe(target, { childList: true });
  }

  /* --- receive sheet ------------------------------------------------------- */

  function openReceive(sourceId) {
    var source = $(sourceId);
    var dialog = $('receiveDialog');
    var address = source && source.title;
    if (!dialog) return;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      if (global.showChainStatus) global.showChainStatus('Unlock the wallet to show its address.', 'info');
      return;
    }
    var name = source.closest('.rs-account') && source.closest('.rs-account').querySelector('.rs-idcard-name');
    $('receiveName').textContent = name ? name.textContent : 'This wallet';
    $('receiveAddress').textContent = address;
    var canvas = $('receiveQr');
    if (global.QRCode) {
      QRCode.toCanvas(canvas, 'ethereum:' + address, {
        width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f1115', light: '#ffffff' }
      }, function (error) { if (error) console.error(error); });
    }
    var copy = $('receiveCopy');
    copy.onclick = function () {
      navigator.clipboard.writeText(address).then(function () {
        copy.classList.add('is-copied');
        copy.querySelector('span').textContent = 'Copied';
        setTimeout(function () {
          copy.classList.remove('is-copied');
          copy.querySelector('span').textContent = 'Copy address';
        }, 1600);
      }).catch(function () { /* the address is shown in full above */ });
    };
    dialog.showModal();
  }

  /* --- scroll helpers ------------------------------------------------------ */

  function scrollToTarget(id) {
    var el = $(id);
    if (!el) return;
    var reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    var control = el.querySelector('input:not([type=hidden]):not(:disabled), button:not(:disabled)');
    if (control) setTimeout(function () { control.focus({ preventScroll: true }); }, reduce ? 0 : 450);
  }

  /* --- live artwork preview ------------------------------------------------ */

  function syncPreview() {
    document.querySelectorAll('[data-live-preview]').forEach(function (card) {
      var title = ($('artworkTitleInput') || {}).value || '';
      var artist = ($('artworkArtistInput') || {}).value || '';
      var uri = (($('artworkImageInput') || {}).value || '').trim();
      card.querySelector('[data-preview-title]').textContent = title.trim() || 'Untitled artwork';
      card.querySelector('[data-preview-artist]').textContent = artist.trim() || 'Artist name';
      var img = card.querySelector('img');
      var src = global.ArtworkDrafts ? ArtworkDrafts.localUrl(uri) : uri;
      src = (src || '').replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
        'https://raw.githubusercontent.com/$1/$2/$3/$4');
      var usable = /^https:\/\//i.test(src) || /^images\//.test(src);
      card.classList.toggle('has-image', usable);
      if (usable && img.getAttribute('src') !== src) img.src = src;
      if (!usable) img.removeAttribute('src');
      card.classList.toggle('is-empty', !title.trim() && !usable);
    });
  }

  function bindPreview() {
    ['artworkTitleInput', 'artworkArtistInput', 'artworkImageInput'].forEach(function (id) {
      var input = $(id);
      if (input) input.addEventListener('input', syncPreview);
    });
    document.querySelectorAll('[data-live-preview] img').forEach(function (img) {
      img.addEventListener('error', function () { img.closest('[data-live-preview]').classList.remove('has-image'); });
      img.addEventListener('load', function () { img.closest('[data-live-preview]').classList.add('has-image'); });
    });
    syncPreview();
  }

  /* --- boot ---------------------------------------------------------------- */

  function init() {
    applyTheme(currentTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', toggleTheme);
    });
    if (global.matchMedia) {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        var saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (error) { /* ignore */ }
        if (!saved) { delete document.documentElement.dataset.theme; applyTheme(currentTheme()); }
      });
    }
    document.querySelectorAll('.rs-wallet-card').forEach(bindSheen);
    document.querySelectorAll('[data-filter-target]').forEach(bindFilter);
    document.addEventListener('click', function (event) {
      var receive = event.target.closest('[data-receive-from]');
      if (receive) { openReceive(receive.dataset.receiveFrom); return; }
      var scroll = event.target.closest('[data-scroll-to]');
      if (scroll) { scrollToTarget(scroll.dataset.scrollTo); return; }
      var forward = event.target.closest('[data-click]');
      if (forward && $(forward.dataset.click)) $(forward.dataset.click).click();
    });
    var topbar = document.querySelector('.rs-topbar');
    if (topbar) {
      var onScroll = function () { topbar.classList.toggle('is-scrolled', global.scrollY > 4); };
      global.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    bindPreview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.WalletUI = { syncPreview: syncPreview, scrollTo: scrollToTarget, applyFilter: applyFilter };
})(window);
