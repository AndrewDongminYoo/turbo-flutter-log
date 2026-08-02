import * as assert from 'assert';

import { resolveConfig } from '../../config';
import { parseTurboLog } from '../../parse';
import { buildLogStatement, type LogContext } from '../../statement';

const CONTEXT: LogContext = {
  fileName: 'user_bloc.dart',
  lineNumber: 42,
  enclosingClass: 'UserBloc',
  enclosingFunction: 'build',
  expression: 'user',
};

suite('parseTurboLog', () => {
  test('reads back everything it needs from its own output', () => {
    // The round trip is the property that matters: correct re-emits a statement
    // from what it parsed, so anything lost here is lost from the file.
    for (const logFunction of [
      'print',
      'debugPrint',
      'developer.log',
    ] as const) {
      for (const logLevel of ['trace', 'warning', 'fatal'] as const) {
        const config = resolveConfig({ logFunction, logLevel });
        const parsed = parseTurboLog(
          buildLogStatement(config, CONTEXT),
          config,
        );

        assert.ok(parsed, `${logFunction}/${logLevel}`);
        assert.strictEqual(parsed.logFunction, logFunction);
        assert.strictEqual(parsed.logLevel, logLevel);
        assert.strictEqual(parsed.expression, 'user');
      }
    }
  });

  test('recovers an expression that had to be escaped', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const context = { ...CONTEXT, expression: "m['k']" };
    const parsed = parseTurboLog(buildLogStatement(config, context), config);

    assert.strictEqual(parsed?.expression, "m['k']");
  });

  test('recovers a dollar sign in the expression', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const context = { ...CONTEXT, expression: 'cost$rate' };
    const parsed = parseTurboLog(buildLogStatement(config, context), config);

    assert.strictEqual(parsed?.expression, 'cost$rate');
  });

  test('reads the severity from developer.log level: argument', () => {
    const config = resolveConfig({
      logFunction: 'developer.log',
      logLevel: 'error',
    });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(statement.includes('level: 1000'), statement);
    assert.strictEqual(parseTurboLog(statement, config)?.logLevel, 'error');
  });

  test('reports no severity when the width ladder dropped the tag', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(
      config,
      CONTEXT,
      new Set(['location', 'level'] as const),
    );

    assert.ok(!statement.includes('[DEBUG]'), statement);
    assert.strictEqual(parseTurboLog(statement, config)?.logLevel, undefined);
    assert.strictEqual(parseTurboLog(statement, config)?.expression, 'user');
  });

  test('honours the double-quote setting', () => {
    const config = resolveConfig({ logFunction: 'print', quote: '"' });
    const parsed = parseTurboLog(buildLogStatement(config, CONTEXT), config);

    assert.strictEqual(parsed?.quote, '"');
    assert.strictEqual(parsed.expression, 'user');
  });

  test('honours a custom developer.log alias', () => {
    const config = resolveConfig({
      logFunction: 'developer.log',
      developerLogAlias: 'dev',
    });
    const parsed = parseTurboLog(buildLogStatement(config, CONTEXT), config);

    assert.strictEqual(parsed?.logFunction, 'developer.log');
  });

  test('refuses anything that is not a turbo log', () => {
    const config = resolveConfig({});

    for (const text of [
      "print('hello');",
      'final x = 1;',
      "print('🎯 no payload here');",
      '',
    ]) {
      assert.strictEqual(parseTurboLog(text, config), undefined, text);
    }
  });
});
