import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Security overrides are declared in `pnpm-workspace.yaml` and resolved through `pnpm-lock.yaml`.
 * This guard requires matching override metadata and verifies the applicable lockfile dependency edges against their own floors.
 * Consumer scopes must not include an unrelated parent's major; native installation and runtime checks verify the on-disk graph separately.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKSPACE = 'pnpm-workspace.yaml';
const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Drops the quotes YAML forces around a scalar that starts with `@`, which is
 * every scoped package name. Both files are normalised the same way so the
 * comparison below cannot fail on one emitter quoting where the other did not.
 */
function unquote(token: string): string {
  return token.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Reads the `overrides:` block of a pnpm YAML file as a selector -> range map.
 *
 * Deliberately throws rather than returning an empty map: a parser that
 * silently misses the block would make every assertion below pass vacuously.
 */
function parseOverrides(text: string, file: string): Record<string, string> {
  // `\r?` so a Windows checkout (core.autocrlf=true) still matches the header.
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('overrides:');
  if (start === -1) {
    throw new Error(`${file} declares no overrides: block`);
  }

  const overrides: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    const entry = /^ {2}(\S+): (\S+)/.exec(line);
    if (!entry) {
      break; // Blank line or an unindented key ends the block.
    }
    overrides[unquote(entry[1])] = unquote(entry[2]);
  }

  if (Object.keys(overrides).length === 0) {
    throw new Error(`${file} has an empty overrides: block`);
  }
  return overrides;
}

function readOverrides(file: string): Record<string, string> {
  return parseOverrides(fs.readFileSync(path.join(ROOT, file), 'utf8'), file);
}

/**
 * Splits `fast-uri@3` into its package name and major selector. A scoped name
 * carries its own leading `@`, so the split anchors on the last one.
 */
type PackageSelector = { name: string; major?: number };

function splitSelector(
  selector: string,
): PackageSelector & { consumer?: PackageSelector } {
  const chain = selector.split('>');
  if (chain.length > 2 || chain.some((part) => part.length === 0)) {
    throw new Error(`${selector} is an unsupported consumer selector`);
  }
  if (chain.length === 2) {
    return { ...splitSelector(chain[1]), consumer: splitSelector(chain[0]) };
  }

  const at = selector.lastIndexOf('@');
  if (at <= 0) {
    return { name: selector };
  }

  const scope = selector.slice(at + 1);
  if (!/^\d+$/.test(scope)) {
    throw new Error(
      `${selector} is not a bare-major selector; this guard only understands ` +
        `"<name>" and "<name>@<major>"`,
    );
  }
  return { name: selector.slice(0, at), major: Number(scope) };
}

/** Parses `^X.Y.Z` into a numeric tuple, throwing on any other range shape. */
function parseCaret(range: string): [number, number, number] {
  const parts = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!parts) {
    throw new Error(
      `override range ${range} is not "^X.Y.Z"; this guard cannot verify it`,
    );
  }
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

/**
 * Asserts one installed version sits inside the window `range` opens.
 *
 * A caret window narrows as its leading zeros accumulate: `^1.2.3` admits any
 * later 1.x, `^0.2.3` is `>=0.2.3 <0.3.0`, and `^0.0.3` is `>=0.0.3 <0.0.4`.
 * The floor alone would pass `0.0.4` against `^0.0.3` — a version the override
 * does not select, so seeing it means the override was never applied.
 *
 * Anything but a plain `X.Y.Z` throws, because the tuple comparison below is
 * blind to a suffix: `3.1.6-beta.1` reduces to `3.1.6` and passes `^3.1.6`,
 * which no stable caret selects.
 */
function assertInsideOverride(
  name: string,
  version: string,
  range: string,
  [floorMajor, floorMinor, floorPatch]: [number, number, number],
): void {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts) {
    throw new Error(
      `${name}@${version} is not a plain X.Y.Z version; this guard cannot ` +
        `verify it against ${range}`,
    );
  }
  const vMajor = Number(parts[1]);
  const vMinor = Number(parts[2]);
  const vPatch = Number(parts[3]);

  assert.strictEqual(
    vMajor,
    floorMajor,
    `${name}@${version} sits outside the ${range} override`,
  );
  // A caret on 0.x is minor-locked, so the floor's minor must match.
  if (floorMajor === 0) {
    assert.strictEqual(
      vMinor,
      floorMinor,
      `${name}@${version} sits outside the ${range} override`,
    );
  }
  assert.ok(
    vMinor > floorMinor || (vMinor === floorMinor && vPatch >= floorPatch),
    `${name}@${version} is below the ${range} override`,
  );
  // Below 0.1.0 the caret is patch-locked too, so the floor is also the cap.
  if (floorMajor === 0 && floorMinor === 0) {
    assert.strictEqual(
      vPatch,
      floorPatch,
      `${name}@${version} sits outside the ${range} override`,
    );
  }
}

/**
 * Lockfile resolutions of `name`, optionally restricted to one consumer's direct edges.
 * Consumer scopes require pnpm v9 snapshots with stable version references and permit peer suffixes.
 * Bare selectors retain the whole-lock behavior.
 */
function installedVersions(
  lock: string,
  name: string,
  consumer?: PackageSelector,
): string[] {
  if (consumer) {
    if (!/^lockfileVersion: (['"]?)9\.0\1[ \t]*\r?$/m.test(lock)) {
      throw new Error('consumer verification requires pnpm lockfile v9');
    }
    const lines = lock.split(/\r?\n/);
    const start = lines.indexOf('snapshots:');
    if (start === -1) {
      throw new Error('consumer verification requires a snapshots: block');
    }

    const versions = new Set<string>();
    const seenSnapshots = new Set<string>();
    let snapshot = '';
    let matches = false;
    let dependencies = false;
    let seenChild = false;
    for (const line of lines.slice(start + 1)) {
      if (!line.trim() || line.trimStart().startsWith('#')) {
        continue;
      }
      if (/^\S/.test(line)) {
        break;
      }
      const header = /^ {2}(\S.*):(?: \{\})?[ \t]*$/.exec(line);
      if (header) {
        snapshot = unquote(header[1]);
        const key = snapshot.split('(')[0];
        const prefix = `${consumer.name}@`;
        matches = key.startsWith(prefix);
        dependencies = false;
        seenChild = false;
        if (matches) {
          const version = key.slice(prefix.length);
          if (!/^\d+\.\d+\.\d+$/.test(version)) {
            throw new Error(`unsupported consumer snapshot ${snapshot}`);
          }
          matches =
            consumer.major === undefined ||
            Number(version.split('.')[0]) === consumer.major;
          if (matches) {
            if (seenSnapshots.has(snapshot)) {
              throw new Error(`repeats consumer snapshot ${snapshot}`);
            }
            seenSnapshots.add(snapshot);
          }
        }
        continue;
      }
      if (!matches) {
        continue;
      }
      if (/^ {4}\S/.test(line)) {
        dependencies = /^ {4}(?:optionalDependencies|dependencies):$/.test(
          line,
        );
      }
      const edge = dependencies ? /^ {6}(\S+): (\S+)/.exec(line) : null;
      if (edge && unquote(edge[1]) === name) {
        if (seenChild) {
          throw new Error(`${snapshot} repeats dependency ${name}`);
        }
        seenChild = true;
        const version = unquote(edge[2]).split('(')[0];
        if (!/^\d+\.\d+\.\d+$/.test(version)) {
          throw new Error(
            `${snapshot} has an unsupported dependency reference for ${name}`,
          );
        }
        versions.add(version);
      }
    }
    return [...versions];
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const keys = new RegExp(
    `^ {2}'?${escaped}@(\\d+\\.\\d+\\.\\d+[^\\s(:']*)['(:]`,
    'gm',
  );
  return [...new Set([...lock.matchAll(keys)].map((match) => match[1]))];
}

function assertResolvedOverride(
  lock: string,
  selector: string,
  range: string,
): void {
  const { name, major, consumer } = splitSelector(selector);
  const [floorMajor, floorMinor, floorPatch] = parseCaret(range);

  const versions = installedVersions(lock, name, consumer);
  assert.ok(
    versions.length > 0,
    `${selector} matches no installed dependency edges for ${name}`,
  );

  const scoped = versions.filter(
    (version) => major === undefined || Number(version.split('.')[0]) === major,
  );
  assert.ok(
    scoped.length > 0,
    `${selector} matches none of the installed ${name} versions: ${versions.join(', ')}`,
  );

  for (const version of scoped) {
    assertInsideOverride(name, version, range, [
      floorMajor,
      floorMinor,
      floorPatch,
    ]);
  }
}

suite('pnpm security overrides', () => {
  test('records every workspace override in the lockfile', () => {
    assert.deepStrictEqual(
      readOverrides(LOCKFILE),
      readOverrides(WORKSPACE),
      `${LOCKFILE} does not match ${WORKSPACE}; run "pnpm install --no-frozen-lockfile"`,
    );
  });

  // Both files are LF and unscoped today, so the two assertions above never
  // reach the shapes that a scoped override or a Windows checkout produces.
  // Fixtures cover them here instead of waiting for the next security override
  // to fail with a message that blames the file for a parser gap.
  test('parses the quoted and CRLF forms pnpm emits', () => {
    const workspace = [
      'allowBuilds:',
      "  '@scope/tool': true",
      '',
      'overrides:',
      "  '@scope/pkg@7': ^7.1.2 # GHSA-0000-0000-0000",
      '  plain-pkg: ^1.2.3',
      '',
      'packages:',
    ].join('\r\n');

    assert.deepStrictEqual(parseOverrides(workspace, 'fixture.yaml'), {
      '@scope/pkg@7': '^7.1.2',
      'plain-pkg': '^1.2.3',
    });
    assert.deepStrictEqual(splitSelector('@scope/pkg@7'), {
      name: '@scope/pkg',
      major: 7,
    });
    assert.deepStrictEqual(splitSelector('@scope/pkg'), { name: '@scope/pkg' });

    const lock = [
      'snapshots:',
      "  '@scope/pkg@7.1.2':",
      "  '@scope/pkg@7.1.2(supports-color@8.1.1)':",
      '  plain-pkg@1.2.3:',
    ].join('\r\n');

    assert.deepStrictEqual(installedVersions(lock, '@scope/pkg'), ['7.1.2']);
    assert.deepStrictEqual(installedVersions(lock, 'plain-pkg'), ['1.2.3']);
  });

  test('parses consumer selectors separately from dependency majors', () => {
    assert.doesNotThrow(() => splitSelector('mocha@11>diff'));
    assert.deepStrictEqual(splitSelector('mocha@11>diff'), {
      name: 'diff',
      consumer: { name: 'mocha', major: 11 },
    });
    assert.deepStrictEqual(splitSelector('@scope/tool@4>@scope/dependency@7'), {
      name: '@scope/dependency',
      major: 7,
      consumer: { name: '@scope/tool', major: 4 },
    });
  });

  test('refuses deeper or empty consumer chains', () => {
    for (const selector of [
      'outer>inner>dependency',
      '>dependency',
      'consumer>',
    ]) {
      assert.throws(
        () => splitSelector(selector),
        /unsupported consumer selector/,
      );
    }
  });

  test('keeps unrelated consumer majors outside an override', () => {
    const lock = [
      "lockfileVersion: '9.0'",
      'snapshots:',
      '  diff@8.0.4: {}',
      '  diff@9.0.0: {}',
      '  mocha@11.8.0:',
      '  # A comment must not end the current snapshot:',
      '    dependencies:',
      '      diff: 8.0.4',
      '  mocha@12.0.3:',
      '    dependencies:',
      '      diff: 9.0.0',
    ].join('\n');

    assert.doesNotThrow(() =>
      assertResolvedOverride(lock, 'mocha@11>diff', '^8.0.4'),
    );
    assert.doesNotThrow(() =>
      assertResolvedOverride(lock, 'mocha@12>diff', '^9.0.0'),
    );
    assert.throws(
      () => assertResolvedOverride(lock, 'mocha@10>diff', '^8.0.4'),
      /matches no installed dependency edges/,
    );
    assert.throws(
      () => assertResolvedOverride(lock, 'mocha@11>missing', '^8.0.4'),
      /matches no installed dependency edges/,
    );
  });

  test('does not let another consumer rescue a vulnerable edge', () => {
    const lock = [
      "lockfileVersion: '9.0'",
      'snapshots:',
      '  diff@7.0.0: {}',
      '  diff@8.0.4: {}',
      '  mocha@11.8.0:',
      '    dependencies:',
      '      diff: 7.0.0',
      '  mocha@12.0.3:',
      '    dependencies:',
      '      diff: 8.0.4',
    ].join('\n');

    assert.throws(
      () => assertResolvedOverride(lock, 'mocha@11>diff', '^8.0.4'),
      /diff@7\.0\.0 sits outside the \^8\.0\.4 override/,
    );
  });

  test('reads scoped consumer peer variants and direct optional edges', () => {
    const lock = [
      "lockfileVersion: '9.0'",
      'snapshots:',
      "  '@scope/dependency@7.1.4': {}",
      "  '@scope/tool@4.2.0(peer@1.0.0)':",
      '    dependencies:',
      "      '@scope/dependency': 7.1.4(peer@1.0.0)",
      "  '@scope/tool@4.2.0(peer@2.0.0)':",
      '    optionalDependencies:',
      "      '@scope/dependency': 7.1.4(peer@2.0.0)",
    ].join('\r\n');

    assert.doesNotThrow(() =>
      assertResolvedOverride(
        lock,
        '@scope/tool@4>@scope/dependency@7',
        '^7.1.4',
      ),
    );
  });

  test('does not read dependency lookalikes outside snapshots', () => {
    const lock = [
      "lockfileVersion: '9.0'",
      'snapshots:',
      '  diff@8.0.4: {}',
      'importers:',
      '  mocha@11.8.0:',
      '    dependencies:',
      '      diff: 8.0.4',
    ].join('\n');

    assert.throws(
      () => assertResolvedOverride(lock, 'mocha@11>diff', '^8.0.4'),
      /matches no installed dependency edges/,
    );
  });

  test('rejects unsupported and ambiguous relevant lock entries', () => {
    const prefix = [
      "lockfileVersion: '9.0'",
      'snapshots:',
      '  mocha@11.8.0:',
      '    dependencies:',
    ].join('\n');

    assert.throws(
      () =>
        assertResolvedOverride(
          `${prefix}\n      diff: npm:other@8.0.4\n`,
          'mocha@11>diff',
          '^8.0.4',
        ),
      /unsupported dependency reference/,
    );
    assert.throws(
      () =>
        assertResolvedOverride(
          `${prefix}\n      diff: 8.0.4\n      diff: 8.0.4\n`,
          'mocha@11>diff',
          '^8.0.4',
        ),
      /repeats dependency/,
    );
    assert.throws(
      () =>
        assertResolvedOverride(
          "lockfileVersion: '8.0'\nsnapshots:\n",
          'mocha@11>diff',
          '^8.0.4',
        ),
      /requires pnpm lockfile v9/,
    );
  });

  // Every live override carries a non-zero major, so the narrower caret
  // windows below 1.0.0 are unreachable from real data. Fixtures pin them
  // here: ^0.2.3 is minor-locked and ^0.0.3 is patch-locked as well, and a
  // lockfile outside either window means the override never took effect.
  test('holds the caret window for 0.x and 0.0.x floors', () => {
    const check = (version: string, range: string): void =>
      assertInsideOverride('pkg', version, range, parseCaret(range));

    assert.doesNotThrow(() => check('1.5.0', '^1.2.3'));
    assert.doesNotThrow(() => check('0.2.9', '^0.2.3'));
    assert.doesNotThrow(() => check('0.0.3', '^0.0.3'));

    assert.throws(
      () => check('0.3.0', '^0.2.3'),
      /pkg@0\.3\.0 sits outside the \^0\.2\.3 override/,
    );
    assert.throws(
      () => check('0.0.4', '^0.0.3'),
      /pkg@0\.0\.4 sits outside the \^0\.0\.3 override/,
    );
    assert.throws(
      () => check('0.0.2', '^0.0.3'),
      /pkg@0\.0\.2 is below the \^0\.0\.3 override/,
    );
  });

  // A prerelease sorts below the release it is named for, so `3.1.6-beta.1`
  // sits outside `^3.1.6` and inside the range the override was meant to
  // close. Comparing numeric fields alone discards the suffix and reads it as
  // `3.1.6`, which passes. Every live override resolves to a plain X.Y.Z
  // today, so a fixture pins the rejection rather than waiting for a lockfile
  // to smuggle one through.
  test('refuses a version it cannot compare as a plain X.Y.Z', () => {
    assert.throws(
      () => assertInsideOverride('pkg', '3.1.6-beta.1', '^3.1.6', [3, 1, 6]),
      /pkg@3\.1\.6-beta\.1 is not a plain X\.Y\.Z version/,
    );
  });

  test('resolves every overridden package at or above its floor', () => {
    const lock = fs.readFileSync(path.join(ROOT, LOCKFILE), 'utf8');

    for (const [selector, range] of Object.entries(readOverrides(WORKSPACE))) {
      assertResolvedOverride(lock, selector, range);
    }
  });
});
