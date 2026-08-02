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
    assert.strictEqual(parsed?.developerLogAlias, 'dev');
  });

  test('reads a log written under an alias the settings do not name', () => {
    // Regression: insertion adopts an alias already present in the file, so
    // pinning the callee to the configured one left `dev.log(…)` unparseable and
    // the correct command skipped it while reporting everything as accurate.
    const written = resolveConfig({
      logFunction: 'developer.log',
      developerLogAlias: 'dev',
    });
    const configured = resolveConfig({ logFunction: 'developer.log' });
    const statement = buildLogStatement(written, CONTEXT);
    const parsed = parseTurboLog(statement, configured);

    assert.strictEqual(parsed?.expression, 'user');
    // The alias has to come back too: re-emitting from `developer` in a file that
    // only imports `dev` would stop the file compiling.
    assert.strictEqual(parsed?.developerLogAlias, 'dev');
  });

  test('leaves the alias unset for the unprefixed functions', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const parsed = parseTurboLog(buildLogStatement(config, CONTEXT), config);

    assert.strictEqual(parsed?.developerLogAlias, undefined);
  });

  test('reads back an expression carrying a quote', () => {
    // `${m['k']}` puts the enclosing quote inside the message; a scan that ended
    // the literal there misread both the payload and the trailing arguments.
    const config = resolveConfig({ logFunction: 'developer.log' });
    const context = { ...CONTEXT, expression: "m['k']" };
    const parsed = parseTurboLog(buildLogStatement(config, context), config);

    assert.strictEqual(parsed?.expression, "m['k']");
    assert.strictEqual(parsed?.logLevel, config.logLevel);
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
