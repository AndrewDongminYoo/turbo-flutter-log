/**
 * The shape of `vscode.DocumentSymbol` this module needs.
 *
 * Declared structurally rather than imported so the walking logic stays free of `vscode` and therefore unit-testable.
 * `vscode.DocumentSymbol` satisfies it: `Range` exposes `start` and `end`, and `Position` exposes `line`.
 */
export interface SymbolNode {
  name: string;
  kind: number;
  range: { start: { line: number }; end: { line: number } };
  children?: SymbolNode[];
}

function contains(node: SymbolNode, line: number): boolean {
  return node.range.start.line <= line && line <= node.range.end.line;
}

/**
 * Returns the symbols containing `line`, outermost first.
 *
 * For a cursor inside `UserBloc.build` the result is `[UserBloc, build]`.
 * An empty array means the position is not inside any symbol, which is normal for a top-level statement or when no symbol provider answered.
 *
 * Where siblings overlap — which the Dart analysis server does not produce, but the type permits — the narrowest is taken, so the result is always the most specific nesting.
 */
export function findEnclosingChain(
  nodes: readonly SymbolNode[] | undefined,
  line: number,
): SymbolNode[] {
  const candidates = (nodes ?? []).filter((node) => contains(node, line));
  if (candidates.length === 0) {
    return [];
  }

  const narrowest = candidates.reduce((best, node) =>
    node.range.end.line - node.range.start.line <
    best.range.end.line - best.range.start.line
      ? node
      : best,
  );

  return [narrowest, ...findEnclosingChain(narrowest.children, line)];
}
