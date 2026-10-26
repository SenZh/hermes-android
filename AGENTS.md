This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Branch Management & Release Workflow

To ensure stability and keep internal testing builds isolated from production, follow these branch and tagging rules:

1. **`main` (Production & Stable)**:
   - The primary source of truth for all validated code.
   - Merges into `main` automatically trigger CI checks and build workflows.
   - Never push experimental or unverified commits directly to `main` without testing.
2. **Feature & Preview Branches (`feat/*`, `build-zh`, etc.)**:
   - All active development, experiments, and localization work must happen on dedicated branches.
   - Internal test builds (Preview APKs) are triggered via `workflow_dispatch` on feature branches or tags like `v*-preview.*`.
   - **Internal builds must remain private**: Artifacts are downloaded via GitHub Actions Artifacts or private internal distribution channels. Never publish unfinished `preview` versions to public GitHub Releases.
3. **Official Releases**:
   - Official production tags follow strict SemVer (e.g., `v1.8.3`, exactly three numbers, no preview suffix).
   - A tag must be cut ONLY after complete automated CI verification and manual sign-off on real devices.

---

## Testing & Quality Gates (Zero-Illusion Testing Discipline)

All contributions and bug fixes MUST adhere to the **Test-Driven & Real-Verification Rule**:

1. **No Self-Referential / Fake Mocks (Tautology)**:
   - **Strictly Prohibited**: Declaring a dummy helper function inside the test file and asserting against that dummy helper.
   - **Mandatory**: Extract pure business logic into `src/lib/` (e.g., `src/lib/metrics.ts`, `src/lib/chat/actions.ts`), export it cleanly, and let tests import the actual production module.
2. **The 3-Tier Quality Gate (`npm test`)**:
   Before submitting PRs or triggering builds, the local gate must pass with 0 errors:
   - `node scripts/check-i18n.mjs`: Validates 100% dictionary completeness for all supported languages.
   - `npx tsc --noEmit`: Strict TypeScript static type check.
   - `npm test`: Runs both `vitest run` (pure module unit tests in `tests/*.test.ts`) AND `node scripts/verify-fixes.mjs` (21 architecture/contract regression suites).
3. **Writing New Tests for Fixes**:
   - Every bug fix (especially memory leaks, OOM, Native API incompatibilities, or RPC lock contentions) must append a deterministic test assertion in `tests/` or `scripts/verify-fixes.mjs`.
   - Verify zero-memory / stream pipelines: Ensure binary files never get read into JS memory via `base64()` to prevent `OutOfMemoryError`.
   - Verify Gateway Contracts: RPC calls must match `src/lib/gateway/contract.generated.ts`.

---

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
