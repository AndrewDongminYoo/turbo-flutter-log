/**
 * Classifies what the cursor is on by asking the Dart analysis server, instead of guessing from
 * text.
 *
 * The analyzer already knows whether a position is a variable, a type, or a keyword, and it is
 * running whenever anyone is writing Dart. Every rule here was derived from hover responses captured
 * from a live `dart language-server`, listed in the tests.
 */

export type HoverKind =
  /** A variable, field, or parameter — something that can be interpolated. */
  | 'value'
  /** A class, enum, mixin, extension, or typedef name. */
  | 'type'
  /** The name half of a named argument, as in `dismissible: false`. */
  | 'named-argument'
  /** A keyword or anything else the analyzer does not describe as a declaration. */
  | 'not-a-value'
  /** No usable answer — the analyzer may still be starting, so the caller falls back. */
  | 'unknown';

const TYPE_DECLARATION =
  /^(?:abstract\s+|base\s+|final\s+|interface\s+|sealed\s+)*(?:class|enum|mixin|extension|typedef)\b/;

/**
 * Pulls the first fenced code block out of hover markdown.
 *
 * Dart's hover puts the declaration in a ```dart block and any doc comment after it, so the block
 * alone is the part worth classifying.
 */
export function firstCodeBlock(markdown: string): string {
  const fenced = /```(?:dart)?\n([\s\S]*?)```/.exec(markdown);
  const body = fenced?.[1] ?? markdown;

  return body.trim().split('\n')[0]?.trim() ?? '';
}

/**
 * Decides whether the thing under the cursor can be logged.
 *
 * Returns `unknown` rather than a guess whenever the shape is unfamiliar, so the caller keeps a
 * text-based fallback for it.
 *
 * The window while the analysis server is starting is *not* this function's job: the caller only
 * asks for a hover once the selection-range provider has answered, so an empty answer here means the
 * analyzer looked and found nothing — a keyword — rather than that nobody was listening.
 */
export function classifyHover(
  markdown: string | undefined,
  word: string,
): HoverKind {
  if (markdown === undefined) {
    // Nothing answered at all, which is different from answering with nothing.
    return 'unknown';
  }
  if (markdown.trim().length === 0) {
    // The analyzer answered and had nothing to say: keywords such as `final`
    // and `const` have no hover.
    return 'not-a-value';
  }

  const declaration = firstCodeBlock(markdown);
  if (declaration.length === 0) {
    return 'not-a-value';
  }
  if (TYPE_DECLARATION.test(declaration)) {
    return 'type';
  }
  if (declaration.startsWith('{')) {
    // `{required bool dismissible}` — the analyzer describes the parameter, but
    // at a call site the word is the argument's name, not a value in scope.
    return 'named-argument';
  }
  if (declaration === word) {
    // `dynamic` and `void` hover as just themselves: a type, not a declaration.
    return 'not-a-value';
  }

  // `Future<void> reload()` is a method. A bare `reload` is not in scope, and
  // climbing to `prefs.reload()` would call it again — logging must not have
  // side effects — so a callable is never a value here.
  const signature = declaration.split('(')[0];
  if (
    declaration.length > signature.length &&
    signature.trimEnd().endsWith(word)
  ) {
    return 'not-a-value';
  }

  // `Object finalObj`, `Sheet? sheet`, `String name`, `dynamic variable` — the
  // declared name comes last, so a declaration of this word is a value.
  const names = signature.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];

  if (names.length >= 2 && names[names.length - 1] === word) {
    return 'value';
  }

  return 'unknown';
}
