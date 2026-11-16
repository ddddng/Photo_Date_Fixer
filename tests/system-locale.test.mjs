import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { systemLanguageToLocale } from '../src/i18n.ts';

test('Chinese system locales use Simplified Chinese UI', () => {
  for (const language of ['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-Hans', 'zh-Hant', 'ZH_cn']) {
    assert.equal(systemLanguageToLocale(language), 'zh');
  }
});

test('Unsupported system locales fall back to English', () => {
  for (const language of ['en-US', 'en', 'ja-JP', 'fr-FR', 'de-DE', 'zho', '', null, undefined]) {
    assert.equal(systemLanguageToLocale(language), 'en');
  }
});
