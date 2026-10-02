import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I18N, t } from '../../js/i18n.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('every language has the same keys as English', () => {
  const en = Object.keys(I18N.en).sort();
  for (const [lang, dict] of Object.entries(I18N)) assert.deepEqual(Object.keys(dict).sort(), en, lang);
});

test('placeholders match across languages', () => {
  for (const [lang, dict] of Object.entries(I18N))
    for (const [k, v] of Object.entries(dict)) assert.equal(placeholders(v), placeholders(I18N.en[k]), `${lang}:${k}`);
});

test('t() interpolates and falls back to the key', () => {
  assert.match(t('status.multi', { n: 1, total: 2 }), /1.*2/);
  assert.equal(t('no.such.key'), 'no.such.key');
});
