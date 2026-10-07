// Mascot SVG validator: theme contract, path grammar, bounds, skeleton identity,
// hand-anchoring, silhouette legibility (gecko profile) and stroke-crossing analysis.
//
// Run from the repo root, default set (gecko):
//   node tools/validate-mascots.mjs
// The alternate skin is the same gate on another directory (profile auto-detected):
//   node tools/validate-mascots.mjs apps/web/assets/img/mascot/alternates/rabbit
//   ... --profile rabbit|gecko   forces the profile instead of guessing from the path
import fs from 'node:fs';

const DEFAULT_DIR = 'C:/toolseer/apps/web/assets/img/mascot';
const argOf = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const DIR = (process.argv.slice(2).find(a => !a.startsWith('--') && a !== argOf('--profile')) || DEFAULT_DIR)
  .replace(/\\/g, '/').replace(/\/+$/, '');
const PROFILE = argOf('--profile', /rabbit/i.test(DIR) ? 'rabbit' : 'gecko');
const SLUGS = ['base', 'image-to-pdf', 'merge-pdf', 'compress-pdf', 'split-pdf', 'protect-pdf',
  'unlock-pdf', 'pdf-to-images', 'organize-pdf', 'extract-text-pdf', 'desktop'];
const ACCENT = 'var(--ts-primary,#0040ff)';
const PAINTS = new Set(['none', 'currentColor', ACCENT]);
const ARM_ORIGIN = [56.8, 70.3];
const ARM_ORIGIN_L = [19.2, 70.3];
const EYE_BAND = 55;      // the recognition package must live in the top 55 units of the stage
const MIN_ACCENT = 2.5;   // smallest accent feature, in stage units
const JOINT_TOL = 1.0;   // a crossing this close to a free line ending is a drawn joint, not a collision
const MIN_CROSS_ANGLE = 8; // below this the two lines run together (tangential join), which cannot look broken
const fails = [];
const notes = [];
const fail = (s) => fails.push(s);

function parse(src) {
  const root = { tag: '#root', attrs: {}, kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[A-Za-z][\w:.-]*\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) {
      if (m[0].slice(4, -3).includes('--')) fail('illegal double hyphen inside a comment');
      continue;
    }
    if (m[1]) { const t = stack.pop(); if (!t || t.tag !== m[1]) throw new Error('unbalanced ' + m[1]); continue; }
    if (m[2]) {
      const n = { tag: m[2], attrs: {}, kids: [] };
      const ar = /([A-Za-z][\w:.-]*)\s*=\s*"([^"]*)"/g; let a;
      while ((a = ar.exec(m[3] || ''))) n.attrs[a[1]] = a[2];
      const p = stack[stack.length - 1]; p.kids.push(n); n.parent = p;
      if (!m[4]) stack.push(n);
    }
  }
  if (stack.length !== 1) throw new Error('unclosed elements');
  return root;
}
function collect(node, inh, out) {
  const p = {
    fill: node.attrs.fill !== undefined ? node.attrs.fill : inh.fill,
    stroke: node.attrs.stroke !== undefined ? node.attrs.stroke : inh.stroke,
    strokeWidth: node.attrs['stroke-width'] !== undefined ? +node.attrs['stroke-width'] : inh.strokeWidth
  };
  if (['path', 'rect', 'circle', 'ellipse'].includes(node.tag)) out.push({ node, p });
  for (const k of node.kids) collect(k, p, out);
}
const desc = (el) => el.node.tag + '[' + Object.entries(el.node.attrs).filter(([k]) => ['d', 'x', 'y', 'cx', 'cy', 'r', 'width', 'height'].includes(k)).map(([k, v]) => k + '=' + v).join(' ') + ']';
const NUM = '-?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?';
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
function pathSegs(d, tag) {
  const re = new RegExp('([A-Za-z])|(' + NUM + ')', 'g'); const toks = []; let m;
  while ((m = re.exec(d))) toks.push(m[1] ? { c: m[1] } : { n: parseFloat(m[2]) });
  const segs = []; let i = 0, cur = null, start = null, cmd = null;
  while (i < toks.length) {
    if (toks[i].c) {
      cmd = toks[i].c; i++;
      if (!(cmd in ARITY)) { fail(tag + ': bad path command ' + cmd); return segs; }
      if (cmd !== cmd.toUpperCase()) { fail(tag + ': relative path command ' + cmd); return segs; }
    }
    if (ARITY[cmd] === 0) { if (cmd === 'Z' && start) { segs.push(['L', cur[0], cur[1], start[0], start[1]]); cur = start.slice(); } continue; }
    const need = ARITY[cmd]; const args = []; let k = 0;
    while (k < need) { if (i >= toks.length || toks[i].c) { fail(tag + ': short argument list for ' + cmd); return segs; } args.push(toks[i].n); i++; k++; }
    if (cmd === 'M') { cur = [args[0], args[1]]; start = cur.slice(); cmd = 'L'; continue; }
    if (cmd === 'L') { segs.push(['L', cur[0], cur[1], args[0], args[1]]); cur = [args[0], args[1]]; }
    else if (cmd === 'H') { segs.push(['L', cur[0], cur[1], args[0], cur[1]]); cur = [args[0], cur[1]]; }
    else if (cmd === 'V') { segs.push(['L', cur[0], cur[1], cur[0], args[0]]); cur = [cur[0], args[0]]; }
    else if (cmd === 'C') { segs.push(['C', cur[0], cur[1], args[0], args[1], args[2], args[3], args[4], args[5]]); cur = [args[4], args[5]]; }
    else if (cmd === 'Q') { segs.push(['Q', cur[0], cur[1], args[0], args[1], args[2], args[3]]); cur = [args[2], args[3]]; }
    else if (cmd === 'A') { segs.push(['A', cur[0], cur[1], args[0], args[1], args[2], args[3], args[4], args[5], args[6]]); cur = [args[5], args[6]]; }
  }
  return segs;
}
function bez(p, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    if (p[0] === 'C') out.push([u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7],
      u * u * u * p[2] + 3 * u * u * t * p[4] + 3 * u * t * t * p[6] + t * t * t * p[8]]);
    else out.push([u * u * p[1] + 2 * u * t * p[3] + t * t * p[5], u * u * p[2] + 2 * u * t * p[4] + t * t * p[6]]);
  }
  return out;
}
function arcPts(x1, y1, rx, ry, phiD, laf, sf, x2, y2, n) {
  if (x1 === x2 && y1 === y2) return [];
  const phi = phiD * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = cp * dx + sp * dy, yp = -sp * dx + cp * dy;
  let r2 = rx * rx, r3 = ry * ry, lam = xp * xp / r2 + yp * yp / r3;
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; r2 = rx * rx; r3 = ry * ry; }
  const num = r2 * r3 - r2 * yp * yp - r3 * xp * xp, den = r2 * yp * yp + r3 * xp * xp;
  let co = Math.sqrt(Math.max(0, num / den)); if (laf === sf) co = -co;
  const cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    return Math.sign(ux * vy - uy * vx) * Math.acos(Math.min(1, Math.max(-1, d)));
  };
  const th1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dth = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sf && dth > 0) dth -= 2 * Math.PI;
  if (sf && dth < 0) dth += 2 * Math.PI;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = th1 + dth * i / n, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
  return out;
}
function roundedRectPts(x, y, w, h, rx, ry) {
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } };
  pts.push([x + rx, y], [x + w - rx, y]); arc(x + w - rx, y + ry, -Math.PI / 2, 0);
  pts.push([x + w, y + h - ry]); arc(x + w - rx, y + h - ry, 0, Math.PI / 2);
  pts.push([x + rx, y + h]); arc(x + rx, y + h - ry, Math.PI / 2, Math.PI);
  pts.push([x, y + ry]); arc(x + rx, y + ry, Math.PI, 1.5 * Math.PI);
  pts.push([x + rx, y]);
  return pts;
}
function outline(el, tag) {
  const a = el.node.attrs, pts = [];
  let tf = null;
  if (a.transform) {
    const mm = /rotate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(a.transform);
    if (mm) tf = { d: +mm[1], cx: +mm[2], cy: +mm[3] };
    else fail(tag + ': unsupported transform ' + a.transform);
  }
  const ap = (x, y) => {
    if (!tf) return [x, y];
    const r = tf.d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), dx = x - tf.cx, dy = y - tf.cy;
    return [tf.cx + dx * c - dy * s, tf.cy + dx * s + dy * c];
  };
  if (el.node.tag === 'circle') {
    const cx = +a.cx, cy = +a.cy, r = +a.r;
    for (let i = 0; i <= 64; i++) { const t = i / 64 * 2 * Math.PI; pts.push(ap(cx + r * Math.cos(t), cy + r * Math.sin(t))); }
  } else if (el.node.tag === 'ellipse') {
    const cx = +a.cx, cy = +a.cy, rx = +a.rx, ry = +a.ry;
    for (let i = 0; i <= 64; i++) { const t = i / 64 * 2 * Math.PI; pts.push(ap(cx + rx * Math.cos(t), cy + ry * Math.sin(t))); }
  } else if (el.node.tag === 'rect') {
    const x = +a.x, y = +a.y, w = +a.width, h = +a.height, rx = a.rx ? +a.rx : 0, ry = a.ry ? +a.ry : rx;
    for (const p of roundedRectPts(x, y, w, h, rx, ry)) pts.push(ap(p[0], p[1]));
  } else {
    for (const s of pathSegs(a.d, tag)) {
      const sp = s[0] === 'L' ? [s.slice(1, 3), s.slice(3, 5)]
        : s[0] === 'Q' || s[0] === 'C' ? bez(s, 24)
        : arcPts(s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], 24);
      for (const p of sp) pts.push(ap(p[0], p[1]));
    }
  }
  return pts;
}
/* --- helpers added for the anchoring + silhouette checks ------------------- */
const bbox = (pts) => pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
const bboxArea = (pts) => { const b = bbox(pts); return (b[2] - b[0]) * (b[3] - b[1]); };
function ptSegDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}
function distToPolyline(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length - 1; i++) d = Math.min(d, ptSegDist(p, poly[i], poly[i + 1]));
  return poly.length === 1 ? Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) : d;
}
/* first and last on-curve point of a path, plus whether it is explicitly closed */
function pathEnds(el, tag) {
  const d = el.node.attrs.d || '';
  if (!/^\s*M/.test(d)) return null;
  const segs = pathSegs(d, tag);
  if (!segs.length) return null;
  const f = segs[0], l = segs[segs.length - 1];
  return { start: [f[1], f[2]], end: [l[l.length - 2], l[l.length - 1]], closed: /Z\s*$/i.test(d.trim()) };
}
/* total heading change along an outline: proves a stroke actually curls */
function turningDeg(pts) {
  let sum = 0, prev = null;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    if (Math.hypot(dx, dy) < 1e-6) continue;
    const a = Math.atan2(dy, dx);
    if (prev !== null) { let d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; sum += Math.abs(d); }
    prev = a;
  }
  return sum * 180 / Math.PI;
}
/* the smallest legible dimension of a feature: stroke weight for a line, bbox for a solid */
function featureSize(el, tag) {
  const stroked = el.p.stroke === ACCENT, filled = el.p.fill === ACCENT;
  const bbMin = Math.min(...[bbox(outline(el, tag))].map(b => Math.min(b[2] - b[0], b[3] - b[1])));
  if (filled && stroked) return Math.min(bbMin, el.p.strokeWidth);
  return filled ? bbMin : el.p.strokeWidth;
}
function segInter(p1, p2, p3, p4) {
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = cr(p3, p4, p1), d2 = cr(p3, p4, p2), d3 = cr(p1, p2, p3), d4 = cr(p1, p2, p4), e = 1e-9;
  if (!(((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e)))) return null;
  const den = d3 - d4;                       // = -(e x f); zero means parallel
  if (Math.abs(den) < 1e-12) return null;
  const t = -d1 / den;                       // parameter along p1 -> p2
  const u = d3 / den;                        // parameter along p3 -> p4
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  const ex = p2[0] - p1[0], ey = p2[1] - p1[1], fx = p4[0] - p3[0], fy = p4[1] - p3[1];
  const ang = Math.asin(Math.min(1, Math.abs(ex * fy - ey * fx) / (Math.hypot(ex, ey) * Math.hypot(fx, fy)))) * 180 / Math.PI;
  return { pt: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])], t, u, ang };
}
// The checker must be provably right: known-answer tests before any verdict is trusted.
{
  const a = [[0, 0], [10, 0]], b = [[5, -5], [5, 5]], r = segInter(a[0], a[1], b[0], b[1]);
  if (!r || Math.abs(r.pt[0] - 5) > 1e-9 || Math.abs(r.pt[1]) > 1e-9 || Math.abs(r.t - 0.5) > 1e-9 || Math.abs(r.u - 0.5) > 1e-9 || Math.abs(r.ang - 90) > 1e-6) fail('SELF-TEST: plain crossing not detected correctly');
  const r2 = segInter([0, 0], [4, 0], [2, -2], [2, 2]);
  if (!r2 || Math.abs(r2.pt[0] - 2) > 1e-9 || Math.abs(r2.t - 0.5) > 1e-9) fail('SELF-TEST: crossing parameter wrong');
  if (segInter([0, 0], [10, 0], [0, 5], [10, 5])) fail('SELF-TEST: parallel segments reported as crossing');
  if (segInter([0, 0], [10, 0], [5, 5], [5, 9])) fail('SELF-TEST: disjoint segments reported as crossing');
  if (segInter([0, 0], [10, 0], [5, 0], [5, 5])) fail('SELF-TEST: T-junction reported as a crossing');
  const r3 = segInter([0, 0], [10, 0], [5, -0.4], [11, 0.4]);
  if (!r3 || r3.ang > 8 || Math.abs(r3.ang - 7.59) > 0.05) fail('SELF-TEST: shallow crossing angle mis-measured (got ' + (r3 && r3.ang) + ')');
  const r4 = segInter([0, 0], [10, 0], [5, -5], [5, 5]);
  if (Math.abs(r4.t - 0.5) > 1e-9 || Math.abs(r4.u - 0.5) > 1e-9) fail('SELF-TEST: parameters not centred');
}

const report = [], skel = {}, silh = [];
let declared = 0;
let joints = 0, defects = 0, worstJoint = 0;
for (const slug of SLUGS) {
  const file = DIR + '/' + slug + '.svg';
  if (!fs.existsSync(file)) { fail(slug + ': MISSING FILE'); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const size = Buffer.byteLength(src);
  if (size > 8192) fail(slug + ': size ' + size + ' > 8192');
  if (src.split(ACCENT).join('').includes('#')) fail(slug + ': raw hex outside the accent token');
  if (/\bstyle\s*=/.test(src)) fail(slug + ': style attribute present');
  if (/url\(/.test(src)) fail(slug + ': url() reference present');
  if (/\b(?:xlink:)?href\s*=/.test(src)) fail(slug + ': href reference present');
  if (!src.includes('xmlns="http://www.w3.org/2000/svg"')) fail(slug + ': missing SVG namespace');
  if (!src.includes('viewBox="0 0 120 120"')) fail(slug + ': wrong viewBox');
  if (!src.includes('aria-hidden="true"')) fail(slug + ': not marked decorative');
  if (/<(image|filter|linearGradient|radialGradient|script|text|use|foreignObject)\b/.test(src)) fail(slug + ': foreign or raster element present');

  const tree = parse(src);
  const els = []; collect(tree, { fill: 'black', stroke: 'none', strokeWidth: 1 }, els);
  for (const el of els) {
    if (!PAINTS.has(el.p.fill)) fail(slug + ': illegal fill ' + el.p.fill);
    if (!PAINTS.has(el.p.stroke)) fail(slug + ': illegal stroke ' + el.p.stroke);
    for (const p of outline(el, slug)) {
      if (!isFinite(p[0]) || !isFinite(p[1])) fail(slug + ': non-finite coordinate');
      else if (p[0] < 0 || p[0] > 120 || p[1] < 0 || p[1] > 120) fail(slug + ': coordinate outside canvas ' + p.map(v => +v.toFixed(1)));
    }
  }

  const a1 = src.indexOf('<!-- A: skeleton'), c1 = src.indexOf('<!-- C: pose');
  if (a1 < 0 || c1 < a1) fail(slug + ': group markers missing');
  else skel[slug] = src.slice(a1, c1);

  /* group split by document order: top[0] = A skeleton, top[1] + top[2] = B ink, rest = C pose */
  const svgEl = tree.kids.find(k => k.tag === 'svg');
  const top = svgEl ? svgEl.kids : [];
  const gA = [], gB = [], gC = [];
  const inherited = { fill: 'black', stroke: 'none', strokeWidth: 1 };
  if (top.length >= 3) {
    collect(top[0], inherited, gA);
    collect(top[1], inherited, gB);
    collect(top[2], inherited, gB);
    for (const k of top.slice(3)) collect(k, inherited, gC);
  } else fail(slug + ': group structure not recognised (expected A, B, accent, pose)');

  let propBox = 'n/a';
  if (c1 > 0) {
    const pose = src.slice(c1);
    const poseTree = parse('<g>' + pose.replace('</svg>', '') + '</g>');
    const poseEls = []; collect(poseTree, { fill: 'black', stroke: 'none', strokeWidth: 1 }, poseEls);
    const arm = poseEls.find(e => e.p.stroke === 'currentColor' && /^M/.test(e.node.attrs.d || ''));
    if (!arm) fail(slug + ': pose arm not found');
    else {
      const segs = pathSegs(arm.node.attrs.d, slug);
      const last = segs[segs.length - 1], start = [segs[0][1], segs[0][2]], end = [last[last.length - 2], last[last.length - 1]];
      if (Math.hypot(start[0] - ARM_ORIGIN[0], start[1] - ARM_ORIGIN[1]) > 0.05) fail(slug + ': arm does not start at ARM_ORIGIN, got ' + start);
      const paws = poseEls.filter(e => e.node.tag === 'circle' && +e.node.attrs.r === 4.2).map(e => [+e.node.attrs.cx, +e.node.attrs.cy]);
      if (!paws.some(c => Math.hypot(c[0] - end[0], c[1] - end[1]) < 2.5)) fail(slug + ': arm end ' + end + ' not at a paw');
    }
    let propMinX = Infinity, propCount = 0, pb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const el of poseEls) {
      const pts = outline(el, slug);
      if (!pts.length) continue;
      if (el === arm || (el.node.tag === 'circle' && +el.node.attrs.r === 4.2)) continue;
      propCount++;
      for (const p of pts) { propMinX = Math.min(propMinX, p[0]); pb = [Math.min(pb[0], p[0]), Math.min(pb[1], p[1]), Math.max(pb[2], p[0]), Math.max(pb[3], p[1])]; }
    }
    if (slug !== 'base') {
      if (!propCount) fail(slug + ': pose group carries no prop');
      else {
        if (propMinX < 60) fail(slug + ': prop intrudes into the character zone (minX ' + propMinX.toFixed(2) + ')');
        const w = (pb[2] - pb[0]) * 64 / 120, h = (pb[3] - pb[1]) * 64 / 120;
        propBox = w.toFixed(0) + 'x' + h.toFixed(0) + 'px@64';
      }
    }
  }

  /* ---------- anchoring + silhouette checks (added v2; nothing above was relaxed) ---------- */
  const strokedAB = [...gA, ...gB].filter(e => e.p.stroke !== 'none');
  const polyAB = strokedAB.map(e => ({ el: e, pts: outline(e, slug) }));
  const openA = gA.filter(e => e.p.stroke !== 'none' && pathEnds(e, slug) && !pathEnds(e, slug).closed);

  // (1) the free arm hangs from the left shoulder anchor and ends at a solid paw
  const armL = openA.find(e => {
    const b = pathEnds(e, slug);
    return Math.hypot(b.start[0] - ARM_ORIGIN_L[0], b.start[1] - ARM_ORIGIN_L[1]) <= 0.05;
  });
  if (!armL) fail(slug + ': no skeleton arm starting at the left shoulder (' + ARM_ORIGIN_L + ')');
  else {
    const b = pathEnds(armL, slug);
    const paws = gB.filter(e => e.node.tag === 'circle' && e.p.fill === 'currentColor' && Math.abs(+e.node.attrs.r - 4.2) < 1e-9);
    if (!paws.length) fail(slug + ': group B carries no solid r=4.2 paw for the left arm');
    else if (!paws.some(p => Math.hypot(+p.node.attrs.cx - b.end[0], +p.node.attrs.cy - b.end[1]) < 2.5))
      fail(slug + ': left arm end [' + b.end.map(v => +v.toFixed(2)) + '] is not at a solid paw');
  }

  // (2) the pose arm really leaves the drawn body: (56.8,70.3) must lie on a skeleton outline
  for (const el of gC) {
    if (el.p.stroke === 'none') continue;
    const b = pathEnds(el, slug);
    if (!b || Math.hypot(b.start[0] - ARM_ORIGIN[0], b.start[1] - ARM_ORIGIN[1]) > 0.05) continue;
    let best = Infinity;
    for (const o of polyAB) best = Math.min(best, distToPolyline(ARM_ORIGIN, o.pts));
    if (best > 0.05) fail(slug + ': pose arm origin (56.8,70.3) floats off every skeleton outline (nearest ' + best.toFixed(3) + ' units)');
  }

  // (3) the smallest accent feature must survive the 46 px chip
  let accentMin = Infinity;
  for (const el of els) {
    if (el.p.fill !== ACCENT && el.p.stroke !== ACCENT) continue;
    const f = featureSize(el, slug);
    accentMin = Math.min(accentMin, f);
    if (!(f >= MIN_ACCENT)) fail(slug + ': accent feature ' + f.toFixed(2) + ' units < ' + MIN_ACCENT + ' (' + desc(el) + ')');
  }

  // (4) gecko profile: oversized skull + one big eye, all of it inside the top-55 identity band,
  //     a thick curved tail anchored to the body, and a crest that breaks the skull silhouette
  let headSize = 'n/a', idBand = 'n/a', eyeDia = 'n/a', tailBase = 'n/a';
  if (PROFILE === 'gecko') {
    const closedA = gA.filter(e => e.node.tag === 'path' && pathEnds(e, slug) && pathEnds(e, slug).closed);
    if (closedA.length !== 1) fail(slug + ': gecko skeleton must hold exactly one closed path (the skull), found ' + closedA.length);
    else {
      const hp = outline(closedA[0], slug), hb = bbox(hp);
      const hw = hb[2] - hb[0], hh = hb[3] - hb[1];
      headSize = hw.toFixed(1) + 'x' + hh.toFixed(1);
      if (hw < 34) fail(slug + ': gecko skull only ' + hw.toFixed(1) + ' units wide (>= 34: the head must be oversized)');
      if (hh < 26) fail(slug + ': gecko skull only ' + hh.toFixed(1) + ' units tall (>= 26: a flat lizard skull, not a ball)');
      if (hb[3] > EYE_BAND) fail(slug + ': gecko skull ink reaches y=' + hb[3].toFixed(1) + ', under the top-' + EYE_BAND + ' identity band');
      const eyes = gB.filter(e => e.node.tag === 'circle' && e.p.fill === 'currentColor' && +e.node.attrs.r >= 7 &&
        +e.node.attrs.cx > hb[0] && +e.node.attrs.cx < hb[2] && +e.node.attrs.cy > hb[1] && +e.node.attrs.cy < hb[3]);
      if (eyes.length !== 1) fail(slug + ': expected exactly one oversized solid eye (r >= 7) inside the skull, found ' + eyes.length);
      else eyeDia = (2 * +eyes[0].node.attrs.r).toFixed(1);
      // identity band = the skull plus every solid feature seated on it (eye, pupil, nostril, crest)
      let idMaxY = hb[3], idN = 1;
      for (const el of [...gB, ...gA]) {
        if (el === closedA[0]) continue;
        if (el.p.fill !== 'currentColor' && el.p.fill !== ACCENT) continue;
        const bb2 = bbox(outline(el, slug)), cx2 = (bb2[0] + bb2[2]) / 2, cy2 = (bb2[1] + bb2[3]) / 2;
        if (cx2 > hb[0] - 6 && cx2 < hb[2] + 6 && cy2 > hb[1] - 6 && cy2 < hb[3] + 6) { idMaxY = Math.max(idMaxY, bb2[3]); idN++; }
      }
      idBand = idMaxY.toFixed(1) + ' (' + idN + ' el)';
      if (idMaxY > EYE_BAND) fail(slug + ': identity ink reaches y=' + idMaxY.toFixed(1) + ' > ' + EYE_BAND + ' (the recognition package must stay in the top band)');
      // thick curved tail, both free ends anchored on the body outline
      const bodyEl = openA.slice().sort((x, y) => bboxArea(outline(y, slug)) - bboxArea(outline(x, slug)))[0];
      const bodyPoly = outline(bodyEl, slug);
      const tails = openA.filter(e => {
        if (e === bodyEl) return false;
        const b = pathEnds(e, slug);
        return distToPolyline(b.start, bodyPoly) <= 0.05 && distToPolyline(b.end, bodyPoly) <= 0.05;
      });
      if (tails.length !== 1) fail(slug + ': expected exactly one tail anchored on the body outline, found ' + tails.length);
      else {
        const tb = pathEnds(tails[0], slug), tpts = outline(tails[0], slug), tbb = bbox(tpts);
        const baseW = Math.hypot(tb.start[0] - tb.end[0], tb.start[1] - tb.end[1]);
        tailBase = baseW.toFixed(1) + ' unit base, ' + (tbb[2] - tbb[0]).toFixed(1) + 'x' + (tbb[3] - tbb[1]).toFixed(1) + ' box';
        if (baseW < 6) fail(slug + ': tail base only ' + baseW.toFixed(2) + ' units thick (< 6): it reads as a wire, not a tail');
        if (tbb[2] - tbb[0] < 12 || tbb[3] - tbb[1] < 15) fail(slug + ': tail silhouette only ' + (tbb[2] - tbb[0]).toFixed(1) + 'x' + (tbb[3] - tbb[1]).toFixed(1) + ' (>= 12x15 needed to read as a shape)');
        const turn = turningDeg(tpts);
        if (turn < 60) fail(slug + ': tail turns only ' + turn.toFixed(0) + ' deg (< 60): the brief asks for a curved tail');
      }
      // crest: solid teeth seated on the skull and breaking its outline
      const teeth = gB.filter(e => e.node.tag === 'path' && e.p.fill === 'currentColor' && pathEnds(e, slug) && pathEnds(e, slug).closed);
      if (teeth.length < 3) fail(slug + ': crest needs >= 3 solid teeth on the skull, found ' + teeth.length);
      for (const t of teeth) {
        const tb2 = pathEnds(t, slug), tbb2 = bbox(outline(t, slug));
        if (distToPolyline(tb2.start, hp) > 2.5 && distToPolyline(tb2.end, hp) > 2.5)
          fail(slug + ': a crest tooth is not seated on the skull outline');
        if (tbb2[1] >= hb[1]) fail(slug + ': a crest tooth does not break the skull silhouette (top ' + tbb2[1].toFixed(1) + ' vs skull ' + hb[1].toFixed(1) + ')');
      }
      // neck: the skull must be joined to the body by two anchored lines (back + throat)
      const necks = openA.filter(e => {
        const b = pathEnds(e, slug);
        const onBody = distToPolyline(b.start, bodyPoly) <= 0.05 || distToPolyline(b.end, bodyPoly) <= 0.05;
        const onHead = distToPolyline(b.start, hp) <= 0.05 || distToPolyline(b.end, hp) <= 0.05;
        return onBody && onHead;
      });
      if (necks.length < 2) fail(slug + ': the skull must be joined to the body by two anchored neck lines (back + throat), found ' + necks.length);
    }
  }

  const lineEls = els.filter(e => e.p.stroke !== 'none');
  const cache = new Map(); for (const el of lineEls) cache.set(el, outline(el, slug));
  let cross = 0; const hits = [];
  const blades = (el) => el.p.strokeWidth === 2.8;   // the two scissors blades + their handle rings
  for (let i = 0; i < lineEls.length; i++) for (let j = i + 1; j < lineEls.length; j++) {
    const A = cache.get(lineEls[i]), B = cache.get(lineEls[j]);
    const ends = [A[0], A[A.length - 1], B[0], B[B.length - 1]];
    for (let a = 0; a < A.length - 1; a++) {
      let hit = null;
      for (let b = 0; b < B.length - 1; b++) { hit = segInter(A[a], A[a + 1], B[b], B[b + 1]); if (hit) break; }
      if (!hit) continue;
      // split-pdf: the scissors are one object; their blades cross at the pivot and bite through the
      // page edge. Only those two contacts are declared; everything else must still prove itself.
      const scissorPair = slug === 'split-pdf' && blades(lineEls[i]) && blades(lineEls[j]);
      const scissorBitesPage = slug === 'split-pdf' && (blades(lineEls[i]) ? lineEls[j] : lineEls[i]).node.tag === 'rect' && (blades(lineEls[i]) || blades(lineEls[j]));
      if (scissorPair || scissorBitesPage) { declared++; continue; }
      if (hit.ang < MIN_CROSS_ANGLE) continue;   // near-tangential run-in along a shared line, not a collision
      cross++;
      const dmin = Math.min(...ends.map(e => Math.hypot(e[0] - hit.pt[0], e[1] - hit.pt[1])));
      if (dmin <= JOINT_TOL) { joints++; worstJoint = Math.max(worstJoint, dmin); }
      else { defects++; hits.push(desc(lineEls[i]) + ' x ' + desc(lineEls[j]) + ' at ' + hit.pt.map(v => v.toFixed(1)) + ' angle ' + hit.ang.toFixed(0) + 'deg'); }
    }
  }
  if (hits.length) fail(slug + ': ' + hits.length + ' mid-line stroke crossing(s): ' + hits.join('; '));

  const all = []; for (const el of els) for (const p of outline(el, slug)) all.push(p);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  report.push([slug, size, els.length, lineEls.length,
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => v.toFixed(1)).join(' / '), propBox, cross]);
  if (PROFILE === 'gecko') silh.push([slug, headSize, eyeDia, idBand, tailBase, accentMin === Infinity ? 'n/a' : accentMin.toFixed(2)]);
}
const ref = skel[SLUGS[0]];
for (const slug of SLUGS) if (skel[slug] !== ref) fail(slug + ': skeleton groups A+B differ from base.svg');

console.log('set: ' + DIR + '   profile: ' + PROFILE);
console.log('slug                 bytes  els  stroked  ink bbox x0/y0/x1/y1     prop@64px    touch');
for (const r of report) console.log(r[0].padEnd(20) + String(r[1]).padEnd(7) + String(r[2]).padEnd(5) + String(r[3]).padEnd(9) + r[4].padEnd(27) + r[5].padEnd(13) + r[6]);
if (PROFILE === 'gecko' && silh.length) {
  console.log('\nslug                 skull w x h  eye dia  identity band y (elements)  tail  accent min');
  for (const r of silh) console.log(r[0].padEnd(20) + r[1].padEnd(12) + r[2].padEnd(9) + r[3].padEnd(25) + r[4].padEnd(38) + r[5]);
  console.log('bar: skull >= 34 x 26 units, one solid eye r >= 7, identity ink inside y <= ' + EYE_BAND + ', tail base >= 6 units turning >= 60 deg, accent feature >= ' + MIN_ACCENT + ' units');
}
console.log('\nskeleton groups A+B byte-identical across all 11 files: ' + (SLUGS.every(s => skel[s] === ref) ? 'YES' : 'NO'));
console.log('line touchings at drawn joints (<= ' + JOINT_TOL + ' unit from a line ending): ' + joints + (joints ? ' (worst offset ' + worstJoint.toFixed(3) + ' units = ' + (worstJoint * 96 / 120).toFixed(3) + 'px at 96px)' : ''));
console.log('genuine mid-line stroke crossings: ' + defects);
console.log('declared contacts exempted (split-pdf scissors: pivot X + 2 page bites): ' + declared);

/* ---------------- brand mark gate: nothing thinner than 1 px at 16 px ---------------- */
const BRAND = DIR.slice(0, DIR.indexOf('/mascot')) + '/brand/mark.svg';
const MARK_MIN = 4;     // 4 units in a 64 box = 1 px at 16 px
if (fs.existsSync(BRAND)) {
  const src = fs.readFileSync(BRAND, 'utf8'), size = Buffer.byteLength(src);
  if (size > 8192) fail('mark.svg: size ' + size + ' > 8192');
  if (src.split(ACCENT).join('').includes('#')) fail('mark.svg: raw hex outside the accent token');
  if (/\bstyle\s*=/.test(src)) fail('mark.svg: style attribute present');
  if (/url\(/.test(src)) fail('mark.svg: url() reference present');
  if (/\b(?:xlink:)?href\s*=/.test(src)) fail('mark.svg: href reference present');
  if (!src.includes('xmlns="http://www.w3.org/2000/svg"')) fail('mark.svg: missing SVG namespace');
  if (!src.includes('aria-hidden="true"')) fail('mark.svg: not marked decorative');
  if (/<(image|filter|linearGradient|radialGradient|script|text|use|foreignObject)\b/.test(src)) fail('mark.svg: foreign or raster element present');
  const vm = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(src);
  if (!vm) fail('mark.svg: no square viewBox');
  else {
    const W = +vm[1], H = +vm[2];
    const mt = parse(src), mels = []; collect(mt, { fill: 'black', stroke: 'none', strokeWidth: 1 }, mels);
    for (const el of mels) {
      if (!PAINTS.has(el.p.fill)) fail('mark.svg: illegal fill ' + el.p.fill);
      if (!PAINTS.has(el.p.stroke)) fail('mark.svg: illegal stroke ' + el.p.stroke);
      if (el.p.stroke !== 'none' && el.p.strokeWidth < MARK_MIN) fail('mark.svg: stroke ' + el.p.strokeWidth + ' units is under ' + MARK_MIN + ' (dies at 16 px)');
    }
    const all = []; for (const el of mels) for (const p of outline(el, 'mark.svg')) all.push(p);
    for (const p of all) {
      if (!isFinite(p[0]) || !isFinite(p[1])) fail('mark.svg: non-finite coordinate');
      else if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) fail('mark.svg: coordinate outside the viewBox ' + p.map(v => +v.toFixed(1)));
    }
    const bb = bbox(all);
    const fillX = (bb[2] - bb[0]) / W, fillY = (bb[3] - bb[1]) / H;
    if (fillX < 0.55 || fillY < 0.55) fail('mark.svg: glyph fills only ' + (fillX * 100).toFixed(0) + '% x ' + (fillY * 100).toFixed(0) + '% of the box (>= 55%: a 16 px favicon cannot afford padding)');
    let smallest = Infinity, eyes = 0, eyeMin = Infinity;
    for (const el of mels) {
      const eb = bbox(outline(el, 'mark.svg'));
      const dim = Math.min(eb[2] - eb[0], eb[3] - eb[1]);
      const isAccent = el.p.fill === ACCENT || el.p.stroke === ACCENT;
      smallest = Math.min(smallest, dim);
      if (isAccent) { eyes++; eyeMin = Math.min(eyeMin, dim); }
      if (dim < MARK_MIN) fail('mark.svg: a feature is only ' + dim.toFixed(1) + ' units (' + (dim * 16 / W).toFixed(2) + ' px at 16 px): ' + desc(el));
    }
    if (eyes !== 1) fail('mark.svg: the glyph must carry exactly one accent feature (one big eye), found ' + eyes);
    else if (eyeMin < 12) fail('mark.svg: the accent eye is only ' + eyeMin.toFixed(1) + ' units (' + (eyeMin * 16 / W).toFixed(1) + ' px at 16 px); >= 12 units (3 px) expected');
    console.log('\nbrand mark ' + BRAND.replace('C:/toolseer/', '') + ': ' + size + ' bytes, viewBox ' + W + 'x' + H +
      ', glyph fills ' + (fillX * 100).toFixed(0) + '% x ' + (fillY * 100).toFixed(0) + '%, smallest feature ' + smallest.toFixed(1) + ' units = ' + (smallest * 16 / W).toFixed(2) + ' px at 16 px, accent eye ' + eyeMin.toFixed(1) + ' units = ' + (eyeMin * 16 / W).toFixed(1) + ' px');
  }
} else notes.push('no brand mark at ' + BRAND + ' (skipped)');

console.log(fails.length ? '\nFAILURES (' + fails.length + '):\n - ' + fails.join('\n - ') : '\nALL CONTRACT + GEOMETRY CHECKS PASSED');
for (const n of notes) console.log('note: ' + n);
