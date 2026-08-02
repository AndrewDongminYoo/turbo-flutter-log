# Turbo Flutter Log

Insert, comment, delete and correct Flutter/Dart log statements from the keyboard.

Debug logging in Dart is quick to add and tedious to clean up. This extension writes the statement for you, marks every one it writes, and can comment, delete or correct all of them in a keystroke — without ever touching a log you wrote yourself.

## Commands

| Command                    | macOS | Windows / Linux |
| -------------------------- | ----- | --------------- |
| Display Log Message        | `⌘⌥L` | `Ctrl+Alt+L`    |
| Comment All Log Messages   | `⌥⇧C` | `Alt+Shift+C`   |
| Uncomment All Log Messages | `⌥⇧U` | `Alt+Shift+U`   |
| Delete All Log Messages    | `⌥⇧D` | `Alt+Shift+D`   |
| Correct All Log Messages   | `⌥⇧X` | `Alt+Shift+X`   |

Every command runs on Dart files only, and does not appear in the command palette for anything else.

## What gets inserted

Put the cursor on a variable and press the shortcut:

```dart
final resolvedCurrency = await repository.load();
print('🎯 · [DEBUG] · palette_repository.dart:44 · PaletteRepository.load · resolvedCurrency: $resolvedCurrency');
```

The file, line, and enclosing class and method come from the Dart analysis server, so they are accurate rather than guessed. The line reported is the one holding the logged expression, not the one the log itself landed on.

### It stays on one line

`dart format` wraps at the page width set in `analysis_options.yaml`, defaulting to 80. A log that overflows gets split across three lines, and a split log can no longer be found by the comment and delete commands. So the extension reads your project's width and gives up optional segments until the statement fits — location first, then the level tag, then the class, then the method. What you are logging is never dropped.

```dart
// page_width: 80
print('🎯 · PaletteRepository.load · resolvedCurrency: $resolvedCurrency');

// page_width: 120
print('🎯 · [DEBUG] · palette_repository.dart:44 · PaletteRepository.load · resolvedCurrency: $resolvedCurrency');
```

### It refuses when the cursor is not on a value

Keywords, type names, method names and named-argument labels are not values. Rather than emitting something that will not compile, the extension says there is nothing to log. Resting the caret on `final` or on a type in a declaration logs the variable being declared, which is almost always what you meant.

A log is never widened into a call: selecting `prefs` in `await prefs.reload();` logs `prefs`, not the call — a log must not have side effects.

## Log functions

| Setting           | Emits                                                  | Import added                                                                    |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `print` (default) | `print('…')`                                           | none needed                                                                     |
| `debugPrint`      | `debugPrint('…')`                                      | `package:flutter/foundation.dart`, unless a Flutter library already provides it |
| `developer.log`   | `developer.log('…', name: 'Class.method', level: 500)` | `import 'dart:developer' as developer;`                                         |

`developer.log` carries the enclosing symbol in `name:` and the severity in `level:`, mapped to the `package:logging` constants: `trace` 300, `debug` 500, `info` 800, `warning` 900, `error` 1000, `fatal` 1200.

An alias already used in the file wins over the setting, so an existing `import 'dart:developer' as dev;` gives you `dev.log(…)`.

## Cleaning up

Every inserted log begins with a marker — `🎯` by default — inside its message. The comment, uncomment, delete and correct commands act only on statements carrying it, so a `print()` you wrote by hand is never touched.

Correct re-resolves the file, line and enclosing symbol of every marked log, so they stay accurate after the code around them moves. It keeps the log function, the severity and the expression as they were: a correction fixes positions, it does not restyle.

## Settings

All keys are under `turbo-flutter-log.`.

| Key                        | Default     | Meaning                                                                                      |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `logFunction`              | `print`     | `print`, `debugPrint`, or `developer.log`.                                                   |
| `logLevel`                 | `debug`     | Severity written into the message, and passed as `level:` for `developer.log`.               |
| `marker`                   | `🎯`        | Identifies logs this extension inserted. Must not be empty, or contain `'`, `"`, `\` or `$`. |
| `delimiter`                | `" · "`     | Separator between message segments.                                                          |
| `quote`                    | `'`         | Quote style for the message literal.                                                         |
| `includeFileName`          | `true`      | Include the file name.                                                                       |
| `includeLineNumber`        | `true`      | Append the line number to the file name.                                                     |
| `includeEnclosingClass`    | `true`      | Include the enclosing class name.                                                            |
| `includeEnclosingFunction` | `true`      | Include the enclosing function or method name.                                               |
| `insertEmptyLineBefore`    | `false`     | Blank line before the log.                                                                   |
| `insertEmptyLineAfter`     | `false`     | Blank line after the log.                                                                    |
| `developerLogAlias`        | `developer` | Import prefix for `dart:developer`.                                                          |

Changing `marker` orphans logs already inserted under the old one — they stay in the file but the cleanup commands stop recognising them.

## Requirements

The [Dart extension](https://marketplace.visualstudio.com/items?itemName=Dart-Code.dart-code) is not required, but is strongly recommended: the enclosing class and method, and the check that the cursor is on a value, both come from its analysis server. Without it the extension falls back to text rules, warns once, and leaves the symbol out.

## Known limitations

- `Logger()` from `package:logger` is not supported yet.
- Everything is scoped to the active file; there is no workspace-wide view or cleanup.
- A log placed inside an `if` block only runs when that branch does.

## License

MIT
