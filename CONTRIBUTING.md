# Contributing

Thanks for helping improve dsh-capability-panel! [中文](CONTRIBUTING.zh.md)

## Reporting issues

Please include:

- dsh version (`dsh --version`) and OS
- What the panel showed vs. what you expected (a screenshot helps)
- Any `degraded` notes shown in the panel — they are the plugin's own diagnostics

## Development setup

```bash
pnpm install --frozen-lockfile
pnpm check          # typecheck + type-aware lint + tests — must be green
pnpm test:coverage  # 100% coverage gates on src/** — do not lower them
pnpm scan:dead-code # advisory dead-code report (read before deleting, never a gate)
```

Host-half changes need a dsh restart; the client half hot-swaps while `dsh web` and `pnpm dev` run together.

## Conventions that will bite you if missed

- **Bilingual-plus docs**: `README.md`, `README.zh.md`, `README.ja.md`, and `README.ko.md` carry equal authority. Edit all four together, then re-record the consistency hashes: `git hash-object README.md README.zh.md README.ja.md README.ko.md` into `README.i18n.yaml`.
- **Locale parity**: `src/client/locale.ts` zh/en dictionaries must keep identical key sets (pinned by a test).
- **Wire contract**: `src/contract.ts` is types-only; `src/wire.ts` is its runtime guard. New payload fields need both plus a wire.spec case.
- **Session binding**: capability switches are scoped to one session id and persisted per session. Never let one session's switches leak into another.
- **No monkey-patching**: extend only through dsh's sanctioned seams (`tools.restrict`, `system-prompt/assemble`, the settings namespace, UI slots).
- **Host modules stay external**: React and `@deepseek-ai/*` client modules must remain external in `tsdown.config.ts` — a bundled second React breaks hooks.

## Pull requests

1. Fork, branch from `main`, keep the diff focused.
2. `pnpm check` and `pnpm test:coverage` green locally; CI runs the same gates.
3. Explain the *why* in the PR description; screenshots for UI changes.
4. One feature or fix per PR — split refactors from behavior changes.

## Releases

User-visible changes get one line in `CHANGELOG.md` under `Unreleased` as they land (user's wording, not the commit message). Releasing: cut the `Unreleased` section into `X.Y.Z - <date>`, bump `package.json`, `pnpm check`, `npm publish --access public --otp=<code>`, `git tag vX.Y.Z && git push --tags`, `gh release create vX.Y.Z`.
