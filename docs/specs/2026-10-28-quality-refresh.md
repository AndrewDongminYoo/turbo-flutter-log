# Quality Tooling Refresh

## Approved Scope

Refresh supported dependencies and existing quality tooling.
Preserve public APIs, generated artifacts and repository-specific boundaries.
This repository is a TypeScript VS Code extension; no Flutter or Dart SDK maintenance is needed.
Keep the extension version, command and configuration contributions, assets, application source, and VS Code engine requirement `^1.140.0` unchanged.
Permit a diagnostic fallback for the existing unit assertion whose optional message conflicts with the installed Node type overloads; keep its predicate unchanged.
Extend only the existing security override test guard to verify one consumer selector against direct lockfile snapshot edges, with fail-closed fixtures and mutation proof.

## Compatibility

- Keep pnpm on major 11 and align the manifest and workflows with the latest compatible 11.x release.
- Keep TypeScript on 6.0 because `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` 8.72.1 require `>=4.8.4 <6.1.0`.
  The latest compatible 6.0 release is 6.0.3.
- Preserve both test runners: direct Mocha 12 for unit tests and the Mocha 11 dependency resolved by `@vscode/test-cli` for extension-host tests.
- Scope transitive security overrides to their actual consumers and verify both runners after the generated lockfile is refreshed.
- Scope patched MSAL Node `7.1.2` to Azure Identity `4`, whose latest parent still declares MSAL `6`.
  Verify the actual parent API through an injected transport with outbound networking blocked before accepting the major override.
- Run extension-host tests with repository-local or disposable profiles and workspaces, without operator editor settings or real clipboard writes.

## Acceptance

- Pinact remains locked to `4.1.1` with `lint` and `upgrade`.
- The full no-fix Trunk scan and declared project gates pass.
- Trunk uses the repository's ESLint installation and its existing flat configuration.
- TruffleHog runs with `--no-verification --no-update` and a local filesystem SARIF reader that retains decoded findings without exposing secret values.
- The sandbox includes this reader through `direct_configs`, and CI runs its 17 standalone regression tests.
- Assess the inherited Taplo disable against the actual TOML target before deciding whether it remains justified.
- Changed manifests have package-manager-generated lockfiles under repository policy.
- Advisory dispositions have specific evidence and affected knowledge claims are reconciled.
- Run the existing extension-host suite against VS Code 1.140.0 and the default stable host, then produce a production bundle and a VSIX outside the checkout.

## Sources

- [typescript-eslint compatibility](https://typescript-eslint.io/users/dependency-versions/)
- [pnpm override configuration](https://pnpm.io/settings#overrides)
- [serialize-javascript advisory GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v)
- [diff advisory GHSA-73rr-hh4g-fpgx](https://github.com/advisories/GHSA-73rr-hh4g-fpgx)
- [MSAL Node advisory GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5)

Oracle retrieval for the personal `turbo-flutter-log` project returned `[no precedent found]` for extension-host Mocha compatibility and isolation.
The bounded Azure Identity/MSAL retrieval and one lexical retry also returned `[no precedent found]`.
Those retrievals reported source commit `9670d54de3076c5239713f54900c7a855bd18478` with unverified freshness and no project-specific source path.
A later account-neutral guard lookup returned `wiki/sources/claude--rules--scoped-dependency-overrides.md` and `raw/sources/.claude/rules/scoped-dependency-overrides.md` at the same source commit.
That historical rule was folded into dependency-vulnerability guidance; it confirms consumer-edge checks and separate major floors rather than a blanket highest version.
Treat the archived source as precedent, while current operator instructions and the actual resolved graph govern this repair.
Use the current manifest, installed runner, resolved graph, and actual extension-host results as evidence.

## Publication

Push and PR creation require explicit repository-specific approval.
After approval, continue the requested hosted gates, merge, cleanup and memory recording.

## Source-context verification

The filesystem reader has 17 standard-library regressions.
Each source read is capped at 1 MiB plus a sentinel byte; the cache retains eight source files.
Total JSONL input, result count, offset records, process memory and read time are not bounded by those limits.
Trunk uses `--monitor=false`, including hooks, and each one-off daemon is stopped from its exact checkout.

## Approved host-test repair

The operator approved investigation and repair of the baseline-existing macOS undo failure.
The undo test activates the native host window before dispatch, waits for focus and observes a document event with reason Undo.
The startup wait has a 30-second test budget; an undo event still has its own two-second failure deadline.
Two marked log statements must be deleted and restored exactly by a single undo while preserving the handwritten log.
Application command behavior and public API remain unchanged.
