/**
 * i18n tests — the language layer, in Node, with no DOM.
 *
 * These exist because of a bug that shipped: `Set.forEach` visits entries added
 * while it is iterating, so a listener that re-rendered itself re-registered a
 * listener, which fired immediately, which re-rendered… The page locked in an
 * endless loop and the language button looked dead. The first test here is that
 * exact regression.
 */
import { beginFile, test, assert } from './harness.mjs';
import { t, setLang, getLang, toggleLang, hasKey, onLangChange, EN, AR, SUPPORTED } from '../apps/web/assets/js/ui/i18n.js';

beginFile('ui-i18n.test.mjs');

/** i18n touches `document` and `localStorage` inside functions; stub both. */
function withBrowserGlobals() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  globalThis.document = {
    documentElement: { lang: 'en', dir: 'ltr' },
    querySelectorAll: () => [],
    dispatchEvent: () => {},
  };
}

withBrowserGlobals();

test('a listener that registers another listener must not recurse', () => {
  let outerCalls = 0;
  let innerCalls = 0;
  let unsubscribe = null;

  unsubscribe = onLangChange(() => {
    outerCalls++;
    /* exactly what a re-rendering component does: it re-registers on every pass */
    onLangChange(() => { innerCalls++; });
  });

  setLang('ar');
  assert.equal(outerCalls, 1, 'the listener fires once, not recursively');
  assert.equal(innerCalls, 0, 'a listener added during the notification must not fire in the same pass');

  setLang('en');
  assert.equal(outerCalls, 2, 'it still fires on the next change');

  unsubscribe();
  setLang('ar');
  assert.equal(outerCalls, 2, 'an unsubscribed listener stops firing');
});

test('a throwing listener cannot break the language change', () => {
  const before = getLang();
  const unsubscribe = onLangChange(() => { throw new Error('listener blew up'); });
  setLang(before === 'ar' ? 'en' : 'ar');
  assert.notEqual(getLang(), before, 'the switch still happened');
  unsubscribe();
});

test('t() interpolates variables and falls back to the key', () => {
  assert.equal(t('error.minFiles', { n: 3 }), 'This tool needs at least 3 files.');
  assert.equal(t('definitely.not.a.key'), 'definitely.not.a.key');
  assert.ok(hasKey('toolbox.title'), 'hasKey finds a real key');
  assert.notOk(hasKey('definitely.not.a.key'), 'hasKey rejects a missing key');
});

test('every dictionary is complete and consistent', () => {
  const en = Object.keys(EN);
  const ar = Object.keys(AR);
  assert.equal(en.length, ar.length, 'EN and AR have the same number of keys');
  assert.deepEqual(en.filter((k) => !(k in AR)), [], 'no EN key is missing from AR');
  assert.deepEqual(ar.filter((k) => !(k in EN)), [], 'no AR key is missing from EN');
  assert.deepEqual(SUPPORTED, ['en', 'ar']);
});

test('interpolation placeholders match across languages', () => {
  const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort();
  for (const key of Object.keys(EN)) {
    assert.deepEqual(placeholders(AR[key] || ''), placeholders(EN[key]),
      `placeholder mismatch in "${key}"`);
  }
});

test('toggleLang cycles between the two languages and persists the choice', () => {
  setLang('en');
  toggleLang();
  assert.equal(getLang(), 'ar');
  assert.equal(globalThis.localStorage.getItem('toolseer:lang'), 'ar', 'the choice is stored');
  toggleLang();
  assert.equal(getLang(), 'en');
});

test('an unknown language is ignored rather than half-applied', () => {
  setLang('en');
  setLang('fr');
  assert.equal(getLang(), 'en', 'an unsupported code leaves the language alone');
});
