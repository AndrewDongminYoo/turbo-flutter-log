import * as assert from 'assert';

import { LOG_FUNCTIONS, resolveConfig, type TurboConfig } from '../../config';
import {
  escapeRegExp,
  findExpressionLine,
  isTurboLog,
  linesInsideStrings,
  matchTurboLog,
  turboLogPattern,
} from '../../marker';
import { buildLogStatement, type LogContext } from '../../statement';

const CONTEXT: LogContext = {
  fileName: 'user_bloc.dart',
  lineNumber: 42,
  enclosingClass: 'UserBloc',
  enclosingFunction: 'build',
  expression: 'user',
};

function matchCount(text: string, config: TurboConfig): number {
  return [...text.matchAll(turboLogPattern(config))].length;
}

suite('turboLogPattern', () => {
  test('matches its own output for every log function, plain and commented', () => {
    for (const logFunction of LOG_FUNCTIONS) {
      const config = resolveConfig({ logFunction });
      const statement = buildLogStatement(config, CONTEXT);

      assert.ok(isTurboLog(statement, config), `plain: ${statement}`);
      assert.ok(isTurboLog(`  ${statement}`, config), `indented: ${statement}`);
      assert.ok(
        isTurboLog(`  // ${statement}`, config),
        `commented: ${statement}`,
      );
    }
  });

  test('matches developer.log despite its trailing named arguments', () => {
    const config = resolveConfig({ logFunction: 'developer.log' });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(statement.includes('name:'), statement);
    assert.ok(statement.includes('level:'), statement);
    assert.ok(isTurboLog(statement, config));
  });

  test('does not match a hand-written log that merely contains the marker', () => {
    const config = resolveConfig({});
    const handWritten = [
      `print('user said ${config.marker} hello');`,
      `debugPrint('${'x'.repeat(3)} ${config.marker}');`,
      `print('hello');`,
      `final marker = '${config.marker}';`,
    ];

    for (const line of handWritten) {
      assert.ok(!isTurboLog(line, config), line);
    }
  });

  test('leaves hand-written logs alone while finding turbo logs in the same file', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const turbo = buildLogStatement(config, CONTEXT);
    const source = [
      'void main() {',
      "  print('starting up');",
      `  ${turbo}`,
      "  debugPrint('done');",
      '}',
    ].join('\n');

    assert.strictEqual(matchCount(source, config), 1);
  });

  test('matches a log inserted under a different logFunction setting', () => {
    const inserted = buildLogStatement(
      resolveConfig({ logFunction: 'print' }),
      CONTEXT,
    );
    const nowConfigured = resolveConfig({ logFunction: 'developer.log' });

    assert.ok(isTurboLog(inserted, nowConfigured), inserted);
  });

  test('matches both quote styles regardless of the configured one', () => {
    const doubleQuoted = buildLogStatement(
      resolveConfig({ logFunction: 'print', quote: '"' }),
      CONTEXT,
    );

    assert.ok(doubleQuoted.includes('("'), doubleQuoted);
    assert.ok(isTurboLog(doubleQuoted, resolveConfig({ quote: "'" })));
  });

  test('honours a custom developer.log alias', () => {
    const config = resolveConfig({
      logFunction: 'developer.log',
      developerLogAlias: 'dev',
    });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(statement.startsWith('dev.log('), statement);
    assert.ok(isTurboLog(statement, config));

    // Regression: this used to assert the opposite. Insertion adopts an alias
    // already present in the file, so pinning the pattern to the configured one
    // left the extension unable to find logs it had just written.
    assert.ok(isTurboLog(statement, resolveConfig({})), statement);
  });

  test('does not match a call that merely ends in .log without the marker', () => {
    const config = resolveConfig({});
    assert.ok(!isTurboLog("logger.log('starting up');", config));
  });

  test('skips a line carrying a second statement beside the log', () => {
    // Regression: the bulk commands edit whole lines, so matching this deleted
    // `doSomething();` along with the log.
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(!isTurboLog(`  ${statement} doSomething();`, config));
    assert.ok(isTurboLog(`  ${statement}`, config));
  });

  test('matches a log carrying a trailing comment, and hands it back', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(isTurboLog(`  ${statement} // keep an eye on this`, config));

    // Regression: the comment matched but fell outside every capture group, so
    // commenting or correcting the log rebuilt the line without it.
    const parts = matchTurboLog(
      `  ${statement} // keep an eye on this`,
      config,
    );
    assert.strictEqual(parts?.trailing, ' // keep an eye on this');
    assert.strictEqual(
      `${parts?.indent}${parts?.comment}${parts?.statement}${parts?.trailing}`,
      `  ${statement} // keep an eye on this`,
    );
  });

  test('matches a log whose own message contains a semicolon', () => {
    // Regression: excluding `;` from the statement body to keep a second
    // statement off the line also excluded one inside the message, so such a log
    // could be written but never commented, deleted or corrected.
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(config, {
      ...CONTEXT,
      expression: "m['a;b']",
    });

    assert.ok(statement.includes(';'), statement);
    assert.ok(isTurboLog(statement, config), statement);
  });

  test('matches an interpolation carrying the enclosing quote', () => {
    // `${m['k']}` inside a single-quoted message is valid Dart: the quotes are
    // inside an interpolation block, so they do not close the literal.
    const config = resolveConfig({ logFunction: 'print', quote: "'" });
    const statement = buildLogStatement(config, {
      ...CONTEXT,
      expression: "m['k']",
    });

    assert.ok(isTurboLog(statement, config), statement);
    assert.ok(!isTurboLog(`  ${statement} doSomething();`, config), statement);
  });

  test('matches a line left with a carriage return by a CRLF file', () => {
    // Every caller splits the document on `\n`, so on a CRLF file each line
    // arrives with a trailing `\r`. Without tolerating it the bulk commands
    // reported a Windows file as holding no logs at all.
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(isTurboLog(`  ${statement}\r`, config), statement);
    // The `\r` is the line break, not part of the log, so it is never captured.
    assert.strictEqual(matchTurboLog(`  ${statement}\r`, config)?.trailing, '');
  });

  test('treats a marker containing regex metacharacters literally', () => {
    const config = resolveConfig({ marker: '[LOG]', logFunction: 'print' });
    assert.strictEqual(config.marker, '[LOG]');

    const statement = buildLogStatement(config, CONTEXT);
    assert.ok(isTurboLog(statement, config), statement);
    // Without escaping, `[LOG]` would be a character class and match a bare `L`.
    assert.ok(!isTurboLog(`print('L is not the marker');`, config));
  });

  test('escapeRegExp neutralises every metacharacter it claims to', () => {
    const escaped = escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o');
    assert.ok(
      new RegExp(`^${escaped}$`).test('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o'),
    );
    assert.ok(!new RegExp(`^${escaped}$`).test('axbxcxd'));
  });

  test('returns a fresh pattern per call so lastIndex never leaks', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(config, CONTEXT);

    assert.ok(isTurboLog(statement, config));
    assert.ok(isTurboLog(statement, config));
  });
});

suite('linesInsideStrings', () => {
  test('marks the body of a multi-line string', () => {
    // Regression: a log-shaped line inside a ''' block is the contents of a
    // string, and editing it corrupts a template rather than removing a log.
    const lines = [
      "final template = '''",
      "  print('\u{1F3AF} \u00B7 x: $x');",
      "''';",
      "print('\u{1F3AF} \u00B7 y: $y');",
    ];

    assert.deepStrictEqual(linesInsideStrings(lines), [
      false,
      true,
      false,
      false,
    ]);
  });

  test('leaves an ordinary file untouched', () => {
    assert.deepStrictEqual(
      linesInsideStrings(['void main() {', "  print('a');", '}']),
      [false, false, false],
    );
  });

  test('handles a single-line triple-quoted string', () => {
    assert.deepStrictEqual(
      linesInsideStrings(["final s = '''one line''';", 'final t = 1;']),
      [false, false],
    );
  });

  test('ignores the other delimiter inside a block', () => {
    // Regression: counting ''' and """ as one token let a lone """ inside a '''
    // block invert the state, after which every real line below the block was
    // skipped as string content and no log in it could be found.
    assert.deepStrictEqual(
      linesInsideStrings(["final t = '''", 'a """ b', "''';", "print('x');"]),
      [false, true, false, false],
    );
  });
});

suite('findExpressionLine', () => {
  const config = resolveConfig({ logFunction: 'print' });

  function logFor(expression: string): string {
    return buildLogStatement(config, { ...CONTEXT, expression });
  }

  test('finds the statement the expression is declared in', () => {
    const lines = ['final user = load();', logFor('user')];

    assert.strictEqual(findExpressionLine(lines, 1, 'user', config), 0);
  });

  test('skips another log for the same expression', () => {
    // Regression: two logs stacked for one variable made the second match the
    // first one's line, so correcting it reported the log's line, not the code's.
    const lines = ['final user = load();', logFor('user'), logFor('user')];

    assert.strictEqual(findExpressionLine(lines, 2, 'user', config), 0);
  });

  test('skips a comment that mentions the expression', () => {
    const lines = [
      'final user = load();',
      '  // user is nullable here',
      logFor('user'),
    ];

    assert.strictEqual(findExpressionLine(lines, 2, 'user', config), 0);
  });

  test('does not match the expression inside a longer identifier', () => {
    // `user` must not find `username`; with no real occurrence the answer is the
    // fallback, the line directly above.
    const lines = ['final username = 1;', 'noop();'];

    assert.strictEqual(findExpressionLine(lines, 2, 'user', config), 1);
  });

  test('falls back to the line above when nothing matches', () => {
    assert.strictEqual(
      findExpressionLine(['a();', 'b();'], 1, 'user', config),
      0,
    );
    assert.strictEqual(findExpressionLine([], 0, 'user', config), 0);
  });
});
