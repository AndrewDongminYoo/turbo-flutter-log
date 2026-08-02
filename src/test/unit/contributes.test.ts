import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_CONFIG, type TurboConfig } from '../../config';

/**
 * Defaults are declared twice — in `package.json`, which drives the settings UI,
 * and in `DEFAULT_CONFIG`, which drives behaviour when a value is absent or
 * invalid. Drift between them would show the user one value and apply another,
 * so it is asserted rather than trusted.
 */

const manifest = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'package.json'),
    'utf8',
  ),
) as {
  contributes: {
    configuration: { properties: Record<string, { default: unknown }> };
    commands: { command: string }[];
    keybindings?: { command: string; when?: string }[];
    menus?: { commandPalette?: { command: string; when?: string }[] };
  };
};

const SECTION = 'turbo-flutter-log';
const properties = manifest.contributes.configuration.properties;

suite('package.json contributes', () => {
  test('declares every setting the config module knows about', () => {
    const declared = Object.keys(properties).map((key) =>
      key.replace(`${SECTION}.`, ''),
    );

    assert.deepStrictEqual(
      [...declared].sort(),
      Object.keys(DEFAULT_CONFIG).sort(),
    );
  });

  test('declares the same default as the config module for every setting', () => {
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      assert.strictEqual(
        properties[`${SECTION}.${key}`]?.default,
        value,
        `${key} default differs between package.json and DEFAULT_CONFIG`,
      );
    }
  });

  test('offers exactly the enum values the config module accepts', () => {
    const enums: Partial<Record<keyof TurboConfig, string[]>> = {
      logFunction: ['print', 'debugPrint', 'developer.log'],
      logLevel: ['trace', 'debug', 'info', 'warning', 'error', 'fatal'],
      quote: ["'", '"'],
    };

    for (const [key, expected] of Object.entries(enums)) {
      const declared = (properties[`${SECTION}.${key}`] as { enum?: string[] })
        .enum;
      assert.deepStrictEqual(declared, expected, key);
    }
  });

  test('binds a key to every contributed command', () => {
    const commands = manifest.contributes.commands.map(
      (entry) => entry.command,
    );
    const bound = (manifest.contributes.keybindings ?? []).map(
      (entry) => entry.command,
    );

    assert.deepStrictEqual([...bound].sort(), [...commands].sort());
  });

  test('gates every command on Dart, in the palette and in the keybinding', () => {
    for (const entry of manifest.contributes.keybindings ?? []) {
      assert.ok(
        entry.when?.includes('editorLangId == dart'),
        `keybinding for ${entry.command} is not gated on Dart`,
      );
    }

    const palette = manifest.contributes.menus?.commandPalette ?? [];
    assert.deepStrictEqual(
      palette.map((entry) => entry.command).sort(),
      manifest.contributes.commands.map((entry) => entry.command).sort(),
    );
    for (const entry of palette) {
      assert.strictEqual(entry.when, 'editorLangId == dart', entry.command);
    }
  });
});
