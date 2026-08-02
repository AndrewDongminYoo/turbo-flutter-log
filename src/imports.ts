/**
 * `developer.log` only compiles behind a prefixed `dart:developer` import, so inserting one is part of inserting the log.
 */

const DEVELOPER_IMPORT =
  /^\s*import\s+(['"])dart:developer\1\s*(?:as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/;

const ANY_DIRECTIVE = /^\s*(?:import|export)\s/;

const LIBRARY_OR_PART = /^\s*(?:library|part\s+of)\b/;

export interface ImportPlan {
  /** The prefix the emitted call must use. */
  alias: string;
  /** Zero-based line to insert at, or `undefined` when a usable import is already present. */
  insertAtLine?: number;
  /** The directive to insert, present exactly when `insertAtLine` is. */
  text?: string;
}

/**
 * Decides which prefix to emit and whether a directive has to be added.
 *
 * An existing aliased import wins, whatever its alias: rewriting the user's prefix would be a bigger edit than adopting it.
 *
 * An unaliased `import 'dart:developer';` is left alone and a prefixed one is added alongside.
 * Dart permits importing the same library twice under different prefixes — verified with `dart analyze` on a file doing exactly that — and this keeps the emitted callee uniformly `<alias>.log`, so the detection pattern never has to also match a bare `log(`.
 */
export function planDeveloperImport(
  lines: readonly string[],
  preferredAlias: string,
): ImportPlan {
  let lastDirective = -1;
  let lastHeader = -1;

  for (const [index, line] of lines.entries()) {
    const developer = DEVELOPER_IMPORT.exec(line);
    if (developer?.[2]) {
      return { alias: developer[2] };
    }
    if (ANY_DIRECTIVE.test(line) || developer) {
      lastDirective = index;
    } else if (LIBRARY_OR_PART.test(line)) {
      lastHeader = index;
    }
  }

  const anchor = lastDirective >= 0 ? lastDirective : lastHeader;

  return {
    alias: preferredAlias,
    insertAtLine: anchor + 1,
    text: `import 'dart:developer' as ${preferredAlias};`,
  };
}
