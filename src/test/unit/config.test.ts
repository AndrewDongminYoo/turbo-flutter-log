import * as assert from 'assert';

import {
  DEFAULT_CONFIG,
  hasUsableMarker,
  resolveConfig,
  type RawConfig,
} from '../../config';

suite('resolveConfig', () => {
  test('returns the defaults for empty settings', () => {
    assert.deepStrictEqual(resolveConfig({}), DEFAULT_CONFIG);
  });

  test('falls back to the default for an unrecognised enum value', () => {
    const config = resolveConfig({
      logFunction: 'Logger',
      logLevel: 'verbose',
      quote: '`',
    } as RawConfig);

    assert.strictEqual(config.logFunction, DEFAULT_CONFIG.logFunction);
    assert.strictEqual(config.logLevel, DEFAULT_CONFIG.logLevel);
    assert.strictEqual(config.quote, DEFAULT_CONFIG.quote);
  });

  test('falls back to the default when a boolean setting is not a boolean', () => {
    const config = resolveConfig({
      includeFileName: 'true',
      insertEmptyLineAfter: 1,
    } as RawConfig);

    assert.strictEqual(config.includeFileName, DEFAULT_CONFIG.includeFileName);
    assert.strictEqual(
      config.insertEmptyLineAfter,
      DEFAULT_CONFIG.insertEmptyLineAfter,
    );
  });

  test('accepts the values it does recognise', () => {
    const config = resolveConfig({
      logFunction: 'developer.log',
      logLevel: 'error',
      quote: '"',
      includeLineNumber: false,
      developerLogAlias: 'dev',
    });

    assert.strictEqual(config.logFunction, 'developer.log');
    assert.strictEqual(config.logLevel, 'error');
    assert.strictEqual(config.quote, '"');
    assert.strictEqual(config.includeLineNumber, false);
    assert.strictEqual(config.developerLogAlias, 'dev');
  });

  test('preserves an explicitly emptied marker instead of clamping it', () => {
    // Clamping here would make the command layer's refusal unreachable.
    const config = resolveConfig({ marker: '' });

    assert.strictEqual(config.marker, '');
    assert.strictEqual(hasUsableMarker(config), false);
  });

  test('restores the default marker when the setting is absent', () => {
    assert.strictEqual(resolveConfig({}).marker, DEFAULT_CONFIG.marker);
    assert.strictEqual(hasUsableMarker(resolveConfig({})), true);
  });

  test('rejects a marker carrying characters that would break the literal', () => {
    for (const marker of ["it's", 'say "hi"', 'back\\slash', 'cost$']) {
      assert.strictEqual(
        resolveConfig({ marker }).marker,
        DEFAULT_CONFIG.marker,
        marker,
      );
    }
  });

  test('rejects an alias that is not a Dart identifier', () => {
    for (const alias of ['dart:developer', '2dev', 'dev-log', '']) {
      assert.strictEqual(
        resolveConfig({ developerLogAlias: alias }).developerLogAlias,
        DEFAULT_CONFIG.developerLogAlias,
        alias,
      );
    }
  });
});
