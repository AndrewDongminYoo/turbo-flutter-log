/**
 * Chooses what to log from the nested ranges the Dart analysis server returns for a cursor position.
 *
 * `textDocument/selectionRange` gives an innermost-first chain. For a cursor on `user` in
 * `final name = user.profile.name;` that chain is:
 *
 * ```plaintext
 * user → user.profile → user.profile.name → name = user.profile.name → final name = ... → ...;
 * ```
 *
 * The useful expression is the widest link that is still a value reference, which is the third here.
 * Every rule below was derived from chains captured from a running `dart language-server`, not from guesswork.
 */

/** A literal is never worth logging on its own, so the walk climbs past one unconditionally. */
const LITERAL = /^(['"`]|[0-9])/;

/**
 * True when `text` contains, outside any bracket, something that means the expression has stopped being a single value reference.
 *
 * Assignment and statement terminators end the expression.
 * A top-level binary operator does too: for `compute(p) + 1` the useful expression is `compute(p)`, not the sum.
 * `=>`, `==`, `!=`, `<=` and `>=` are not assignments and must not trigger on their `=`.
 */
export function hasTopLevelStop(text: string): boolean {
  let depth = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    const previous = text[i - 1];

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }
    if (depth > 0) {
      continue;
    }

    if (char === ';' || char === '=') {
      // Assignment, comparison and arrow all end the walk. Distinguishing them
      // would cost a branch and change nothing: for `a == b` the useful
      // expression is an operand, exactly as it is for `compute(p) + 1`.
      return true;
    }
    if ('+-*/%<>&|?'.includes(char)) {
      // `?.`, `??` and `!` are part of a value reference; a spaced operator is not.
      const isNavigation =
        (char === '?' && (next === '.' || next === '?')) ||
        (char === '?' && previous === '?');
      if (!isNavigation && (previous === ' ' || next === ' ')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Picks the expression to log from an innermost-first chain of range texts.
 *
 * Climbs while the parent merely extends the current text — a member chain such as `user` → `user.profile`, or an index such as `m` → `m['k']` — and stops as soon as the parent introduces an assignment, a terminator, or a top-level operator.
 *
 * A parent that wraps rather than extends, such as `user` → `(user)` inside `print(user)`, ends the walk: the argument is what the user meant, not the call.
 */
export function chooseExpression(chain: readonly string[]): string {
  let candidate = chain[0] ?? '';

  for (const parent of chain.slice(1)) {
    if (parent.includes('\n') || hasTopLevelStop(parent)) {
      break;
    }

    const extendsCandidate =
      parent.startsWith(candidate) || parent.endsWith(candidate);
    const climbsPastLiteral =
      LITERAL.test(candidate) && parent.includes(candidate);

    if (!extendsCandidate && !climbsPastLiteral) {
      break;
    }

    candidate = parent;
  }

  return candidate;
}

/**
 * Picks the enclosing statement from the same chain, so the caller knows which line the log goes after.
 *
 * Returns `undefined` when no single-line ancestor ends the statement — a multi-line statement, or a cursor outside one — and the caller falls back to the cursor's own line.
 */
export function chooseStatementText(
  chain: readonly string[],
): string | undefined {
  return chain.find(
    (text) => !text.includes('\n') && text.trimEnd().endsWith(';'),
  );
}
