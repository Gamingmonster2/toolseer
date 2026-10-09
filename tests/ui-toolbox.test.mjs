/**
 * UI-layer tests for the toolbox hub.
 *
 * These run in Node with no DOM: the hub's selection logic (search, filters,
 * ordering, favourites, recently used) was deliberately extracted into pure
 * functions so the part users actually feel is testable without a browser.
 * Rendering itself is covered by tools/e2e.mjs.
 */
import { beginFile, test, assert } from './harness.mjs';
import {
  selectTools,
  roadmapVisible,
  getFavorites,
  getRecent,
  recordUse,
  TOOLS,
  SOON,
  __setStorage,
} from '../apps/web/assets/js/ui/toolbox.js';

beginFile('ui-toolbox.test.mjs');

/** Minimal localStorage stand-in; also proves the module never needs a real one. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    _dump: () => Object.fromEntries(map),
  };
}

const slugs = (list) => list.map((tool) => tool.slug);

test('the registry matches the lineup the owner asked for', () => {
  /* One-click tools only. The owner removed the password and OCR pages on
     2026-10-07: they needed too much configuration for a tools site. */
  assert.equal(TOOLS.length, 7, 'seven interactive tools in the hub');
  for (const slug of [
    'image-to-pdf', 'merge-pdf', 'compress-pdf', 'split-pdf',
    'rotate-pdf', 'pdf-to-images', 'organize-pdf',
  ]) {
    assert.ok(TOOLS.some((tool) => tool.slug === slug), `registry is missing ${slug}`);
  }
  for (const removed of ['protect-pdf', 'unlock-pdf', 'extract-text-pdf']) {
    assert.notOk(TOOLS.some((tool) => tool.slug === removed), `${removed} should no longer be offered`);
  }
  assert.ok(SOON.length >= 6, 'the roadmap row stays populated');
  assert.notOk(SOON.some((s) => s.id === 'rotate-pdf'), 'a shipped tool must leave the roadmap');
});

test('an empty query returns every tool in registry order', () => {
  const list = selectTools({ query: '', filter: 'all' });
  assert.equal(list.length, TOOLS.length);
  assert.deepEqual(slugs(list), slugs(TOOLS));
});

test('search matches an English word in the tool name', () => {
  const list = selectTools({ query: 'compress' });
  assert.deepEqual(slugs(list), ['compress-pdf']);
});

test('search is case-insensitive and ignores surrounding spaces', () => {
  assert.deepEqual(slugs(selectTools({ query: '  MERGE  ' })), ['merge-pdf']);
});

test('search matches Arabic synonyms — the primary market', () => {
  assert.deepEqual(slugs(selectTools({ query: 'دمج' })), ['merge-pdf'], 'دمج finds merge');
  assert.deepEqual(slugs(selectTools({ query: 'ضغط' })), ['compress-pdf'], 'ضغط finds compress');
  assert.deepEqual(slugs(selectTools({ query: 'تقسيم' })), ['split-pdf'], 'تقسيم finds split');
  assert.deepEqual(slugs(selectTools({ query: 'مقلوب' })), ['rotate-pdf'], 'مقلوب finds rotate');
  /* "تدوير" legitimately finds two tools: the one-click rotator and Organize,
     which rotates individual pages. Assert inclusion, not exclusivity. */
  assert.ok(slugs(selectTools({ query: 'تدوير' })).includes('rotate-pdf'), 'تدوير finds rotate');
});

test('the tools the owner retired are no longer findable in the hub', () => {
  const retired = ['protect-pdf', 'unlock-pdf', 'extract-text-pdf'];
  for (const query of ['password', 'protect', 'unlock', 'encrypt', 'ocr', 'extract', 'حماية', 'كلمة مرور', 'استخراج']) {
    const hits = slugs(selectTools({ query })).filter((slug) => retired.includes(slug));
    assert.deepEqual(hits, [], `"${query}" must not surface a retired tool`);
  }
});

test('search matches the visible description too', () => {
  /* "photos and scans" lives in the image-to-pdf description, not its name */
  const list = selectTools({ query: 'scans' });
  assert.ok(slugs(list).includes('image-to-pdf'), `expected image-to-pdf, got ${slugs(list).join(',')}`);
});

test('a query that matches nothing returns an empty list, not everything', () => {
  assert.deepEqual(selectTools({ query: 'zzzz-no-such-tool' }), []);
});

test('favourites filter keeps only starred tools and preserves registry order', () => {
  const list = selectTools({ filter: 'favorites', favorites: ['split-pdf', 'merge-pdf'] });
  assert.deepEqual(slugs(list), ['merge-pdf', 'split-pdf']);
});

test('favourites and search compose', () => {
  const list = selectTools({ query: 'pdf', filter: 'favorites', favorites: ['compress-pdf', 'rotate-pdf'] });
  assert.deepEqual(slugs(list), ['compress-pdf', 'rotate-pdf']);
});

test('recent ordering follows the recorded order, most recent first', () => {
  const list = selectTools({ filter: 'recent', recent: ['split-pdf', 'merge-pdf', 'compress-pdf'] });
  assert.deepEqual(slugs(list), ['split-pdf', 'merge-pdf', 'compress-pdf']);
});

test('recent ignores tools that were never used', () => {
  const list = selectTools({ filter: 'recent', recent: ['merge-pdf'] });
  assert.deepEqual(slugs(list), ['merge-pdf']);
});

test('the roadmap row only shows on the unfiltered, unsearched view', () => {
  assert.ok(roadmapVisible({ query: '', filter: 'all' }), 'visible on the default view');
  assert.notOk(roadmapVisible({ query: 'merge', filter: 'all' }), 'hidden while searching');
  assert.notOk(roadmapVisible({ query: '', filter: 'favorites' }), 'hidden on a filtered view');
});

test('a whitespace-only query behaves exactly like an empty one', () => {
  /* Invariant worth locking down: spaces must not produce a "no results" state
     while the roadmap row is still on screen, i.e. the two must agree. */
  const blank = '   ';
  assert.equal(selectTools({ query: blank }).length, TOOLS.length, 'the full list is shown');
  assert.equal(roadmapVisible({ query: blank, filter: 'all' }), roadmapVisible({ query: '', filter: 'all' }),
    'the roadmap row agrees with the list');
});

test('favourites round-trip through storage, toggling on and off', () => {
  const storage = fakeStorage();
  __setStorage(storage);

  assert.deepEqual(getFavorites(), [], 'starts empty');

  /* toggle on */
  const first = ['merge-pdf', ...getFavorites()];
  storage.setItem('toolseer:favorites', JSON.stringify(first));
  assert.deepEqual(getFavorites(), ['merge-pdf']);

  /* toggle off */
  storage.setItem('toolseer:favorites', JSON.stringify(getFavorites().filter((s) => s !== 'merge-pdf')));
  assert.deepEqual(getFavorites(), []);
});

test('recently used is most-recent-first, deduplicated, and capped', () => {
  const storage = fakeStorage();
  __setStorage(storage);

  recordUse('merge-pdf');
  recordUse('compress-pdf');
  recordUse('merge-pdf');
  assert.deepEqual(getRecent(), ['merge-pdf', 'compress-pdf'], 're-use moves a tool to the front');

  for (let i = 0; i < 20; i++) recordUse(`tool-${i}`);
  const recent = getRecent();
  assert.equal(recent.length, 12, 'the list is capped');
  assert.equal(recent[0], 'tool-19', 'newest first');
});

test('corrupt storage never breaks the hub', () => {
  const storage = fakeStorage();
  storage.setItem('toolseer:favorites', '{not json');
  storage.setItem('toolseer:recent', '{"not":"a list"}');
  __setStorage(storage);

  assert.deepEqual(getFavorites(), [], 'corrupt favourites fall back to empty');
  assert.deepEqual(getRecent(), [], 'a non-array falls back to empty');
  assert.deepEqual(slugs(selectTools({ filter: 'favorites', favorites: getFavorites() })), []);
});

test('a missing storage API (private mode) degrades instead of throwing', () => {
  __setStorage({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  assert.deepEqual(getFavorites(), []);
  recordUse('merge-pdf');
  assert.deepEqual(getRecent(), []);
  __setStorage(fakeStorage());
});
