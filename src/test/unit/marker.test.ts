import * as assert from 'assert';

import { LOG_FUNCTIONS, resolveConfig, type TurboConfig } from '../../config';
import { escapeRegExp, isTurboLog, turboLogPattern } from '../../marker';
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
    // The default alias must not match a log written against a different one.
    assert.ok(!isTurboLog(statement, resolveConfig({})));
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
