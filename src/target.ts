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
 * Words Dart refuses as a variable name at all, so interpolating one can never compile — `$final`
 * being the case that surfaced this.
 *
 * Membership was decided by running `var <word> = 1; print('$<word>');` through `dart analyze`
 * rather than read off the keyword table, because the table's two categories do not line up with
 * this question.
 *
 * `this` is deliberately absent: it is a reserved word but also a perfectly good thing to log.
 * `await` is present although a *synchronous* function accepts it as a name, because the analyzer
 * rejects it inside an `async` one and guessing wrong there breaks the file.
 */
const RESERVED = new Set([
  'assert',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'enum',
  'extends',
  'false',
  'final',
  'finally',
  'for',
  'if',
  'in',
  'is',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'throw',
  'true',
  'try',
  'var',
  'void',
  'while',
]);

/**
 * Dart's built-in identifiers: legal variable names that nonetheless usually appear as modifiers.
 *
 * The distinction is *who chose the word*. Guessing from a caret, one of these is far more likely to
 * be the `external` in a declaration than a variable — so the guess declines. Where the position
 * already proves a variable, such as the left of an assignment or a selection the user made
 * deliberately, `final type = response.contentType;` must stay loggable.
 *
 * The contextual keywords — `hide`, `of`, `on`, `sealed`, `show`, `sync`, `when`, `yield` — are
 * absent from both sets: they read as ordinary names and may well be real variables.
 */
const BUILT_IN = new Set([
  'abstract',
  'as',
  'async',
  'covariant',
  'dynamic',
  'export',
  'extension',
  'external',
  'factory',
  'Function',
  'get',
  'implements',
  'import',
  'interface',
  'late',
  'library',
  'mixin',
  'operator',
  'part',
  'required',
  'set',
  'static',
  'type',
  'typedef',
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * True when `word` is worth interpolating on the strength of the caret resting on it.
 *
 * Stricter than {@link isLoggableName}: this is a guess, so a built-in identifier is declined.
 */
export function isLoggableIdentifier(word: string): boolean {
  return IDENTIFIER.test(word) && !RESERVED.has(word) && !BUILT_IN.has(word);
}

/**
 * True when `word` can be interpolated as a value, given that something else already established it
 * is one — an assignment target, or a name the user selected.
 */
export function isLoggableName(word: string): boolean {
  return IDENTIFIER.test(word) && !RESERVED.has(word);
}

/**
 * Keywords that introduce a variable, and so hint at what the user meant when the caret rests on one.
 * Any other keyword under the cursor is simply not a place a log belongs.
 */
const DECLARATION_MODIFIERS = new Set([
  'final',
  'const',
  'var',
  'late',
  'static',
]);

export function isDeclarationModifier(word: string): boolean {
  return DECLARATION_MODIFIERS.has(word);
}

/**
 * Recovers the variable a statement assigns to.
 *
 * Covers every shape the left of an assignment takes — a modifier, a type, a generic type, a
 * nullable type, or nothing at all:
 *
 * ```dart
 * final resolvedCurrency = await repository.load();
 * Sheet? sheet = await pop<Sheet>(context);
 * dynamic variable = someFunction();
 * Map<String, dynamic> map = <String, dynamic>{};
 * variable = anotherFunction();
 * ```
 *
 * Returns `undefined` when the statement assigns to nothing.
 */
export function declaredNameIn(statement: string): string | undefined {
  const match = /([A-Za-z_][A-Za-z0-9_.]*)\s*=(?!=)/.exec(statement);
  const name = match?.[1];

  return name !== undefined && isLoggableExpression(name) ? name : undefined;
}

/**
 * The offset of the assignment `=` at bracket depth zero, or `-1`.
 *
 * Everything to its left is the declaration's prefix — modifiers, a type, generic arguments — and
 * none of it is a value. A cursor there means the variable being assigned, not the type name it
 * happens to be sitting on: `$Sheet` compiles but logs the string "Sheet", which is never what
 * anyone wanted.
 */
export function assignmentIndex(text: string): number {
  let depth = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
    } else if (
      depth === 0 &&
      char === '=' &&
      text[i + 1] !== '=' &&
      text[i + 1] !== '>' &&
      !['=', '!', '<', '>'].includes(text[i - 1] ?? '')
    ) {
      return i;
    }
  }

  return -1;
}

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

    if (char === ',' || char === ':') {
      // A top-level comma or colon means this is not one value: it is a named
      // argument (`dismissible: false,`), a map entry, or an argument list.
      return true;
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
 * True when `text` is a declaration rather than an expression — a type followed by a name.
 *
 * A cursor in a signature such as `build(BuildContext context)` makes the analysis server return
 * the whole formal parameter as the innermost range, and `${BuildContext context}` does not compile.
 *
 * Two identifier runs separated only by whitespace is the signature of a declaration. Expressions
 * put an operator between their operands, with the exception of the few prefix keywords listed here.
 */
export function isDeclaration(text: string): boolean {
  const trimmed = text.trim();

  if (/^(?:await|new|const|return|throw|yield)\s/.test(trimmed)) {
    return false;
  }

  return /^[A-Za-z_][A-Za-z0-9_<>,?[\]. ]*\s+[A-Za-z_][A-Za-z0-9_]*$/.test(
    trimmed,
  );
}

/**
 * True when `text` can stand on its own as a Dart expression, so it may be interpolated.
 *
 * Laxer than {@link hasTopLevelStop}, which picks the *best* expression from a chain of candidates.
 * A deliberate selection may be any expression, `a + b` included — the user said what they meant.
 * What it may not be is a fragment or a keyword: selecting `final` out of `finalObj` yields `$final`,
 * which does not compile.
 */
export function isLoggableExpression(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length === 0 || trimmed.includes('\n')) {
    return false;
  }
  if (IDENTIFIER.test(trimmed)) {
    return isLoggableName(trimmed);
  }
  // A dangling operator, separator or opening bracket means the selection cut a
  // token in half.
  if (/[,;:.+\-*/%&|^<>=!?([{]$/.test(trimmed)) {
    return false;
  }
  if (/^[,;:.*/%&|^>=?)\]}]/.test(trimmed)) {
    return false;
  }
  if (assignmentIndex(trimmed) >= 0) {
    return false;
  }

  let depth = 0;
  for (const char of trimmed) {
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    } else if (depth === 0 && (char === ',' || char === ':' || char === ';')) {
      // More than one thing, or a name/value pair — not a single expression.
      return false;
    }
  }

  return depth === 0;
}

/**
 * Picks the expression to log from an innermost-first chain of range texts.
 *
 * Climbs while the parent merely extends the current text — a member chain such as `user` → `user.profile`, or an index such as `m` → `m['k']` — and stops as soon as the parent introduces an assignment, a terminator, or a top-level operator.
 *
 * A parent that wraps rather than extends, such as `user` → `(user)` inside `print(user)`, ends the walk: the argument is what the user meant, not the call.
 */
export function chooseExpression(chain: readonly string[]): string {
  const seed = chain[0] ?? '';

  // The innermost range is not always a value reference. Dart hands back the
  // whole declarator for a cursor on the declared name — `name = session.user.name`
  // — the whole multi-line statement when the cursor sits on a name inside one,
  // and the whole formal parameter for a cursor in a signature. Logging any of
  // them produces invalid Dart, so the chain yields nothing and the caller falls
  // back to the word under the cursor.
  if (seed.includes('\n') || hasTopLevelStop(seed) || isDeclaration(seed)) {
    return '';
  }

  let candidate = seed;

  for (const parent of chain.slice(1)) {
    if (parent.includes('\n') || hasTopLevelStop(parent)) {
      break;
    }

    // Never climb into a call. `prefs` → `prefs.reload` → `prefs.reload()`
    // would make the log invoke the method, and a log must not have side
    // effects. `await` is excluded for the same reason.
    const suffix = parent.startsWith(candidate)
      ? parent.slice(candidate.length).trimStart()
      : '';
    if (suffix.startsWith('(') || /^await\b/.test(parent.trim())) {
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
 * Constructs whose parenthesised part is an expression evaluated *outside* the braces that follow.
 *
 * `switch` matters most: in `return switch (value) { … };` the braces hold case arms, not
 * statements, so putting a log inside them does not compile. The others are excluded because their
 * subject is visible after the whole statement anyway, which is the simpler place for it.
 *
 * `for` and `catch` are deliberately absent — they bind names that exist only inside the block, so
 * a log for one of those names does belong there.
 */
const NOT_A_PARAMETER_LIST = /\b(?:switch|if|while|do|assert)\s*$/;

/** Where a closure body opens, as an offset from the start of the range it was found in. */
export interface BlockOpening {
  /** Lines from the start of the text to the one holding the `{`. */
  lineOffset: number;
}

/**
 * Finds the body of the closure whose parameter list the cursor is inside, given the cursor's
 * immediate parent range and its grandparent.
 *
 * A closure parameter has no statement of its own: for `builder: (context) { … }` the nearest
 * ancestor ending in `;` is the *outer* call, so a log for `context` would land after that call and
 * name something out of scope. The body is where it belongs.
 *
 * Recognised only for the anonymous-function shape — a parenthesised list directly followed by `{`,
 * `async {`, or `=>` — and only when the text before the list is not a control keyword. Everything
 * else, including collection literals and switch expressions, is left alone.
 */
export function closureBodyOpening(
  parent: string | undefined,
  grandparent: string | undefined,
): BlockOpening | undefined {
  if (parent === undefined || grandparent === undefined) {
    return undefined;
  }
  if (!/^\([\s\S]*\)$/.test(parent.trim())) {
    return undefined;
  }

  const at = grandparent.indexOf(parent);
  if (at === -1) {
    return undefined;
  }
  if (NOT_A_PARAMETER_LIST.test(grandparent.slice(0, at))) {
    return undefined;
  }

  const after = grandparent.slice(at + parent.length);
  const body = /^\s*(?:async\s*\*?\s*|sync\s*\*\s*)?\{/.exec(after);
  if (!body) {
    return undefined;
  }

  const before = grandparent.slice(0, at + parent.length + body[0].length - 1);

  return { lineOffset: before.split('\n').length - 1 };
}

/**
 * Finds the line that opens the body the cursor's declaration belongs to, scanning downwards.
 *
 * Needed when nothing in the range chain ends a statement, which happens when the cursor is in a
 * signature. A parameter list has no statement of its own, and inserting after the cursor's line
 * puts a statement *inside the parameter list* — the file stops compiling.
 *
 * The scan gives up as soon as it sees a line that ends a statement or closes a block, so it only
 * ever crosses continuation lines of the signature it started in. Returning `undefined` means the
 * caller has nowhere safe to put a log and should insert nothing at all.
 *
 * Only a `;` outside every bracket ends a statement. A C-style `for` header carries two inside its
 * parentheses, and treating those as terminators made a cursor on the loop variable resolve to
 * nowhere at all.
 */
export function bodyOpeningAfter(
  lines: readonly string[],
  from: number,
  limit = 24,
): number | undefined {
  // The scan may start part-way through a signature, so depth can go negative;
  // everything at or below zero counts as outside.
  let depth = 0;

  for (let line = from; line < lines.length && line < from + limit; line += 1) {
    const text = lines[line];

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (char === '(' || char === '[') {
        depth += 1;
      } else if (char === ')' || char === ']') {
        depth -= 1;
      } else if (char === ';' && depth <= 0) {
        // A statement ended before any body opened: nowhere safe to insert.
        return undefined;
      } else if (char === '{' && depth <= 0 && opensABody(text, index)) {
        return line;
      }
    }
  }

  return undefined;
}

/**
 * Distinguishes the brace that opens a body from the two that do not.
 *
 * A signature can hold all three within a few lines:
 *
 * ```dart
 * Future<void> recordError(
 *   StackTrace? stack, {                      // named parameter group
 *   Map<String, Object?> context = const {},  // map literal
 * }) async {                                  // the body
 * ```
 *
 * What separates them is the token in front. A body follows the closing `)` of its parameter list,
 * or an asynchrony modifier, or a block keyword. A parameter group follows `,` or `(`, and a
 * collection literal follows `=`, `const`, or a type argument list.
 */
function opensABody(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();

  return (
    before.endsWith(')') ||
    /\b(?:async\s*\*?|sync\s*\*|else|try|finally|do)$/.test(before)
  );
}

/**
 * Picks the enclosing statement from the same chain, so the caller knows which line the log goes after.
 *
 * Multi-line statements count, and must: a statement such as
 *
 * ```dart
 * final result = await fetch<String>(
 *   'key',
 * );
 * ```
 *
 * arrives as one range spanning three lines, and the log belongs after its last line.
 * Restricting this to single-line ancestors put the log inside the argument list and broke the file.
 *
 * Returns `undefined` only when nothing in the chain ends a statement, and the caller then falls back to the cursor's own line.
 */
export function chooseStatementText(
  chain: readonly string[],
): string | undefined {
  return chain.find((text) => text.trimEnd().endsWith(';'));
}
