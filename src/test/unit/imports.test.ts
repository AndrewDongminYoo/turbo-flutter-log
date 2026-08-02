import * as assert from 'assert';

import { planDeveloperImport } from '../../imports';

suite('planDeveloperImport', () => {
  test('adopts an existing alias rather than rewriting it', () => {
    const plan = planDeveloperImport(
      ["import 'dart:developer' as dev;", '', 'void main() {}'],
      'developer',
    );

    assert.strictEqual(plan.alias, 'dev');
    assert.strictEqual(plan.insertAtLine, undefined);
    assert.strictEqual(plan.text, undefined);
  });

  test('adds a prefixed import after the last existing one', () => {
    const plan = planDeveloperImport(
      [
        "import 'dart:async';",
        "import 'package:flutter/material.dart';",
        '',
        'void main() {}',
      ],
      'developer',
    );

    assert.strictEqual(plan.alias, 'developer');
    assert.strictEqual(plan.insertAtLine, 2);
    assert.strictEqual(plan.text, "import 'dart:developer' as developer;");
  });

  test('adds a prefixed import alongside an unaliased one', () => {
    // Dart permits importing the same library twice under different prefixes,
    // which keeps the emitted callee uniformly `<alias>.log`.
    const plan = planDeveloperImport(
      ["import 'dart:developer';", '', 'void main() {}'],
      'developer',
    );

    assert.strictEqual(plan.alias, 'developer');
    assert.strictEqual(plan.insertAtLine, 1);
  });

  test('inserts after a library directive when there are no imports', () => {
    const plan = planDeveloperImport(
      ['library my_lib;', '', 'void main() {}'],
      'developer',
    );

    assert.strictEqual(plan.insertAtLine, 1);
  });

  test('inserts at the top of a file with no directives at all', () => {
    const plan = planDeveloperImport(['void main() {}'], 'developer');

    assert.strictEqual(plan.insertAtLine, 0);
  });

  test('honours the configured alias', () => {
    const plan = planDeveloperImport(['void main() {}'], 'dev');

    assert.strictEqual(plan.alias, 'dev');
    assert.strictEqual(plan.text, "import 'dart:developer' as dev;");
  });

  test('is not fooled by the word import inside a comment or string', () => {
    const plan = planDeveloperImport(
      ["// import 'dart:developer' as dev;", 'final s = "import \'x\';";'],
      'developer',
    );

    assert.strictEqual(plan.alias, 'developer');
    assert.strictEqual(plan.insertAtLine, 0);
  });

  test('accepts double-quoted directives', () => {
    const plan = planDeveloperImport(
      ['import "dart:developer" as dev;'],
      'developer',
    );

    assert.strictEqual(plan.alias, 'dev');
  });
});
