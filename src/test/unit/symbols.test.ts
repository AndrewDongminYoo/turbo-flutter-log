import * as assert from 'assert';

import { findEnclosingChain, type SymbolNode } from '../../symbols';

function node(
  name: string,
  kind: number,
  startLine: number,
  endLine: number,
  children: SymbolNode[] = [],
): SymbolNode {
  return {
    name,
    kind,
    range: { start: { line: startLine }, end: { line: endLine } },
    children,
  };
}

/**
 * Mirrors the outline a running `dart language-server` returned for the probe
 * fixture, so the walk is tested against a real shape rather than an invented one.
 */
const OUTLINE: SymbolNode[] = [
  node('UserBloc', 5, 0, 11, [
    node('m', 8, 1, 1),
    node('build', 6, 3, 6),
    node('_helper', 6, 8, 10),
  ]),
  node('Profile', 5, 13, 15, [node('name', 8, 14, 14)]),
  node('topLevel', 12, 21, 23),
];

suite('findEnclosingChain', () => {
  test('returns class then method for a cursor in a method body', () => {
    assert.deepStrictEqual(
      findEnclosingChain(OUTLINE, 4).map((symbol) => symbol.name),
      ['UserBloc', 'build'],
    );
  });

  test('distinguishes sibling methods', () => {
    assert.deepStrictEqual(
      findEnclosingChain(OUTLINE, 9).map((symbol) => symbol.name),
      ['UserBloc', '_helper'],
    );
  });

  test('returns the class alone between its members', () => {
    assert.deepStrictEqual(
      findEnclosingChain(OUTLINE, 7).map((symbol) => symbol.name),
      ['UserBloc'],
    );
  });

  test('returns a bare top-level function', () => {
    assert.deepStrictEqual(
      findEnclosingChain(OUTLINE, 22).map((symbol) => symbol.name),
      ['topLevel'],
    );
  });

  test('returns nothing outside every symbol', () => {
    assert.deepStrictEqual(findEnclosingChain(OUTLINE, 12), []);
  });

  test('returns nothing when no provider answered', () => {
    assert.deepStrictEqual(findEnclosingChain(undefined, 4), []);
  });

  test('prefers the narrowest of overlapping siblings', () => {
    const overlapping = [node('wide', 5, 0, 20), node('narrow', 5, 2, 4)];
    assert.deepStrictEqual(
      findEnclosingChain(overlapping, 3).map((symbol) => symbol.name),
      ['narrow'],
    );
  });
});
