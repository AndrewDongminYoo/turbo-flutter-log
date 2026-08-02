import * as assert from 'assert';

import {
  assignmentIndex,
  bodyOpeningAfter,
  chooseExpression,
  chooseStatementText,
  closureBodyOpening,
  declaredNameIn,
  hasTopLevelStop,
  isDeclaration,
  isLoggableExpression,
  isLoggableIdentifier,
} from '../../target';

/**
 * Every chain below was captured from a running `dart language-server` via
 * `textDocument/selectionRange`, innermost first. They are recorded rather than
 * invented so the rules stay tied to what Dart actually returns.
 */
const CHAINS: Record<string, { chain: string[]; expected: string }> = {
  'cursor on the last member of a chain': {
    chain: [
      'name',
      'user.profile.name',
      'name = user.profile.name',
      'final name = user.profile.name',
      'final name = user.profile.name;',
    ],
    expected: 'user.profile.name',
  },
  'cursor on the first member of a chain': {
    chain: [
      'user',
      'user.profile',
      'user.profile.name',
      'name = user.profile.name',
      'final name = user.profile.name',
      'final name = user.profile.name;',
    ],
    expected: 'user.profile.name',
  },
  'cursor on a call argument': {
    chain: ['user', '(user)', 'print(user)', 'print(user);'],
    expected: 'user',
  },
  'cursor on an index key': {
    chain: [
      "'k'",
      "m['k']",
      "v = m['k']",
      "final v = m['k']",
      "final v = m['k'];",
    ],
    expected: "m['k']",
  },
  'cursor on the indexed target': {
    chain: [
      'm',
      "m['k']",
      "v = m['k']",
      "final v = m['k']",
      "final v = m['k'];",
    ],
    expected: "m['k']",
  },
  'cursor inside an argument of a binary expression': {
    chain: [
      'profile',
      'user.profile',
      '(user.profile)',
      'compute(user.profile)',
      'compute(user.profile) + 1',
      'sum = compute(user.profile) + 1',
    ],
    expected: 'user.profile',
  },
  // Stops at the callee rather than widening to the call. Logging
  // `compute(user.profile)` would invoke it a second time, and a log must not
  // have side effects — the case that surfaced this was `prefs` widening to
  // `await prefs.reload()`.
  'cursor on the callee of a binary expression': {
    chain: [
      'compute',
      'compute(user.profile)',
      'compute(user.profile) + 1',
      'sum = compute(user.profile) + 1',
      'final sum = compute(user.profile) + 1',
      'final sum = compute(user.profile) + 1;',
    ],
    expected: 'compute',
  },
};

suite('chooseExpression', () => {
  for (const [name, { chain, expected }] of Object.entries(CHAINS)) {
    test(name, () => {
      assert.strictEqual(chooseExpression(chain), expected);
    });
  }

  test('returns the empty string for an empty chain', () => {
    assert.strictEqual(chooseExpression([]), '');
  });

  test('yields nothing when the innermost range is a declarator', () => {
    // Regression: Dart returns the whole declarator for a cursor on the declared
    // name. Seeding the walk with it unchecked logged `name = session.user.name`,
    // which reassigns a final variable and does not compile.
    assert.strictEqual(
      chooseExpression(['name = session.user.name', 'final name = ...']),
      '',
    );
  });

  test('yields nothing when the innermost range spans lines', () => {
    // Regression: same shape, from a cursor inside a multi-line statement.
    assert.strictEqual(
      chooseExpression(["result = await fetch<String>(\n  'key',\n)"]),
      '',
    );
  });

  test('never climbs into a multi-line ancestor', () => {
    const chain = ['user', 'user.profile', 'if (x) {\n  user.profile\n}'];
    assert.strictEqual(chooseExpression(chain), 'user.profile');
  });
});

suite('hasTopLevelStop', () => {
  test('stops on assignment and on statement terminators', () => {
    assert.ok(hasTopLevelStop('name = user'));
    assert.ok(hasTopLevelStop('print(user);'));
  });

  test('stops on a top-level binary operator', () => {
    assert.ok(hasTopLevelStop('compute(p) + 1'));
    assert.ok(hasTopLevelStop('a && b'));
  });

  test('ignores operators nested inside brackets', () => {
    assert.ok(!hasTopLevelStop('compute(a + b)'));
    assert.ok(!hasTopLevelStop("m['a' + 'b']"));
  });

  test('stops on any top-level comparison or arrow, as it does on assignment', () => {
    // The useful expression is an operand in every one of these.
    for (const text of ['a == b', 'a==b', 'a != b', 'a <= b', '(x) => x']) {
      assert.ok(hasTopLevelStop(text), text);
    }
  });

  test('ignores an arrow nested inside brackets', () => {
    assert.ok(!hasTopLevelStop('items.map((x) => x.id)'));
  });

  test('treats null-aware navigation as part of a value reference', () => {
    assert.ok(!hasTopLevelStop('user?.profile'));
    assert.ok(!hasTopLevelStop('user?.profile?.name'));
  });

  test('passes a plain value reference', () => {
    for (const text of ['user', 'user.profile.name', "m['k']", 'compute(p)']) {
      assert.ok(!hasTopLevelStop(text), text);
    }
  });
});

suite('chooseStatementText', () => {
  test('finds the innermost single-line ancestor ending the statement', () => {
    assert.strictEqual(
      chooseStatementText(CHAINS['cursor on the last member of a chain'].chain),
      'final name = user.profile.name;',
    );
  });

  test('finds a statement that spans several lines', () => {
    // Regression: restricting this to single-line ancestors returned undefined
    // here, the caller fell back to the cursor's line, and the log landed inside
    // the argument list. Chain captured from `dart language-server` for a cursor
    // in `final result = await fetch<String>(\n  'key',\n);`.
    const multiLine =
      "    final result = await fetch<String>(\n      'key',\n    );";

    assert.strictEqual(
      chooseStatementText([
        multiLine,
        multiLine,
        '  Future<bool> load() {\n...\n  }',
      ]),
      multiLine,
    );
  });

  test('prefers the innermost statement over an enclosing one', () => {
    assert.strictEqual(
      chooseStatementText(['user', 'print(user);', 'if (x) call();']),
      'print(user);',
    );
  });

  test('returns undefined when nothing in the chain ends a statement', () => {
    assert.strictEqual(
      chooseStatementText(['user', 'user.profile']),
      undefined,
    );
  });
});

suite('isLoggableIdentifier', () => {
  test('rejects reserved words that cannot be a value', () => {
    // Regression: a caret on `final` produced `$final`, which does not compile.
    for (const word of [
      'final',
      'const',
      'var',
      'return',
      'if',
      'null',
      'true',
      'void',
      'static',
    ]) {
      assert.ok(!isLoggableIdentifier(word), word);
    }
  });

  test('accepts this, which is reserved but perfectly loggable', () => {
    assert.ok(isLoggableIdentifier('this'));
  });

  test('accepts contextual keywords, which may be real variable names', () => {
    for (const word of ['show', 'hide', 'on', 'of', 'when', 'sealed']) {
      assert.ok(isLoggableIdentifier(word), word);
    }
  });

  test('accepts ordinary identifiers and rejects non-identifiers', () => {
    assert.ok(isLoggableIdentifier('resolvedCurrency'));
    assert.ok(isLoggableIdentifier('_private'));
    assert.ok(!isLoggableIdentifier('user.name'));
    assert.ok(!isLoggableIdentifier('2fast'));
    assert.ok(!isLoggableIdentifier(''));
  });
});

suite('declaredNameIn', () => {
  test('recovers the declared variable from a declaration', () => {
    assert.strictEqual(
      declaredNameIn('final resolvedCurrency = await repository.load();'),
      'resolvedCurrency',
    );
    assert.strictEqual(
      declaredNameIn('static const int maxRetries = 3;'),
      'maxRetries',
    );
  });

  test('returns undefined when the statement declares nothing', () => {
    assert.strictEqual(declaredNameIn('await pendingOperation;'), undefined);
    assert.strictEqual(declaredNameIn('if (a == b) return;'), undefined);
  });
});

suite('not-a-value cursor positions', () => {
  test('rejects a named argument, which is a name and a value, not one value', () => {
    // Regression: `dismissible: false,` was accepted and interpolated whole.
    assert.ok(hasTopLevelStop('dismissible: false,'));
    assert.ok(hasTopLevelStop('    dismissible: false,'));
    assert.strictEqual(chooseExpression(['dismissible: false,']), '');
  });

  test('rejects an argument list', () => {
    assert.ok(hasTopLevelStop('context, dismissible: false'));
  });

  test('still accepts a value carrying a comma inside brackets', () => {
    assert.ok(!hasTopLevelStop('compute(a, b)'));
    assert.ok(!hasTopLevelStop("m['a']"));
  });
});

suite('declaration prefixes', () => {
  const CASES: [string, string][] = [
    ['final resolvedCurrency = await repository.load();', 'resolvedCurrency'],
    ['Sheet? sheet = await pop<Sheet>(context);', 'sheet'],
    ['dynamic variable = someFunction();', 'variable'],
    ['Map<String, dynamic> map = <String, dynamic>{};', 'map'],
    ['variable = anotherFunction();', 'variable'],
    ['static const int maxRetries = 3;', 'maxRetries'],
    ['late final List<Sheet> sheets = [];', 'sheets'],
  ];

  for (const [statement, expected] of CASES) {
    test(`recovers ${expected} from ${JSON.stringify(statement)}`, () => {
      assert.strictEqual(declaredNameIn(statement), expected);
      // Every one of these has an assignment, so a cursor in the prefix is
      // recognised as being left of it.
      assert.ok(assignmentIndex(statement) > 0, statement);
    });
  }

  test('finds no assignment where there is none', () => {
    assert.strictEqual(assignmentIndex('await pendingOperation;'), -1);
    assert.strictEqual(assignmentIndex('dismissible: false,'), -1);
  });

  test('does not mistake a comparison or an arrow for an assignment', () => {
    assert.strictEqual(assignmentIndex('if (a == b) return;'), -1);
    assert.strictEqual(assignmentIndex('items.map((x) => x.id);'), -1);
    assert.strictEqual(assignmentIndex('a != b;'), -1);
  });

  test('ignores an assignment nested inside brackets', () => {
    // The outer statement assigns nothing; the inner one is not the target.
    assert.strictEqual(assignmentIndex('call(() { x = 1; });'), -1);
  });
});

suite('isLoggableExpression', () => {
  test('accepts expressions a user would deliberately select', () => {
    for (const text of [
      'user',
      'user.profile.name',
      "m['k']",
      'compute(a, b)',
      'a + b',
      'a == b',
      'items.map((x) => x.id)',
      'this',
    ]) {
      assert.ok(isLoggableExpression(text), text);
    }
  });

  test('rejects a keyword selected out of a longer identifier', () => {
    // Regression: selecting `final` from `finalObj` emitted `$final`.
    assert.ok(!isLoggableExpression('final'));
    assert.ok(!isLoggableExpression('const'));
    assert.ok(isLoggableExpression('finalObj'));
  });

  test('rejects a fragment left by a partial selection', () => {
    for (const text of [
      'user.',
      '.name',
      'compute(',
      'a +',
      ')',
      'user, other',
      'dismissible: false',
      'x = 1',
      '',
      '  ',
    ]) {
      assert.ok(!isLoggableExpression(text), JSON.stringify(text));
    }
  });

  test('rejects unbalanced brackets', () => {
    assert.ok(!isLoggableExpression('compute(a, b'));
    assert.ok(!isLoggableExpression('a, b)'));
  });

  test('rejects a multi-line selection', () => {
    assert.ok(!isLoggableExpression('a +\n  b'));
  });
});

suite('closureBodyOpening', () => {
  test('finds the body of a named closure argument', () => {
    // Chain captured from `dart language-server` for a cursor on `context` in
    // `builder: (context) {` — the parent is `(context)`, the grandparent the
    // whole named argument.
    const opening = closureBodyOpening(
      '(context)',
      "builder: (context) {\n      final label = 'x';\n      return Column();\n    }",
    );

    assert.deepStrictEqual(opening, { lineOffset: 0, character: 19 });
  });

  test('finds the body of a bare anonymous function', () => {
    assert.ok(closureBodyOpening('(a, b)', '(a, b) {\n  return a;\n}'));
    assert.ok(closureBodyOpening('()', '() async {\n  return 1;\n}'));
    assert.ok(closureBodyOpening('()', '() sync* {\n  yield 1;\n}'));
  });

  test('ignores a switch expression, whose braces hold case arms', () => {
    // Regression guard: inserting a statement between case arms does not compile.
    assert.strictEqual(
      closureBodyOpening(
        '(value)',
        'switch (value) {\n  1 => a,\n  _ => b,\n}',
      ),
      undefined,
    );
  });

  test('ignores the other control constructs', () => {
    for (const keyword of ['if', 'while', 'do', 'assert']) {
      assert.strictEqual(
        closureBodyOpening('(x)', `${keyword} (x) {\n  y();\n}`),
        undefined,
        keyword,
      );
    }
  });

  test('keeps for and catch, which bind names scoped to the block', () => {
    assert.ok(
      closureBodyOpening('(final e)', 'catch (final e) {\n  handle(e);\n}'),
    );
  });

  test('ignores a collection literal', () => {
    assert.strictEqual(
      closureBodyOpening('(map)', 'read(map) ?? <String, dynamic>{}'),
      undefined,
    );
  });

  test('ignores anything that is not a parenthesised list', () => {
    assert.strictEqual(
      closureBodyOpening('context', 'builder: (context) {}'),
      undefined,
    );
    assert.strictEqual(closureBodyOpening(undefined, 'x'), undefined);
    assert.strictEqual(closureBodyOpening('(x)', undefined), undefined);
  });
});

suite('isDeclaration', () => {
  test('recognises a formal parameter, which the chain returns for a signature cursor', () => {
    // Regression: a cursor in `build(BuildContext context)` returned the whole
    // parameter, and `${BuildContext context}` does not compile.
    assert.ok(isDeclaration('BuildContext context'));
    assert.ok(isDeclaration('Map<String, dynamic> map'));
    assert.ok(isDeclaration('Sheet? sheet'));
    assert.ok(isDeclaration('List<int> values'));
  });

  test('does not mistake an expression for a declaration', () => {
    for (const text of [
      'user',
      'user.profile.name',
      'a + b',
      "m['k']",
      'compute(a, b)',
      'await prefs.reload()',
      'const Duration(seconds: 1)',
      'return value',
    ]) {
      assert.ok(!isDeclaration(text), text);
    }
  });

  test('chooseExpression rejects a declaration seed', () => {
    assert.strictEqual(
      chooseExpression(['BuildContext context', '(BuildContext context)']),
      '',
    );
  });
});

suite('logs must not invoke anything', () => {
  test('stops before a call when climbing a member chain', () => {
    // Regression: selecting `prefs` in `await prefs.reload();` produced
    // `${await prefs.reload()}`, which calls the method a second time.
    assert.strictEqual(
      chooseExpression([
        'prefs',
        'prefs.reload',
        'prefs.reload()',
        'await prefs.reload()',
        'await prefs.reload();',
      ]),
      'prefs.reload',
    );
  });

  test('never climbs into an await', () => {
    assert.strictEqual(
      chooseExpression(['value', 'await value', 'await value;']),
      'value',
    );
  });

  test('still climbs a plain member chain', () => {
    assert.strictEqual(
      chooseExpression(['user', 'user.profile', 'user.profile.name']),
      'user.profile.name',
    );
  });
});

suite('declaredNameIn with member targets', () => {
  test('keeps the whole assignment target', () => {
    // Regression: `state.needsReload = false` yielded `needsReload`, a name
    // that does not exist on its own.
    assert.strictEqual(
      declaredNameIn('state.needsReload = false;'),
      'state.needsReload',
    );
  });

  test('still returns a plain declared name', () => {
    assert.strictEqual(declaredNameIn('final prefs = load();'), 'prefs');
  });
});

suite('bodyOpeningAfter', () => {
  // The exact shape that broke a file: a log went into the parameter list.
  const SIGNATURE = [
    '  @override',
    '  Future<void> recordError(',
    '    Object error,',
    '    StackTrace? stack, {',
    '    String? reason,',
    '    bool fatal = false,',
    '    Map<String, Object?> context = const {},',
    '  }) async {',
    '    if (!isEnabled) return;',
    '  }',
  ];

  test('finds the body from a cursor on a named parameter', () => {
    assert.strictEqual(bodyOpeningAfter(SIGNATURE, 6), 7);
  });

  test('skips the brace that opens the named parameter group', () => {
    // Line 3 ends with `{`, but it follows a comma: it groups parameters.
    assert.strictEqual(bodyOpeningAfter(SIGNATURE, 3), 7);
  });

  test('skips a collection literal in a default value', () => {
    assert.strictEqual(
      bodyOpeningAfter(
        ['  Map<String, Object?> c = const {},', '  }) async {'],
        0,
      ),
      1,
    );
  });

  test('accepts a block opened on the cursor line itself', () => {
    assert.strictEqual(
      bodyOpeningAfter(['    if (state.needsReload) {'], 0),
      0,
    );
  });

  test('accepts an else, try and finally block', () => {
    assert.strictEqual(bodyOpeningAfter(['  } else {'], 0), 0);
    assert.strictEqual(bodyOpeningAfter(['  try {'], 0), 0);
  });

  test('gives up when a statement ends before any body opens', () => {
    assert.strictEqual(
      bodyOpeningAfter(['    final x = 1;', '    void f() {'], 0),
      undefined,
    );
  });

  test('gives up on an expression body, which cannot hold a statement', () => {
    assert.strictEqual(
      bodyOpeningAfter(['  Future<T?> fetch<T>(String k) async => null;'], 0),
      undefined,
    );
  });

  test('gives up rather than scanning the whole file', () => {
    const lines = Array.from({ length: 100 }, () => '    // nothing here');
    assert.strictEqual(bodyOpeningAfter(lines, 0), undefined);
  });
});
