# Quality Tooling Refresh Plan

## Work

1. Verify repository identity, instructions, current changes and Oracle precedent.
2. Refresh compatible dependency and linter versions with existing package managers.
3. Run the declared local gates and `trunk check --all --no-fix`.
4. Reconcile affected knowledge and review the scoped candidate.
5. Commit locally and prepare visible evidence before requesting publication approval.

## Preparation Checkpoint

Dependency metadata was read on 2026-10-28.
Prepare pnpm 11.28.9, the 8.72.1 TypeScript ESLint packages, and a `~6.0.3` TypeScript hold that enforces the parser's `<6.1.0` peer range.
The remaining direct dependencies already match their stable npm dist-tags at this checkpoint.

The current lock resolves direct Mocha 12.0.3 and `@vscode/test-cli`'s Mocha 11.8.0 separately.
Both currently load serialize-javascript 7.1.2, which is affected by GHSA-m5mm-p8h7-m29v; its first patched release is 7.1.3, and the current stable patch is 7.1.4.
Mocha 11 also resolves diff 7.0.0, which is affected by GHSA-73rr-hh4g-fpgx and has no patched 7.x release.
Prepare consumer-specific serialize-javascript 7.1.4 floors for both Mocha majors and diff 8.0.4 for Mocha 11, matching the test CLI's own upstream override.
These changes require actual unit and extension-host verification before acceptance.

Refresh actionlint, OSV Scanner, oxipng, and TruffleHog from the verified linter matrix, and use `eslint@SYSTEM` to read the project's existing plugins and parser.
Keep Pinact at `4.1.1!` with both `lint` and `upgrade` in the allowlist; verify their actual execution rather than inferring effective enablement from an inherited command definition.
The TruffleHog command override disables credential verification and self-update.
Use the independently reviewed local filesystem reader to preserve decoded results, include it in the sandbox and add its exact standard-library CLI test to CI.
Verify 17 reader regressions and actual configured encoded/literal failures plus clean success.

The inherited Taplo disable is pending a direct no-fix check of `osv-scanner.toml`, the repository's tracked TOML target.
No scanner suppression or new ignore has been prepared.
The preparation graph had no consumers for the markdown-it and undici overrides.
The refreshed graph confirmed that absence, so remove both obsolete overrides.

## Resolved Compatibility Findings

The latest Azure Identity `4.14.0` parent still declares MSAL `^6.0.0`, while GHSA-xcx6-jx8p-x3h5 requires MSAL `7.1.0` or newer.
Use the consumer-scoped `7.1.2` override and verify the injected client-secret token path plus public-client construction with outbound networking blocked.
Do not invoke VSCE's environment/CLI/managed-identity credential chain or claim real publishing authentication passed.

The type gate reports an optional `edit.text` argument at the existing indentation assertion.
The installed Node types and original lock both identify `26.6.5`, and the test is unchanged before this repair; do not label this as a proven new dependency regression.
Add only the missing-message fallback, retain its predicate and verify the full unit suite.

The existing override guard accepts only bare selectors and therefore rejects the required consumer-specific keys.
Extend its current test-only parser for one optional consumer and direct pnpm v9 snapshot dependency edges, preserving bare selectors and caret-window checks.
Use fixtures for separate parent majors, scoped names and peers, missing or vulnerable edges, duplicate/unsupported references, comments and snapshot boundaries.
Revert the consumer argument only while keeping the new tests, confirm the unrelated-major regression fails, then restore and rerun it before the full suite.

Taplo `0.10.0` accepts the sole tracked `osv-scanner.toml` target, rejects malformed native/configured controls and accepts the clean configured control.
Restore this linter instead of retaining an unsupported blanket disable.

The original preparation checkpoint stopped before resolution or gates.
Execution now uses the root-owned single heavy-job slot, with actual failures, repairs and remaining gates recorded separately.

## Knowledge Audit

- README command names, shortcuts, settings keys, and defaults correspond to the protected extension manifest; this refresh does not change them.
- No repository-root `AGENTS.md` or `CLAUDE.md` exists, so neither needs a paired correction.
- Both workflows use frozen pnpm installation and Node 24; their pnpm version must match `packageManager`.
- The dated 2026-08-02 plan records historical npm installation and test CLI 0.0.10 decisions.
  The current manifest instead declares pnpm and test CLI 0.0.15; keep that historical account as provenance and use this refresh plan for current tooling decisions.
- Existing product behavior and historical audit findings are outside this maintenance scope.

## Declared Gates

- `pnpm install --frozen-lockfile`
- `pnpm run check-types`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm test`
- `pnpm test --code-version 1.140.0`
- `pnpm run package`
- `pnpm run vsce:package --out <external-temporary-path>/turbo-flutter-log.vsix`
- `pnpm audit --json`
- `pnpm exec trunk check --all --no-fix --jobs=2 --monitor=false`

The frozen install verifies manifest and generated-lock consistency.
The TypeScript and ESLint gates inspect source types and configured lint rules.
Unit tests exercise the direct Mocha 12 runner; the VS Code suite exercises the test CLI's separate Mocha 11 runner and editor behavior.
The package command verifies the production bundle, while VSIX inspection verifies shipped contents and protected manifest fields.
The audit and full Trunk scan inspect the resolved dependency lockfile and repository files; meaningful negative controls must fail before their clean results are trusted.
Run Trunk through pnpm so `eslint@SYSTEM` resolves the repository's executable and plugins.

## Historical Host Verification Checkpoint

The minimum-host undo assertion fails with both the candidate and the original commit's frozen dependency graph.
Increasing only the outer timeout and explicitly focusing the target editor did not restore the synthetic document.
The original graph also reproduces the optional assertion-message type error repaired above.
These observations do not establish that the host failures have the same cause or that the refresh is free of regressions.
This checkpoint blocked publication pending operator approval for further investigation; that approval has since been given.
The stable-host gate was pending at this historical checkpoint.
Temporary diagnostic source changes were restored exactly, and owned profiles, wrappers and the baseline fixture were removed after checking for open handles.

## Resumed host diagnosis

The native window activation request took about 6.8 seconds in the observed minimum-host trace.
After activation, the real code-editor undo path emitted a model Undo event and restored the original source.
Retain a bounded startup allowance in this test, fail explicitly if focus or the Undo event is missing, and verify the two-log transaction on both supported host boundaries.
The repaired test passed the full 12-test host suite on VS Code 1.140.0 and 1.144.0 with two marked logs restored by one undo.
