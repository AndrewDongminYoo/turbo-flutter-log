import * as assert from 'assert';

import { resolveConfig } from '../../config';
import { buildLogStatementWithin, type LogContext } from '../../statement';
import { DEFAULT_PAGE_WIDTH, fitsOnOneLine, parsePageWidth } from '../../width';

suite('parsePageWidth', () => {
  test('reads the width declared under formatter', () => {
    assert.strictEqual(parsePageWidth('formatter:\n  page_width: 100\n'), 100);
  });

  test('reads it past other formatter keys and comments', () => {
    const yaml = [
      'include: package:flutter_lints/flutter.yaml',
      '',
      'formatter:',
      '  # keep lines readable',
      '  trailing_commas: preserve',
      '  page_width: 120',
      '',
      'linter:',
      '  rules:',
      '    - prefer_const_constructors',
    ].join('\n');

    assert.strictEqual(parsePageWidth(yaml), 120);
  });

  test('ignores page_width declared outside the formatter block', () => {
    const yaml = ['analyzer:', '  page_width: 200', ''].join('\n');

    assert.strictEqual(parsePageWidth(yaml), undefined);
  });

  test('returns undefined when nothing declares one', () => {
    assert.strictEqual(parsePageWidth('linter:\n  rules: []\n'), undefined);
    assert.strictEqual(parsePageWidth(''), undefined);
  });

  test('rejects a nonsensical width', () => {
    assert.strictEqual(
      parsePageWidth('formatter:\n  page_width: 0\n'),
      undefined,
    );
  });
});

suite('fitsOnOneLine', () => {
  test('counts indentation against the budget', () => {
    assert.ok(fitsOnOneLine('x'.repeat(76), '    ', 80));
    assert.ok(!fitsOnOneLine('x'.repeat(77), '    ', 80));
  });

  test('counts an emoji as its UTF-16 units, as dart format does', () => {
    // Verified by bisecting the wrap point with and without a leading emoji:
    // both split at exactly the same String.length.
    assert.strictEqual('🎯'.length, 2);
    assert.ok(fitsOnOneLine(`🎯${'x'.repeat(78)}`, '', 80));
    assert.ok(!fitsOnOneLine(`🎯${'x'.repeat(79)}`, '', 80));
  });
});

suite('buildLogStatementWithin', () => {
  const CONTEXT: LogContext = {
    fileName: 'palette_repository.dart',
    lineNumber: 44,
    enclosingClass: 'PaletteRepository',
    enclosingFunction: 'load',
    expression: 'resolvedCurrency',
  };

  test('keeps every segment when the budget allows', () => {
    const statement = buildLogStatementWithin(
      resolveConfig({ logFunction: 'print' }),
      CONTEXT,
      '    ',
      200,
    );

    assert.ok(statement.includes('palette_repository.dart:44'), statement);
    assert.ok(statement.includes('[DEBUG]'), statement);
    assert.ok(statement.includes('PaletteRepository.load'), statement);
  });

  test('fits within the default width by giving up segments', () => {
    const statement = buildLogStatementWithin(
      resolveConfig({ logFunction: 'print' }),
      CONTEXT,
      '    ',
      DEFAULT_PAGE_WIDTH,
    );

    assert.ok(
      fitsOnOneLine(statement, '    ', DEFAULT_PAGE_WIDTH),
      `${statement.length + 4} > ${DEFAULT_PAGE_WIDTH}: ${statement}`,
    );
    // The payload always survives; the location is the first thing dropped.
    assert.ok(statement.includes('resolvedCurrency: $resolvedCurrency'));
    assert.ok(!statement.includes('palette_repository.dart'), statement);
  });

  test('drops in the documented order, location first', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const widths = [200, 90, 80, 70, 60];
    const kept = widths.map((width) =>
      buildLogStatementWithin(config, CONTEXT, '    ', width),
    );

    // Each narrower budget keeps a subset of what the wider one kept.
    for (const [index, statement] of kept.entries()) {
      assert.ok(
        statement.length <= kept[Math.max(0, index - 1)].length,
        `${widths[index]}: ${statement}`,
      );
    }
    assert.ok(kept[0].includes('palette_repository.dart'));
    assert.ok(!kept[kept.length - 1].includes('PaletteRepository'), kept[4]);
  });

  test('returns the barest form when even that overflows', () => {
    const statement = buildLogStatementWithin(
      resolveConfig({ logFunction: 'print' }),
      { ...CONTEXT, expression: 'a'.repeat(120) },
      '    ',
      DEFAULT_PAGE_WIDTH,
    );

    // Nothing further can go without discarding the value being logged.
    assert.ok(statement.includes('a'.repeat(120)));
    assert.ok(!statement.includes('[DEBUG]'), statement);
  });
});
