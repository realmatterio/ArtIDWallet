/* ==========================================================================
   artworks.js

   Demo artworks: public-domain paintings served from images/art/.
   See images/art/SOURCES.md for provenance and why they are free to use.

   Images are preloaded because the QR overlay draws synchronously - it needs a
   decoded HTMLImageElement in hand, not a pending request.
   ========================================================================== */

(function (global) {
  'use strict';

  var ART = {
    scream:     'images/art/scream.jpg',
    greatWave:  'images/art/great-wave.jpg',
    starryNight:'images/art/starry-night.jpg',
    sunflowers: 'images/art/sunflowers.jpg'
  };

  // Anything present in images/art/local/ wins, for demos run with images the
  // presenter holds rights to. That folder is gitignored, so overrides never
  // enter version control - see images/art/local/README.md.
  var LOCAL_DIR = 'images/art/local/';

  var loaded = {};
  var resolvedUrl = {};
  var meta = {};        // optional title/artist overrides from the local folder

  function url(name) {
    return resolvedUrl[name] || ART[name] || null;
  }

  /** CSS background shorthand, for thumbnails. */
  function background(name) {
    var u = url(name);
    return u ? 'url(' + u + ') center/cover' : 'none';
  }

  /** Decoded image, or null if it has not loaded (yet, or at all). */
  function image(name) {
    return loaded[name] || null;
  }

  /** Resolves once every image has either loaded or failed. Never rejects:
      a missing picture should degrade to a plain white code, not a dead page. */
  function loadOne(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  /** Title/artist for a slot, if the local folder supplied one. */
  function label(name) {
    return meta[name] || null;
  }

  /* An optional local/manifest.json may rename the slots, so a demo running on
     overridden images is not captioned with the bundled paintings' titles.
     Absent or malformed, the bundled captions stand. */
  function loadManifest() {
    return fetch(LOCAL_DIR + 'manifest.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j === 'object') meta = j; })
      .catch(function () { /* no manifest - fine */ });
  }

  function preload() {
    return loadManifest().then(function () {
    return Promise.all(Object.keys(ART).map(function (name) {
      var file = ART[name].split('/').pop();
      // try the local override first, fall back to the bundled painting
      return loadOne(LOCAL_DIR + file).then(function (img) {
        if (img) {
          loaded[name] = img;
          resolvedUrl[name] = LOCAL_DIR + file;
          return name;
        }
        return loadOne(ART[name]).then(function (fallback) {
          if (fallback) loaded[name] = fallback;
          return fallback ? name : null;
        });
      });
    }));
    });
  }

  global.Artworks = {
    url: url,
    background: background,
    image: image,
    label: label,
    preload: preload,
    names: Object.keys(ART)
  };
})(window);
