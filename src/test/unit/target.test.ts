import * as assert from 'assert';

import {
  chooseExpression,
  chooseStatementText,
  hasTopLevelStop,
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
  'cursor on the callee of a binary expression': {
    chain: [
      'compute',
      'compute(user.profile)',
      'compute(user.profile) + 1',
      'sum = compute(user.profile) + 1',
      'final sum = compute(user.profile) + 1',
      'final sum = compute(user.profile) + 1;',
    ],
    expected: 'compute(user.profile)',
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
