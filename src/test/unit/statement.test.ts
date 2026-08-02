import * as assert from 'assert';

import { resolveConfig } from '../../config';
import {
  buildLogStatement,
  escapeLiteral,
  interpolate,
  type LogContext,
} from '../../statement';

const CONTEXT: LogContext = {
  fileName: 'user_bloc.dart',
  lineNumber: 42,
  enclosingClass: 'UserBloc',
  enclosingFunction: 'build',
  expression: 'user',
};

suite('escapeLiteral', () => {
  test('escapes backslashes before anything else', () => {
    // Escaping the quote first would leave the added backslash unescaped.
    assert.strictEqual(escapeLiteral('a\\b', "'"), 'a\\\\b');
  });

  test('escapes the configured quote and leaves the other alone', () => {
    assert.strictEqual(escapeLiteral(`it's "x"`, "'"), `it\\'s "x"`);
    assert.strictEqual(escapeLiteral(`it's "x"`, '"'), `it's \\"x\\"`);
  });

  test('escapes dollar signs so a label cannot open an interpolation', () => {
    assert.strictEqual(escapeLiteral('cost$', "'"), 'cost\\$');
  });
});

suite('interpolate', () => {
  test('uses the bare form only for a plain identifier', () => {
    assert.strictEqual(interpolate('user'), '$user');
    assert.strictEqual(interpolate('_user2'), '$_user2');
  });

  test('uses braces for anything else', () => {
    assert.strictEqual(interpolate('user.name'), '${user.name}');
    assert.strictEqual(interpolate("m['k']"), "${m['k']}");
    assert.strictEqual(interpolate('$user'), '${$user}');
    assert.strictEqual(interpolate('a + b'), '${a + b}');
  });
});

suite('buildLogStatement', () => {
  test('emits the documented shape for debugPrint', () => {
    const config = resolveConfig({ logFunction: 'debugPrint' });

    assert.strictEqual(
      buildLogStatement(config, CONTEXT),
      "debugPrint('🎯 · [DEBUG] · user_bloc.dart:42 · UserBloc.build · user: $user');",
    );
  });

  test('emits the documented shape for developer.log', () => {
    const config = resolveConfig({
      logFunction: 'developer.log',
      logLevel: 'warning',
    });

    assert.strictEqual(
      buildLogStatement(config, CONTEXT),
      "developer.log('🎯 · user_bloc.dart:42 · user: $user', name: 'UserBloc.build', level: 900);",
    );
  });

  test('never emits an insert-time timestamp', () => {
    const statement = buildLogStatement(resolveConfig({}), CONTEXT);
    assert.ok(
      !/\d{4}-\d{2}-\d{2}T/.test(statement),
      `timestamp leaked: ${statement}`,
    );
  });

  test('drops disabled segments without leaving a dangling delimiter', () => {
    const config = resolveConfig({
      logFunction: 'print',
      includeFileName: false,
      includeEnclosingClass: false,
      includeEnclosingFunction: false,
    });

    assert.strictEqual(
      buildLogStatement(config, CONTEXT),
      "print('🎯 · [DEBUG] · user: $user');",
    );
  });

  test('omits name: when no symbol is available', () => {
    const config = resolveConfig({ logFunction: 'developer.log' });
    const statement = buildLogStatement(config, {
      ...CONTEXT,
      enclosingClass: undefined,
      enclosingFunction: undefined,
    });

    assert.ok(!statement.includes('name:'), statement);
    assert.ok(statement.includes('level:'), statement);
  });

  test('uses the class alone when only the function segment is disabled', () => {
    const config = resolveConfig({
      logFunction: 'print',
      includeEnclosingFunction: false,
    });

    assert.ok(
      buildLogStatement(config, CONTEXT).includes('UserBloc · user:'),
      buildLogStatement(config, CONTEXT),
    );
  });

  test('escapes the label but not the interpolated expression', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(config, {
      ...CONTEXT,
      expression: "m['k']",
    });

    // Label escaped, interpolation left verbatim — Dart allows the quote inside `${}`.
    assert.ok(statement.includes("m[\\'k\\']: ${m['k']}"), statement);
  });

  test('drops the line number but keeps the file name when asked', () => {
    const config = resolveConfig({
      logFunction: 'print',
      includeLineNumber: false,
    });

    const statement = buildLogStatement(config, CONTEXT);
    assert.ok(statement.includes('user_bloc.dart ·'), statement);
    assert.ok(!statement.includes(':42'), statement);
  });

  test('honours the double-quote setting throughout', () => {
    const config = resolveConfig({ logFunction: 'developer.log', quote: '"' });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(statement.includes('("🎯'), statement);
    assert.ok(statement.includes('name: "UserBloc.build"'), statement);
  });
});
