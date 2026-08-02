# Current state audit — 2026-08-02

Audit of `src/extension.ts` at commit `0a991d0`, before the v1 redesign.
Design that replaces this: `docs/specs/2026-08-02-v1-design.md`.

## Summary

The extension is 165 lines in one file and registers four commands.
Three of them have never worked.
Test coverage is zero, and `README.md` and `CHANGELOG.md` are unmodified `yo code` scaffolding.

## Finding 1 — three commands are dead, not merely incomplete

`src/extension.ts:64`, `:98`, and `:136` build their regular expressions from strings whose `\(` and `\)` were replaced by LaTeX math delimiters:

```js
`${logFunction}\$begin:math:text$.*\\$end:math:text$;`;
```

In a template literal `\$` yields a literal `$`, so the compiled pattern is:

```plaintext
print$begin:math:text$.*\$end:math:text$;
```

The `$` is an end-of-input anchor, so nothing after it can ever match.
Verified by executing the exact expression against a sample Dart file: `match()` returns `null`.

Consequences:

| Command                   | State                              |
| ------------------------- | ---------------------------------- |
| `displayLogMessage`       | Works, with the quality gaps below |
| `commentAllLogMessages`   | No-op                              |
| `uncommentAllLogMessages` | No-op                              |
| `deleteAllLogMessages`    | No-op                              |

`git log -S 'begin:math' -- src/extension.ts` pins the introduction to `0dc10b0`; the preceding commit `238f73d` contained no `RegExp` at all.
The corruption is consistent with markdown or LaTeX post-processing of generated code.

Neither gate could catch it: the strings are valid TypeScript, and the only test asserts `[1,2,3].indexOf(5) === -1`.

## Finding 2 — the multi-logger goal is structurally unsupported

`logFunction` is a single free-form string interpolated as a callee name.
That models `print` and `debugPrint` and nothing else.

- `developer.log` needs `import 'dart:developer'` and named parameters `name:` and `level:`.
- `Logger()` needs an instance in scope and maps severity onto distinct methods (`logger.d`, `logger.w`, `logger.e`).

`logLevel` is declared as an enum of `package:logger`'s six levels but is only uppercased into a string.
Nothing maps a level to a call shape.

## Finding 3 — insert-time timestamp

`generateLogStatement` at `src/extension.ts:162` calls `new Date().toISOString()` and bakes the result into the emitted literal.
The value is fixed at the moment of insertion, so it does not describe when the log ran, and every inserted statement adds an unstable token to the diff.

## Finding 4 — safety gaps that become live once the regex is fixed

- **No provenance marker.** Nothing distinguishes an extension-inserted log from a hand-written one, so a repaired `deleteAllLogMessages` would delete the user's own `print()` calls.
- **No language guard.** `activationEvents` gates activation on Dart, but no command handler checks `document.languageId`. Once activated, the commands run against any open file, including `.ts`.
- **Whole-document replacement.** All three bulk commands call `edit.replace(uri, new Range(0, 0, document.lineCount, 0), updatedText)`. Today this is content-neutral because `updatedText === text`. Once the pattern matches, it collapses undo to a single step and resets cursor, selection, and folding state. Whether `Range(0, 0, lineCount, 0)` is clamped safely by VS Code is `[UNVERIFIED]` — confirming it requires launching the extension host, which was not run for this audit.

## Finding 5 — `displayLogMessage` quality gaps

- Inserts at column 0 unconditionally (`new vscode.Position(lineNumber + 1, 0)`), breaking indentation inside any nested block.
- Reads `editor.selection` only, so multi-cursor is ignored.
- Embeds the raw selection in a string literal, so a multi-line selection emits invalid Dart.
- With no selection, uses the entire line text as both the label and the logged value, producing `print("[DEBUG - ...] final user = getUser();: ", final user = getUser(););`.

## Finding 6 — missing against Turbo Console Log

Checked against the upstream README.

| Feature                                | Present                                              |
| -------------------------------------- | ---------------------------------------------------- |
| Keybindings                            | No — `contributes` has no `keybindings` block at all |
| File name and line number in output    | No                                                   |
| Enclosing class and function in output | No                                                   |
| Correct all log messages               | No                                                   |
| Prefix, suffix, delimiter, quote style | No                                                   |
| Blank line before or after the log     | No                                                   |
| AST-aware insertion point              | No — always the next line                            |
| Multi-cursor insertion                 | No                                                   |

## Recommended order

1. Provenance marker and the language guard, before repairing the pattern — the repair is what makes deletion dangerous.
2. Repair the three patterns, with regression tests.
3. Multi-logger abstraction.
4. Everything else.

The v1 plan folds items 1 and 2 into a single phase for exactly this reason.
