# UMANI — Roadmap

Status: Draft v0.1 · Requirement IDs refer to [PRD](PRD.md)

Each milestone ends with: typecheck + lint + tests green, `security-reviewer` pass for anything touching auth/DB/AI, docs updated, and a demoable build. Durations assume one developer working with Claude Code agents.

| # | Milestone | Scope (PRD IDs) | Exit criteria | Est. |
|---|---|---|---|---|
| M0 | **Project plan** | CLAUDE.md, PRD, ARCHITECTURE, DATABASE, DESIGN_SYSTEM, ROADMAP | Docs reviewed and approved | done |
| M1.0 | **Plan review fixes** | Accounting rules (DATABASE §5a), FX policy, reversal dating, idempotency conflicts, BigInt wire format, session storage, app lock, savings goals, doc consistency | Review findings closed in the docs | done |
| M1a | **Finance engine & tooling** | see below | see below | done |
| M1b | **Local database** | see below | see below | done (218 pgTAP checks; CLI 3.2.0 pinned as devDependency) |
| M1c | **App shell** | see below | see below | done (verified on the iOS simulator; CI app job blocking) |
| M2 | Auth, onboarding & app lock | AUTH-1…6, UX-3 | Apple + Google sign-in on a dev build; encrypted session storage; profile trigger; onboarding writes the budget; Face ID lock; account deletion (`purge_user`) works end to end on staging | in progress: verified locally on the iOS simulator — Apple sign-in (Expo Go), Google sign-in on the `com.umani.app` dev build, onboarding writes the budget, app lock offer, account deletion from Settings (rows purged); remaining: staging project and the pre-staging checklist below |

**M2 pre-staging checklist (security review):**
1. Apple provider `client_id` = `com.umani.app` only; `host.exp.Exponent` stays in the local config (any Expo Go app can mint that audience).
2. Disable the email provider in hosted projects (no UI uses it; open sign-up allows pre-registering someone's email).
3. Google provider: only the client IDs in use. `skip_nonce_check` is on for Google (Apple keeps nonce checks): a leaked Google ID token for our audiences can mint a session. Before staging, check whether the Google Sign-In library can pass a nonce and drop the skip; otherwise record the accepted risk in ARCHITECTURE.
4. Revoke the Sign in with Apple token on account deletion (guideline 5.1.1(v)); Apple key as an Edge Function secret; fail closed.
5. ~~Re-authenticate (Face ID / passcode) before account deletion~~ (done; a device with no passcode keeps only the confirmation dialog). Still open: the `delete-account` function should also require a recently issued session (`iat` within a few minutes), so a stolen token alone can't delete the account.
6. ~~Session storage hardening~~ (done: serialised operations, crash-safe writes with alternating Keychain slots, delete only on authentication failure or a missing key; the UI signs out when the stored session is gone).
7. ~~App lock: no lock-out when Face ID and the passcode are removed (unlock turns the lock off); cleared only by sign-out from the unlocked app or account deletion~~ (done; the lock screen deliberately has no sign-out, so nobody holding the phone can reset the lock by re-signing in). Still open: native app-switcher snapshot cover verified on a device.
8. ~~Recovery screen when the active-budget query fails; resolve a lost delete response~~ (done: only `user_not_found` counts as deleted).
9. Hosted project: review `jwt_expiry`, `site_url`, redirect allowlist; secrets only via `env()`.
| M3 | Accounts & ledger | ACC-1…8 | Create/archive accounts, opening balances, in/out of budget, transfers incl. cross-currency with FX result, reconciliation, revaluation; balances from views; R1 holds in all pgTAP scenarios | in progress: M3a (NBK reference rates, `api.fx_rate`, sync function) and M3b (Home ≈ total and account list, create account with opening balance at a confirmed rate, in/out of budget, account card with book value, reconciliation, revaluation, archive; transfers incl. cross-currency with the derived rate and envelope choice at the budget boundary) done and checked on the simulator. ACC-5 (account switcher) moves to M5, where the transaction lists it filters arrive. Before staging: set the `SYNC_RATES_SECRET` function secret and schedule `sync-reference-rates` daily (pg_cron + pg_net, secret from Vault; the function has `verify_jwt = false` and checks the secret itself) |
| M4 | Budget methods & income | BUD-1…6, BUD-8, INC-1…5 | All presets + custom editor; auto/manual allocation exact; method switch with reassignment; reversal-based edit | 1.5 wks |
| M5 | Expenses, categories & limits | EXP-1…5 | Expense entry < 5 taps; categories with default envelopes; limits with progress; transaction history with undo | 1.5 wks |
| M6 | Deposits planner & savings goals | DEP-1…4, BUD-7 | Recommendations from the active budget; mark opened → linked deposit account; contributions as transfers; goals with progress and required monthly contribution | 1.5 wks |
| M7 | Statistics | STAT-1…5 | Monthly/yearly reports from SQL aggregates; charts in both themes; numbers match ledger fixtures | 1.5 wks |
| M8 | AI advisor | AI-1…6 | Consent flow; Edge Function with aggregates only; rate limits; refusal + faithfulness evals pass; ru/kk/en answers | 2 wks |
| M9 | Polish & hardening | UX-1…5, NFRs | Full ru/kk/en copy review; a11y audit; performance budget; Sentry with scrubbing; privacy manifest; offline read cache; CSV/JSON data export | 1.5 wks |
| M10 | Beta & launch | — | Staging → production Supabase (after legal check on data residency); TestFlight beta; App Store review assets; launch | 2 wks |

Post-v1 candidates: **recurring transactions (high priority)**, split expenses, loans/debts, base-currency rebase, automatic FX revaluation, offline write queue, shared/family budgets, CSV import, home-screen widgets, notifications for limits, Android release, FX reference feed.

---

## Milestone 1 — Foundations & Finance Engine (proposed next)

**Goal:** a correct, fully tested money core and database schema, plus the app skeleton (design tokens, i18n, navigation shell), before any feature screens. Finishing M1 retires the biggest risk: wrong money math or a leaky ledger.

**Constraints:** no Supabase cloud resources (local Docker stack only, via Supabase CLI); no `app.json` changes; only the dependencies listed below, each added with `npx expo install` and justified in the PR.

M1 is split into three PRs. M1a needs no Docker and starts first. M1b depends on M1a's fixtures. M1c can run in parallel with M1b.

### M1a — Finance engine & tooling (`tdd-guide` first, tests before code)
1. Tooling: Jest via `jest-expo`, `fast-check`, ESLint (`eslint-config-expo`, already added to devDependencies), `npm test` script, CI workflow (tsc, lint, jest + coverage gate). *Done.* The `domain` import boundary is enforced by `scripts/check-domain-boundary.js` (run before Jest) because ECC's config-protection hook blocks edits to `eslint.config.js`; the "features don't cross-import" rule waits until features exist. CI (`.github/workflows/ci.yml`) has a blocking `domain` job and a non-blocking whole-app job.
2. `src/domain/money`: `Money`, `CurrencyCode` (KZT, USD, EUR, RUB, CNY + minor units), parse from user input (ru/kk/en separators), add/sub/negate/compare, half-even rounding, `convert` with decimal-string rates, `allocate` (largest remainder), `toWire`/`fromWire`.
3. `src/domain/fx`: book-value rules (DATABASE §5a R2/R4): moving-average outgoing base, realised FX result on transfers, revaluation delta.
4. `src/domain/allocation`: presets (50/30/20, 80/20, 90/10, 70/20/10), custom validation (bps sum 10000, 1–12 envelopes), income allocation preview (auto, and manual with remainder → Unallocated).
5. `src/domain/ledger`: entry builders for opening balance, income, expense, transfer (same/cross currency, in/out of budget), reallocation, adjustment, revaluation, reversal; checkers for L1 (zero-sum per currency) and R1 (envelopes = budgeted book value).
6. Property-based tests: allocation always sums to the total; R1 holds after any random sequence of operations; reversal nets to zero; conversion round-trips within one minor unit.
7. `supabase/fixtures/allocation.json`, `conversion.json`, `fx.json` shared vectors (including the DATABASE §4 examples).

**Exit:** domain coverage ≥ 95%; property tests green; CI green; no new runtime dependency for the domain.

### M1b — Local database (`database-reviewer` on each migration, `security-reviewer` on RPCs)
8. `supabase init` (config only, local) with `api` added to the exposed schemas; migrations 0001–0006 from DATABASE.md §10: reference data, profiles + trigger, budget/envelopes/categories/limits/savings_goals, accounts + ledger tables (with `base_amount_minor`, `request_hash`) + invariant triggers + append-only guards + `private.purge_user`, core RPCs (`setup_budget`, `create_account`, `record_income`, `record_expense`, `record_transfer`, `record_adjustment`, `record_revaluation`, `reverse_entry`, `amend_entry`), views returning amounts as text.
9. pgTAP: RLS matrix (two users + anon), L1/R1 invariants, append-only guards, purge path, RPC behaviour, idempotency (retry and conflict), fixture parity with TS (allocation, FX).
10. Generate `database.types.ts` from the local DB.
11. Add the Supabase CLI step (`supabase start` + `supabase test db`) to CI.

**Exit:** `supabase db reset` applies cleanly; pgTAP 100% green, including cross-user denial; unbalanced entries, ledger UPDATE/DELETE and foreign-owned ids are all rejected; fixtures pass in both Jest and pgTAP.

### M1c — App shell (Mobile)
12. **Day-1 spike:** Hermes `Intl` output for `kk` and `ru` (numbers, currency, dates, plurals) on the iOS simulator; pick a custom formatter fallback in `domain/money/format` if needed.
13. Replace the Expo template demo (`explore`, demo components) with the target layout (`src/ui`, `src/features`, `src/domain`, `src/lib`), keeping `app.json` untouched.
14. Design tokens + primitives: `Text`, `Surface`, `Button`, `ListRow`, `AmountText` (on domain formatting), light/dark/system theme hook.
15. i18n: i18next + expo-localization, `ru`/`kk`/`en` resources, plural rules.
16. Navigation shell: root providers (theme, i18n, QueryClient), `(tabs)` with Home · Budget · Stats · Advisor placeholders (localised titles, no features), `(auth)` placeholder route.

**Exit:** the app boots on the iOS simulator with tabs, light/dark and language switching (ru/kk/en); no template screens remain; `npx tsc --noEmit`, `npx expo lint`, `npm test` green; the CI `app` job is made blocking (remove `continue-on-error`).

### Dependencies M1 would add (pending approval)
- Dev: `jest-expo`, `jest`, `@testing-library/react-native`, `fast-check`. (`eslint` + `eslint-config-expo` are already present.)
- App: `i18next`, `react-i18next`, `expo-localization`, `zod`, `@tanstack/react-query` (shell provider only).
- Tools (not app dependencies): Supabase CLI, Docker.
- Waiting until M2: `@supabase/supabase-js`, `expo-secure-store`, `expo-local-authentication`, the MMKV/AsyncStorage session store, Apple and Google sign-in libraries.

### Exit criteria (whole M1)
- [ ] All M1a/M1b/M1c exits met.
- [ ] `app.json` unchanged; no cloud Supabase project created.
- [ ] `security-reviewer` pass on migrations and RPCs; no secrets in the repo; `.env.example` lists only public vars.

### Risks
| Risk | Mitigation |
|---|---|
| Hermes `Intl` lacks full `kk` locale data | Day-1 spike in M1c; custom formatter fallback in `domain/money/format` |
| TS/SQL drift (allocation, FX book value) | Shared fixtures; CI fails on mismatch |
| BigInt in JSON (cache, network) | Strings at every boundary (`toWire`/`fromWire`); zod parsing |
| Moving-average FX confuses users | Show "≈" market value next to book value; "Update to current rate" action; explain in advisor lessons |
| Docker unavailable for local Supabase | M1a proceeds independently; M1b can run in CI |
