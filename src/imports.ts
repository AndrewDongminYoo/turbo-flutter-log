import type { LogFunction } from './config';

/**
 * Two of the three log functions only compile behind an import, so adding one is part of inserting the log.
 *
 * `print` is `dart:core` and needs nothing.
 * `debugPrint` needs `package:flutter/foundation.dart`, or any Flutter library that re-exports it.
 * `developer.log` needs a prefixed `dart:developer`.
 */

const DEVELOPER_IMPORT =
  /^\s*import\s+(['"])dart:developer\1\s*(?:as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/;

const ANY_DIRECTIVE = /^\s*(?:import|export)\s/;

const LIBRARY_OR_PART = /^\s*(?:library|part\s+of)\b/;

/**
 * Libraries that make `debugPrint` visible.
 *
 * `foundation.dart` declares it; `widgets.dart` re-exports it via `src/widgets/framework.dart`, which carries
 * `export 'package:flutter/foundation.dart' show ..., debugPrint, debugPrintStack;`,
 * and `material.dart` and `cupertino.dart` both re-export `widgets.dart`.
 * Read from the Flutter SDK rather than assumed — a `show` clause elsewhere in the same file exposes only `Brightness` and `UniqueKey`, which is easy to mistake for the whole story.
 */
const DEBUG_PRINT_SOURCES = [
  'package:flutter/foundation.dart',
  'package:flutter/widgets.dart',
  'package:flutter/material.dart',
  'package:flutter/cupertino.dart',
];

export interface ImportPlan {
  /** Prefix the emitted call must use. Empty for an unprefixed import. */
  alias: string;
  /** Zero-based line to insert at, or `undefined` when nothing needs adding. */
  insertAtLine?: number;
  /** The directive to insert, present exactly when `insertAtLine` is. */
  text?: string;
}

/** Where a new directive belongs: after the last one, else after a library header, else at the top. */
function anchorFor(lines: readonly string[]): number {
  let lastDirective = -1;
  let lastHeader = -1;

  for (const [index, line] of lines.entries()) {
    if (ANY_DIRECTIVE.test(line)) {
      lastDirective = index;
    } else if (LIBRARY_OR_PART.test(line)) {
      lastHeader = index;
    }
  }

  return (lastDirective >= 0 ? lastDirective : lastHeader) + 1;
}

/**
 * Decides which prefix to emit and whether a directive has to be added.
 *
 * For `developer.log` an existing aliased import wins, whatever its alias: adopting the user's prefix is a smaller edit than rewriting it.
 * An unaliased `import 'dart:developer';` gets a prefixed one added alongside — Dart permits importing a library twice under different prefixes, verified with `dart analyze` — which keeps the emitted callee uniformly `<alias>.log` so the detection pattern never has to also match a bare `log(`.
 */
export function planImport(
  lines: readonly string[],
  logFunction: LogFunction,
  preferredAlias: string,
): ImportPlan {
  if (logFunction === 'print') {
    return { alias: preferredAlias };
  }

  if (logFunction === 'debugPrint') {
    const satisfied = lines.some(
      (line) =>
        ANY_DIRECTIVE.test(line) &&
        DEBUG_PRINT_SOURCES.some((source) => line.includes(source)),
    );

    return satisfied
      ? { alias: preferredAlias }
      : {
          alias: preferredAlias,
          insertAtLine: anchorFor(lines),
          text: `import 'package:flutter/foundation.dart';`,
        };
  }

  for (const line of lines) {
    const developer = DEVELOPER_IMPORT.exec(line);
    if (developer?.[2]) {
      return { alias: developer[2] };
    }
  }

  return {
    alias: preferredAlias,
    insertAtLine: anchorFor(lines),
    text: `import 'dart:developer' as ${preferredAlias};`,
  };
}
