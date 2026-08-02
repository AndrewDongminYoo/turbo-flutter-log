import * as assert from 'assert';

import {
  LOG_LEVELS,
  developerLogLevel,
  isLogLevel,
  type LogLevel,
} from '../../levels';

suite('levels', () => {
  test('maps every level to its package:logging constant', () => {
    const expected: Record<LogLevel, number> = {
      trace: 300,
      debug: 500,
      info: 800,
      warning: 900,
      error: 1000,
      fatal: 1200,
    };

    for (const level of LOG_LEVELS) {
      assert.strictEqual(developerLogLevel(level), expected[level], level);
    }
  });

  test('every mapped value is within the range dart:developer documents', () => {
    for (const level of LOG_LEVELS) {
      const value = developerLogLevel(level);
      assert.ok(value >= 0 && value <= 2000, `${level} -> ${value}`);
    }
  });

  test('severity order matches the numeric order', () => {
    const values = LOG_LEVELS.map(developerLogLevel);
    const sorted = [...values].sort((a, b) => a - b);
    assert.deepStrictEqual(values, sorted);
  });

  test('recognises only the levels the extension accepts', () => {
    for (const level of LOG_LEVELS) {
      assert.ok(isLogLevel(level), level);
    }
    for (const value of ['TRACE', 'verbose', '', undefined, 500]) {
      assert.ok(!isLogLevel(value), String(value));
    }
  });
});
