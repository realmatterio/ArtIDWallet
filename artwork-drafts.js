/* ==========================================================================
   artwork-drafts.js

   Artist Alice's studio set: ten original works in images/art/alice/ that
   are ready to register. Picking one fills the "Register a new artwork" form;
   the human wallet can also register the whole set in one go.

   On-chain records point at the public copy on GitHub. When the page is
   served from this repository the bundled file is shown instead: it loads
   faster, works before the branch is merged, and is same-origin, so the
   payment-code canvas stays readable.
   ========================================================================== */

(function (global) {
  'use strict';

  var LOCAL_DIR = 'images/art/alice/';
  var REMOTE_DIR = 'https://raw.githubusercontent.com/shaheerfarid/ArtIDWallet/main/images/art/alice/';
  var ARTIST = 'Artist Alice';

  var DRAFTS = [
    { slug: 'pearl-river-dusk', title: 'Pearl River Dusk', year: 2026 },
    { slug: 'harbour-lights',   title: 'Harbour Lights',   year: 2026 },
    { slug: 'bauhaus-tram',     title: 'Bauhaus Tram',     year: 2026 },
    { slug: 'jade-current',     title: 'Jade Current',     year: 2026 },
    { slug: 'lantern-grid',     title: 'Lantern Grid',     year: 2026 },
    { slug: 'lantau-mist',      title: 'Lantau Mist',      year: 2026 },
    { slug: 'neon-kowloon',     title: 'Neon Kowloon',     year: 2026 },
    { slug: 'tidal-rings',      title: 'Tidal Rings',      year: 2026 },
    { slug: 'plum-blossom',     title: 'Plum Blossom',     year: 2026 },
    { slug: 'signal-eight',     title: 'Signal No. 8',     year: 2026 }
  ].map(function (d) {
    return Object.assign(d, {
      artist: ARTIST,
      fullTitle: d.title + ', ' + d.year,
      src: LOCAL_DIR + d.slug + '.jpg',
      imageURI: REMOTE_DIR + d.slug + '.jpg'
    });
  });

  /** The bundled copy of one of our own images, or the URI unchanged. */
  function localUrl(uri) {
    if (typeof uri === 'string' && uri.indexOf(REMOTE_DIR) === 0 && location.protocol !== 'file:') {
      return LOCAL_DIR + uri.slice(REMOTE_DIR.length);
    }
    return uri;
  }

  var hashes = {};

  /* keccak256 of the image bytes, so the record pins the exact file. */
  function contentHash(draft) {
    if (!hashes[draft.slug]) {
      hashes[draft.slug] = fetch(draft.src)
        .then(function (r) { if (!r.ok) throw new Error('Could not read ' + draft.src); return r.arrayBuffer(); })
        .then(function (buf) { return ethers.keccak256(new Uint8Array(buf)); })
        .catch(function (error) { delete hashes[draft.slug]; throw error; });
    }
    return hashes[draft.slug];
  }

  /** Registry metadata for a draft; the artwork ID is derived from the title. */
  function metadata(draft) {
    // the hash is optional on chain, so an unreadable file leaves it blank
    return contentHash(draft).catch(function () { return ''; }).then(function (hash) {
      return {
        title: draft.fullTitle,
        artist: draft.artist,
        artworkId: 'did:art:artwork:' + ethers.keccak256(ethers.toUtf8Bytes(draft.fullTitle)),
        imageURI: draft.imageURI,
        contentHash: hash
      };
    });
  }

  function isRegistered(draft, artworks) {
    return (artworks || []).some(function (art) { return art.imageURI === draft.imageURI; });
  }

  /* Renders the picker into `container`.
     options.onPick(draft, metadata)  fill the form
     options.artworks()               current registry records, for "In registry" badges
     options.onRegisterAll(drafts)    optional; shows a "Register all" button */
  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    var picked = null;

    function render() {
      var artworks = options.artworks ? options.artworks() : [];
      var pending = DRAFTS.filter(function (d) { return !isRegistered(d, artworks); });
      container.innerHTML =
        '<div class="rs-drafts-head">' +
          '<div><strong>Studio drafts</strong><span>' +
            (pending.length ? pending.length + ' of ' + DRAFTS.length + ' ready to register' : 'All ' + DRAFTS.length + ' are in the registry') +
          '</span></div>' +
          (options.onRegisterAll && pending.length
            ? '<button class="rs-btn rs-btn-sm" type="button" data-drafts-all>Register all ' + pending.length + '</button>' : '') +
        '</div>' +
        '<div class="rs-drafts-rail" role="list">' +
          DRAFTS.map(function (d) {
            var done = isRegistered(d, artworks);
            return '<button type="button" role="listitem" class="rs-draft' + (done ? ' is-done' : '') +
              (picked === d.slug ? ' is-picked' : '') + '" data-draft="' + d.slug + '"' + (done ? ' disabled' : '') +
              ' aria-label="' + d.title + (done ? ', already in the registry' : ', fill the form') + '">' +
              '<img src="' + d.src + '" alt="" loading="lazy">' +
              '<span>' + d.title + '</span>' +
              (done ? '<em>In registry</em>' : '') +
            '</button>';
          }).join('') +
        '</div>';
      container.querySelectorAll('[data-draft]').forEach(function (button) {
        button.addEventListener('click', function () {
          var draft = DRAFTS.find(function (d) { return d.slug === button.dataset.draft; });
          picked = draft.slug;
          render();
          metadata(draft).then(function (meta) { if (options.onPick) options.onPick(draft, meta); });
        });
      });
      var all = container.querySelector('[data-drafts-all]');
      if (all) all.addEventListener('click', function () { options.onRegisterAll(pending, all); });
    }

    render();
    return { refresh: render, clearPick: function () { picked = null; render(); } };
  }

  global.ArtworkDrafts = {
    list: DRAFTS,
    localUrl: localUrl,
    metadata: metadata,
    isRegistered: isRegistered,
    mount: mount
  };
})(window);
