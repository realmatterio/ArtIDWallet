/* ==========================================================================
   addrQrOverlay.js

   Address QR drawn over an image, adapted from Prof. Mow's addrQR project:
   https://github.com/hippomatter/addrQR  (src/main.js, drawOverlay)

   The approach is his: render a standard high-error-correction QR for an
   `ethereum:<address>` URI, lay it over a centre-cropped image, and paint only
   the dark modules. The light modules and the quiet zone stay transparent, so
   the picture shows through the code.

   Adapted rather than copied because this project has no build step: the
   original is an ES module in a Vite app, this is a plain script exposing a
   global, matching how the rest of the wallet loads its code. The file-picker,
   preview and download UI from the original is left out - the wallet has its
   own UI around this.

   Requires the `qrcode` library to already be on the page (QRCode.create).
   ========================================================================== */

(function (global) {
  'use strict';

  // 423 is not arbitrary. A version-6 QR is 41 modules; plus a 3-module quiet
  // zone each side that is 47, and 423 / 47 is exactly 9 pixels per module.
  // Change any one of these and the assertion below will catch it.
  var OUTPUT_SIZE = 423;
  var QR_VERSION = 6;
  var QUIET_ZONE_MODULES = 3;
  var EXPECTED_TOTAL_MODULES = 47;

  /**
   * Accepts an address with or without the `ethereum:` prefix.
   * Returns the bare 0x-address, or null if it is not a valid one.
   */
  function normalizeAddress(value) {
    if (typeof value !== 'string') return null;
    var address = value.trim().replace(/^ethereum:/i, '');
    return /^0x[a-fA-F0-9]{40}$/.test(address) ? address : null;
  }

  /**
   * Draw the overlay onto `canvas`.
   *
   * @param {HTMLCanvasElement} canvas  resized to 423x423
   * @param {Object}  opts
   * @param {string}  opts.address      0x address, `ethereum:` prefix optional
   * @param {CanvasImageSource} [opts.background]  image/canvas to sit behind the
   *                            code. Omitted renders on white - still a valid QR.
   * @param {number}  [opts.lightening=70]  0-100. Lifts dark tones so the code
   *                            stays readable over the picture.
   *
   * Readability depends heavily on the background. Round-trip tested here by
   * decoding the result with jsQR:
   *   - smooth gradients and flat tones decode at any lightening value
   *   - a detailed logo needs roughly 70 or above
   *   - busy, high-contrast detail (fine stripes) can fail at every value
   * Hence the default of 70 rather than something lower. Scan-test any new
   * background before shipping it, as the original project also advises.
   * @returns {HTMLCanvasElement}
   */
  function render(canvas, opts) {
    opts = opts || {};
    var address = normalizeAddress(opts.address);
    if (!address) {
      throw new Error('A valid 0x-prefixed 40-character address is required.');
    }
    if (typeof QRCode === 'undefined' || typeof QRCode.create !== 'function') {
      throw new Error('The qrcode library is not loaded on this page.');
    }

    var qr = QRCode.create('ethereum:' + address, {
      errorCorrectionLevel: 'H',
      version: QR_VERSION
    });

    var moduleCount = qr.modules.size;
    var totalModules = moduleCount + QUIET_ZONE_MODULES * 2;
    if (totalModules !== EXPECTED_TOTAL_MODULES || OUTPUT_SIZE % totalModules !== 0) {
      throw new Error('Could not create the expected 423-pixel QR layout.');
    }
    var moduleSize = OUTPUT_SIZE / totalModules;

    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable in this browser.');

    var lightening = Math.max(0, Math.min(100, Number(
      opts.lightening === undefined ? 70 : opts.lightening
    ))) / 100;

    // 1. white base, so a missing or transparent image still yields a scannable code
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    // 2. the picture, centre-cropped square and brightened
    var bg = opts.background;
    if (bg) {
      var w = bg.naturalWidth || bg.width;
      var h = bg.naturalHeight || bg.height;
      if (w && h) {
        var cropSize = Math.min(w, h);
        ctx.save();
        ctx.filter = 'brightness(' + (100 + lightening * 50) + '%)';
        ctx.drawImage(
          bg,
          (w - cropSize) / 2, (h - cropSize) / 2, cropSize, cropSize,
          0, 0, OUTPUT_SIZE, OUTPUT_SIZE
        );
        ctx.restore();
      }
    }

    // 3. white wash, lifting dark tones away from the black modules
    ctx.fillStyle = 'rgba(255, 255, 255, ' + (lightening * 0.45) + ')';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    // 4. dark modules only - light modules and quiet zone keep showing the picture
    ctx.fillStyle = '#000';
    var offset = QUIET_ZONE_MODULES * moduleSize;
    for (var row = 0; row < moduleCount; row += 1) {
      for (var col = 0; col < moduleCount; col += 1) {
        if (qr.modules.get(row, col)) {
          ctx.fillRect(
            offset + col * moduleSize,
            offset + row * moduleSize,
            moduleSize,
            moduleSize
          );
        }
      }
    }

    return canvas;
  }

  /** Load an image URL for use as `background`. Resolves null if it fails. */
  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };   // fall back to plain white
      img.src = src;
    });
  }

  global.AddrQR = {
    OUTPUT_SIZE: OUTPUT_SIZE,
    normalizeAddress: normalizeAddress,
    render: render,
    loadImage: loadImage
  };
})(window);
