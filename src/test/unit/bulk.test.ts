import * as assert from 'assert';

import { planBulkEdits } from '../../bulk';
import { resolveConfig, type TurboConfig } from '../../config';
import { buildLogStatement, type LogContext } from '../../statement';

const CONTEXT: LogContext = {
  fileName: 'user_bloc.dart',
  lineNumber: 3,
  enclosingClass: 'UserBloc',
  enclosingFunction: 'build',
  expression: 'user',
};

function apply(
  lines: string[],
  config: TurboConfig,
  mode: Parameters<typeof planBulkEdits>[2],
): string[] {
  const edits = planBulkEdits(lines, config, mode);
  const byLine = new Map(edits.map((edit) => [edit.line, edit]));

  return lines
    .map((text, line) => (byLine.has(line) ? byLine.get(line)!.text : text))
    .filter((text): text is string => text !== undefined);
}

function fixture(config: TurboConfig): string[] {
  return [
    'void main() {',
    "  print('starting up');",
    `  ${buildLogStatement(config, CONTEXT)}`,
    "  debugPrint('hand written');",
    '}',
  ];
}

suite('planBulkEdits', () => {
  test('comment then uncomment restores the file exactly', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const original = fixture(config);

    const commented = apply(original, config, 'comment');
    assert.notDeepStrictEqual(commented, original, 'comment changed nothing');

    assert.deepStrictEqual(apply(commented, config, 'uncomment'), original);
  });

  test('deletes only the marked log, leaving hand-written ones', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const result = apply(fixture(config), config, 'delete');

    assert.deepStrictEqual(result, [
      'void main() {',
      "  print('starting up');",
      "  debugPrint('hand written');",
      '}',
    ]);
  });

  test('comments only the marked log', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const result = apply(fixture(config), config, 'comment');

    assert.strictEqual(result[1], "  print('starting up');");
    assert.ok(result[2].trimStart().startsWith('// print('), result[2]);
    assert.strictEqual(result[3], "  debugPrint('hand written');");
  });

  test('preserves indentation when commenting', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const statement = buildLogStatement(config, CONTEXT);
    const [edit] = planBulkEdits([`      ${statement}`], config, 'comment');

    assert.ok(edit.text?.startsWith('      // '), edit.text);
  });

  test('is a no-op on an already-commented log', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const commented = `  // ${buildLogStatement(config, CONTEXT)}`;

    assert.deepStrictEqual(planBulkEdits([commented], config, 'comment'), []);
  });

  test('is a no-op on an uncommented log when uncommenting', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const statement = `  ${buildLogStatement(config, CONTEXT)}`;

    assert.deepStrictEqual(planBulkEdits([statement], config, 'uncomment'), []);
  });

  test('deletes a commented log too', () => {
    const config = resolveConfig({ logFunction: 'print' });
    const commented = `  // ${buildLogStatement(config, CONTEXT)}`;

    assert.deepStrictEqual(planBulkEdits([commented], config, 'delete'), [
      { line: 0 },
    ]);
  });

  test('finds every supported callee in one pass', () => {
    const config = resolveConfig({});
    const lines = [
      buildLogStatement(resolveConfig({ logFunction: 'print' }), CONTEXT),
      buildLogStatement(resolveConfig({ logFunction: 'debugPrint' }), CONTEXT),
      buildLogStatement(
        resolveConfig({ logFunction: 'developer.log' }),
        CONTEXT,
      ),
      "print('hand written');",
    ];

    assert.strictEqual(planBulkEdits(lines, config, 'delete').length, 3);
  });

  test('keeps a trailing comment through comment and uncomment', () => {
    // Regression: the comment matched but fell outside every capture group, so
    // rebuilding the line silently deleted the user's note.
    const config = resolveConfig({ logFunction: 'print' });
    const line = `  ${buildLogStatement(config, CONTEXT)} // fires twice, why`;

    const commented = apply([line], config, 'comment');
    assert.ok(commented[0].endsWith(' // fires twice, why'), commented[0]);
    assert.deepStrictEqual(apply(commented, config, 'uncomment'), [line]);
  });

  test('touches nothing in a file with no turbo logs', () => {
    const config = resolveConfig({});
    const lines = ['void main() {', "  print('hello');", '}'];

    for (const mode of ['comment', 'uncomment', 'delete'] as const) {
      assert.deepStrictEqual(planBulkEdits(lines, config, mode), [], mode);
    }
  });
});
