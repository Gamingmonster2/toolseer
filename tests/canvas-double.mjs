/**
 * ToolSeer V3 — a recording canvas double.
 *
 * The engine's rendering seam is `{ create(w, h), toBytes(canvas, format, quality) }`.
 * This double satisfies it well enough for **pdf.js to paint into it for real**
 * (its `Page.render()` runs the full operator list; only the pixels are stubbed),
 * and it records every decision the engine makes so tests can assert on them:
 * canvas sizes, encode format/quality, the white pre-fill, and whether pdf.js
 * actually issued drawing commands.
 *
 * There is no browser here, so this is the closest a Node test can get to
 * "render a page": page geometry, dpi maths, page selection and the encode call
 * are all exercised; the bitmap itself is synthetic.
 */

import { makeGrayscaleJpeg, makePng } from './fixtures.mjs';

/**
 * @param {{ payload?: (canvas: any, format: string, quality?: number) => Uint8Array,
 *           withDataUrl?: boolean }} [options]
 */
export function createCanvasDouble(options = {}) {
  const calls = {
    created: [],
    encodings: [],
    fills: [],
    texts: [],
    images: [],
    paths: 0,
    dataUrls: [],
    released: 0,
  };

  const payload = options.payload || ((canvas, format) => (
    format === 'jpeg' ? makeGrayscaleJpeg(16, 8) : makePng(8, 8, { alpha: false })
  ));

  const makeContext = (canvas) => {
    const gradient = { addColorStop() {} };
    const base = {
      canvas,
      save() {},
      restore() {},
      transform() {},
      setTransform() {},
      resetTransform() {},
      translate() {},
      rotate() {},
      scale() {},
      beginPath() { calls.paths += 1; },
      closePath() {},
      moveTo() {},
      lineTo() {},
      bezierCurveTo() {},
      quadraticCurveTo() {},
      arc() {},
      arcTo() {},
      ellipse() {},
      rect() {},
      fill() {},
      stroke() {},
      clip() {},
      fillRect(x, y, width, height) {
        calls.fills.push({ x, y, width, height, style: this.fillStyle });
      },
      strokeRect() {},
      clearRect() {},
      fillText(text, x, y) {
        calls.texts.push({ text, x, y, font: this.font });
      },
      strokeText() {},
      measureText(text) {
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font || '')?.[1]) || 10;
        return {
          width: (text ? String(text).length : 0) * size * 0.5,
          actualBoundingBoxAscent: size * 0.8,
          actualBoundingBoxDescent: size * 0.2,
        };
      },
      drawImage(image, x, y, width, height) {
        calls.images.push({ x, y, width, height });
      },
      setLineDash() {},
      getLineDash() {
        return [];
      },
      createLinearGradient() { return gradient; },
      createRadialGradient() { return gradient; },
      createConicGradient() { return gradient; },
      createPattern() { return {}; },
      createImageData(width, height) {
        const w = (width && width.width) || width || 1;
        const h = (width && width.height) || height || 1;
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      },
      getImageData(x, y, width, height) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) };
      },
      putImageData() {},
      isPointInPath() { return false; },
      isPointInStroke() { return false; },
      getTransform() {
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      },
      getContextAttributes() {
        return { alpha: true, willReadFrequently: false };
      },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      lineDashOffset: 0,
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      direction: 'ltr',
      shadowBlur: 0,
      shadowColor: 'rgba(0,0,0,0)',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      filter: 'none',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
    };
    return new Proxy(base, {
      get(target, property) {
        if (property === 'canvas') return canvas;
        return target[property];
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
      has() {
        return true;
      },
    });
  };

  const factory = {
    create(width, height) {
      const canvas = {
        width,
        height,
        style: {},
        getContext() { return context; },
        toDataURL(type = 'image/png') {
          calls.dataUrls.push({ type, width, height });
          return `data:${type};base64,VE9PTFNFRVItVEhVTUJOQUlM`;
        },
      };
      const context = makeContext(canvas);
      calls.created.push({ width, height });
      return canvas;
    },

    async toBytes(canvas, format, quality) {
      calls.encodings.push({ format, quality, width: canvas.width, height: canvas.height });
      return payload(canvas, format, quality);
    },

    toDataURL(canvas, format) {
      return canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    },

    release() {
      calls.released += 1;
    },
  };

  return { factory, calls };
}

/** Convenience: a factory whose encoded images are always `size` bytes of JPEG. */
export function jpegPayloadFactory(width, height) {
  return createCanvasDouble({ payload: () => makeGrayscaleJpeg(width, height) });
}
