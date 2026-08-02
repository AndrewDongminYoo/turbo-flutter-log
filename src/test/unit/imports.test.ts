import * as assert from 'assert';

import { planImport } from '../../imports';

suite('planImport', () => {
  suite('print', () => {
    test('needs no directive, since print is dart:core', () => {
      const plan = planImport(['void main() {}'], 'print', 'developer');

      assert.strictEqual(plan.insertAtLine, undefined);
      assert.strictEqual(plan.text, undefined);
    });
  });

  suite('debugPrint', () => {
    test('adds foundation when no Flutter library is imported', () => {
      const plan = planImport(
        ["import 'dart:async';", '', 'void main() {}'],
        'debugPrint',
        'developer',
      );

      assert.strictEqual(plan.insertAtLine, 1);
      assert.strictEqual(
        plan.text,
        "import 'package:flutter/foundation.dart';",
      );
    });

    test('is satisfied by any library that re-exports debugPrint', () => {
      // widgets.dart reaches it through src/widgets/framework.dart, which carries
      // `export 'package:flutter/foundation.dart' show ..., debugPrint, ...`;
      // material.dart and cupertino.dart both re-export widgets.dart.
      for (const library of [
        'foundation',
        'widgets',
        'material',
        'cupertino',
      ]) {
        const plan = planImport(
          [`import 'package:flutter/${library}.dart';`],
          'debugPrint',
          'developer',
        );

        assert.strictEqual(plan.insertAtLine, undefined, library);
      }
    });

    test('is not satisfied by an unrelated flutter library', () => {
      const plan = planImport(
        ["import 'package:flutter/services.dart';"],
        'debugPrint',
        'developer',
      );

      assert.strictEqual(plan.insertAtLine, 1);
    });

    test('is not fooled by the library name inside a comment', () => {
      const plan = planImport(
        ["// import 'package:flutter/material.dart';"],
        'debugPrint',
        'developer',
      );

      assert.strictEqual(plan.insertAtLine, 0);
    });
  });

  suite('developer.log', () => {
    test('adopts an existing alias rather than rewriting it', () => {
      const plan = planImport(
        ["import 'dart:developer' as dev;", '', 'void main() {}'],
        'developer.log',
        'developer',
      );

      assert.strictEqual(plan.alias, 'dev');
      assert.strictEqual(plan.insertAtLine, undefined);
    });

    test('adds a prefixed import after the last existing one', () => {
      const plan = planImport(
        [
          "import 'dart:async';",
          "import 'package:flutter/material.dart';",
          '',
          'void main() {}',
        ],
        'developer.log',
        'developer',
      );

      assert.strictEqual(plan.alias, 'developer');
      assert.strictEqual(plan.insertAtLine, 2);
      assert.strictEqual(plan.text, "import 'dart:developer' as developer;");
    });

    test('adds a prefixed import alongside an unaliased one', () => {
      const plan = planImport(
        ["import 'dart:developer';", '', 'void main() {}'],
        'developer.log',
        'developer',
      );

      assert.strictEqual(plan.alias, 'developer');
      assert.strictEqual(plan.insertAtLine, 1);
    });

    test('inserts after a library directive when there are no imports', () => {
      const plan = planImport(
        ['library my_lib;', '', 'void main() {}'],
        'developer.log',
        'developer',
      );

      assert.strictEqual(plan.insertAtLine, 1);
    });

    test('inserts at the top of a file with no directives at all', () => {
      const plan = planImport(['void main() {}'], 'developer.log', 'developer');

      assert.strictEqual(plan.insertAtLine, 0);
    });

    test('honours the configured alias', () => {
      const plan = planImport(['void main() {}'], 'developer.log', 'dev');

      assert.strictEqual(plan.alias, 'dev');
      assert.strictEqual(plan.text, "import 'dart:developer' as dev;");
    });

    test('accepts double-quoted directives', () => {
      const plan = planImport(
        ['import "dart:developer" as dev;'],
        'developer.log',
        'developer',
      );

      assert.strictEqual(plan.alias, 'dev');
    });
  });
});
