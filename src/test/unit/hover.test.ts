import * as assert from 'assert';

import { classifyHover, firstCodeBlock } from '../../hover';

/**
 * Every hover body below was captured from a running `dart language-server` via
 * `textDocument/hover`, against a fixture holding each shape the cursor lands on.
 * They are recorded rather than invented so the classification stays tied to what
 * the analyzer actually says.
 */
const fence = (declaration: string): string =>
  ['```dart', declaration, '```'].join('\n');

suite('firstCodeBlock', () => {
  test('extracts the declaration from a fenced hover', () => {
    assert.strictEqual(
      firstCodeBlock(fence('Object finalObj')),
      'Object finalObj',
    );
  });

  test('ignores documentation following the block', () => {
    const markdown = [fence('String name'), '', 'The display name.'].join('\n');
    assert.strictEqual(firstCodeBlock(markdown), 'String name');
  });

  test('falls back to the first line when there is no fence', () => {
    assert.strictEqual(firstCodeBlock('String name'), 'String name');
  });
});

suite('classifyHover', () => {
  test('recognises a variable, field, or parameter as a value', () => {
    const cases: [string, string][] = [
      ['Object finalObj', 'finalObj'],
      ['Sheet? sheet', 'sheet'],
      ['dynamic variable', 'variable'],
      ['String name', 'name'],
      ['Map<String, int> cache', 'cache'],
    ];

    for (const [declaration, word] of cases) {
      assert.strictEqual(
        classifyHover(fence(declaration), word),
        'value',
        declaration,
      );
    }
  });

  test('recognises a type name', () => {
    assert.strictEqual(classifyHover(fence('class Sheet'), 'Sheet'), 'type');
    assert.strictEqual(classifyHover(fence('enum Mode'), 'Mode'), 'type');
    assert.strictEqual(
      classifyHover(fence('abstract class Repository'), 'Repository'),
      'type',
    );
  });

  test('recognises the name half of a named argument', () => {
    // Captured at a call site: `show(context: session, dismissible: false)`.
    assert.strictEqual(
      classifyHover(fence('{required bool dismissible}'), 'dismissible'),
      'named-argument',
    );
  });

  test('treats a bare type word as not a value', () => {
    // `dynamic` hovers as just itself.
    assert.strictEqual(
      classifyHover(fence('dynamic'), 'dynamic'),
      'not-a-value',
    );
    assert.strictEqual(classifyHover(fence('void'), 'void'), 'not-a-value');
  });

  test('treats an empty answer as not a value', () => {
    // Keywords such as `final` and `const` return no hover at all.
    assert.strictEqual(classifyHover('', 'final'), 'not-a-value');
    assert.strictEqual(classifyHover('   ', 'const'), 'not-a-value');
  });

  test('distinguishes no answer from an empty answer', () => {
    // undefined means nothing answered, so the caller keeps its fallback rather
    // than refusing everywhere while the server is starting.
    assert.strictEqual(classifyHover(undefined, 'anything'), 'unknown');
  });

  test('reports unknown for a shape it does not recognise', () => {
    assert.strictEqual(
      classifyHover(fence('package:flutter/material.dart'), 'material'),
      'unknown',
    );
  });
});

suite('callables', () => {
  test('a method is not a value, since a bare name is out of scope', () => {
    // Regression: a cursor on `reload` in `await prefs.reload();` logged
    // `$reload`. Climbing to `prefs.reload()` would call it again, so refusing
    // is the only safe answer.
    assert.strictEqual(
      classifyHover(
        ['```dart', 'Future<void> reload()', '```'].join('\n'),
        'reload',
      ),
      'not-a-value',
    );
    assert.strictEqual(
      classifyHover(
        ['```dart', 'int compute(int a)', '```'].join('\n'),
        'compute',
      ),
      'not-a-value',
    );
  });

  test('a getter is still a value', () => {
    assert.strictEqual(
      classifyHover(['```dart', 'int get scope', '```'].join('\n'), 'scope'),
      'value',
    );
  });
});
