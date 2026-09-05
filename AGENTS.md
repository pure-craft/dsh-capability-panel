# AGENTS.md — contributor guide for coding agents

A DeepSeek Harness (dsh) web plugin. Two halves ship from one repo:

| Half | Source | Build entry | Notes |
|---|---|---|---|
| Host (Node, in the dsh process) | `src/index.ts` + `src/host/` | `lib/index.js` | loopback HTTP route `/api/capability-panel`; needs a dsh restart to reload |
| Client (browser panel) | `src/client/` | `lib/client.js` | `__ModuleLoader__` factory; hot-swaps only while `dsh web` and `pnpm dev` run together |

## Commands

```bash
pnpm install --frozen-lockfile
pnpm check          # typecheck + type-aware oxlint + tests — required green before commit
pnpm test:coverage  # 100% statements/branches/functions/lines gates on src/** — do not lower them
pnpm build          # tsdown, both halves into lib/ (gitignored)
```

## Invariants that tests enforce (do not break them)

- `mount`/toggles are session-bound: session state lives in `src/host/capabilities.ts`, persisted per session id under the `capability-panel` namespace in `$DSH_HOME/settings.yaml` via `src/host/session-overrides.ts`. Never let one session's switches leak into another.
- Load states come from the live session's in-memory surface (`session.snapshotEvents()` + `session.surface.nodes`). Never reintroduce `sessionQuery.readSession`/`listEvents` full-log reads — that was the performance bug this design replaced.
- `Session.snapshotEvents` reads `this.seq` in a default parameter — always call it receiver-bound (`session.snapshotEvents()`), never detached.
- Wire contract: `src/contract.ts` is types-only; `src/wire.ts` is its runtime guard. New payload fields need both, plus a wire.spec case.
- Locale: `src/client/locale.ts` zh/en dictionaries must keep identical key sets (pinned by `tests/client/locale.spec.ts`).
- READMEs are bilingual with equal authority: edit `README.md` and `README.zh.md` together, then re-record `git hash-object README.md README.zh.md` into `README.i18n.yaml`.

## Conventions

- Host code never throws across the HTTP boundary unchecked — degrade with a `degraded` note in the payload instead of an empty list.
- Client uses host-provided modules (`react`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-store`) — they must stay external in `tsdown.config.ts`; bundling a second React breaks hooks.
- Icons and primitives come from `@deepseek-ai/dsh-client-ui-primitives`; do not hand-draw SVGs.
