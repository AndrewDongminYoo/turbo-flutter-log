import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Security overrides are declared in `pnpm-workspace.yaml` but only take effect
 * once `pnpm install` copies them into `pnpm-lock.yaml` and re-resolves the
 * tree. pnpm fails softly here: an override it does not read, or a lockfile
 * that was never regenerated, still produces a clean install exit code while
 * the vulnerable version stays on disk. This asserts the two files agree and
 * that every installed version inside an override's major clears its floor.
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
function splitSelector(selector: string): { name: string; major?: number } {
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
 * Every version of `name` that the lockfile resolved, peer suffixes ignored.
 *
 * Lockfile v9 quotes any key that starts with `@`, so a scoped entry reads
 * `  '@scope/name@1.2.3':` and the closing quote is what follows the version.
 */
function installedVersions(lock: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const keys = new RegExp(
    `^ {2}'?${escaped}@(\\d+\\.\\d+\\.\\d+[^\\s(:']*)['(:]`,
    'gm',
  );
  return [...new Set([...lock.matchAll(keys)].map((match) => match[1]))];
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

  test('resolves every overridden package at or above its floor', () => {
    const lock = fs.readFileSync(path.join(ROOT, LOCKFILE), 'utf8');

    for (const [selector, range] of Object.entries(readOverrides(WORKSPACE))) {
      const { name, major } = splitSelector(selector);
      const [floorMajor, floorMinor, floorPatch] = parseCaret(range);

      const versions = installedVersions(lock, name);
      assert.ok(
        versions.length > 0,
        `${selector} overrides ${name}, which the lockfile never resolves`,
      );

      const scoped = versions.filter(
        (version) =>
          major === undefined || Number(version.split('.')[0]) === major,
      );
      assert.ok(
        scoped.length > 0,
        `${selector} matches none of the installed ${name} versions: ${versions.join(', ')}`,
      );

      for (const version of scoped) {
        const [vMajor, vMinor, vPatch] = version
          .split('.')
          .map((part) => Number.parseInt(part, 10));

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
          vMinor > floorMinor ||
            (vMinor === floorMinor && vPatch >= floorPatch),
          `${name}@${version} is below the ${range} override`,
        );
      }
    }
  });
});
