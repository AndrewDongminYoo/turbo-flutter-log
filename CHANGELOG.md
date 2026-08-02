# Change Log

All notable changes to Turbo Flutter Log are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-02

First working release. The `0.0.1` scaffold was never published; three of its four commands had never worked, so everything below is effectively new.

### Added

- **Correct All Log Messages** (`⌥⇧X`) re-resolves the file, line and enclosing symbol of every inserted log, keeping them accurate after the surrounding code moves.
- Keybindings for all five commands, each gated on Dart files.
- `developer.log` and `debugPrint` alongside `print`, with the required import added automatically. An import alias already used in the file is adopted rather than rewritten.
- A configurable marker, `🎯` by default, written into every inserted log. The comment, uncomment, delete and correct commands act only on statements carrying it, so hand-written logs are never touched.
- The enclosing class and method, resolved from the Dart analysis server rather than guessed.
- Nine further settings: marker, delimiter, quote style, file name, line number, enclosing class, enclosing function, blank lines before and after, and the `dart:developer` alias.
- Logs are kept on one line by reading `formatter.page_width` from `analysis_options.yaml` and dropping optional segments until the statement fits. An overflowing log would be split by `dart format`, and a split log cannot be found by the cleanup commands.

### Changed

- `logFunction` is now an enum rather than a free-form string; the old form could not express `developer.log`'s call shape. The default is `print`, the only one of the three needing no import.
- Insertion handles multiple cursors, inherits the surrounding indentation, and places the log after the end of the statement it reports rather than blindly on the next line.
- Bulk commands edit only the lines they match. The previous whole-document replacement collapsed undo to a single step and reset cursor, selection and folding state.
- The reported line is the one holding the logged expression, not the one the log itself landed on.

### Fixed

- The comment, uncomment and delete commands never matched anything: their patterns had been corrupted into an end-of-input anchor.
- Commands no longer run on files that are not Dart.
- No insert-time timestamp is written into the message. It was fixed at the moment of insertion, so it never described when the log ran.
- Logs are no longer inserted where a statement cannot go — inside a parameter list, a multi-line statement's argument list, or a `switch` expression's arms.
- A log is never widened into a call or an `await`, which would make it invoke the code it reports.
- Keywords, type names, method names and named-argument labels are recognised as not being values, and produce no log rather than something that will not compile.

[unreleased]: https://github.com/AndrewDongminYoo/turbo-flutter-log/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AndrewDongminYoo/turbo-flutter-log/releases/tag/v0.1.0
