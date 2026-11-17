# UMANI — Roadmap

Status: Draft v0.1 · Requirement IDs refer to [PRD](PRD.md)

Each milestone ends with: typecheck + lint + tests green, `security-reviewer` pass for anything touching auth/DB/AI, docs updated, and a demoable build. Durations assume one developer working with Claude Code agents.

| # | Milestone | Scope (PRD IDs) | Exit criteria | Est. |
|---|---|---|---|---|
| M0 | **Project plan** (this PR) | CLAUDE.md, PRD, ARCHITECTURE, DATABASE, DESIGN_SYSTEM, ROADMAP | Docs reviewed and approved | done |
| **M1** | **Foundations & Finance Engine** | see below | see below | 1.5–2 wks |
| M2 | Auth & onboarding | AUTH-1…5, UX-3 | Apple + Google sign-in on a dev build; profile trigger; onboarding writes the budget; account deletion works end to end on staging | 1.5 wks |
| M3 | Accounts & ledger | ACC-1…7 | Create/archive accounts, opening balances, transfers incl. cross-currency, reconciliation; balances from views; pgTAP green | 1.5 wks |
| M4 | Budget methods & income | BUD-1…5, INC-1…5 | All presets + custom editor; auto/manual allocation exact; method switch with reassignment; reversal-based edit | 1.5 wks |
| M5 | Expenses, categories & limits | EXP-1…5 | Expense entry < 5 taps; categories with default envelopes; limits with progress; transaction history with undo | 1.5 wks |
| M6 | Deposits planner | DEP-1…4 | Recommendations from the active budget; mark opened → linked deposit account; contributions as transfers | 1 wk |
| M7 | Statistics | STAT-1…5 | Monthly/yearly reports from SQL aggregates; charts in both themes; numbers match ledger fixtures | 1.5 wks |
| M8 | AI advisor | AI-1…6 | Consent flow; Edge Function with aggregates only; rate limits; refusal + faithfulness evals pass; ru/kk/en answers | 2 wks |
| M9 | Polish & hardening | UX-1…5, NFRs | Full ru/kk/en copy review; a11y audit; performance budget; Sentry with scrubbing; privacy manifest; offline read cache | 1.5 wks |
| M10 | Beta & launch | — | Staging → production Supabase (after legal check on data residency); TestFlight beta; App Store review assets; launch | 2 wks |

Post-v1 candidates: offline write queue, shared/family budgets, recurring transactions, CSV export/import, home-screen widgets, notifications for limits, Android release, FX reference feed.

---

## Milestone 1 — Foundations & Finance Engine (proposed next)

**Goal:** a correct, fully tested money core and database schema, plus the app skeleton (design tokens, i18n, navigation shell), before any feature screens. Finishing M1 retires the biggest risk: wrong money math or a leaky ledger.

**Constraints:** no Supabase cloud resources (local Docker stack only, via Supabase CLI); no `app.json` changes; only the dependencies listed below, each added with `npx expo install` and justified in the PR.

### Workstreams & tasks

**Finance engine** (`tdd-guide` first, tests before code)
1. `src/domain/money`: `Money`, `CurrencyCode` (KZT, USD, EUR, RUB, CNY + minor units), parse from user input (ru/kk/en separators), add/sub/negate/compare, half-even rounding, `convert` with decimal-string rates, `allocate` (largest remainder).
2. `src/domain/allocation`: presets (50/30/20, 80/20, 90/10, 70/20/10), custom validation (bps sum 10000, 1–12 envelopes), income allocation preview (auto + manual override validation).
3. `src/domain/ledger`: entry builders for opening balance, income, expense, transfer (same/cross currency), reallocation, reversal; zero-sum invariant checker.
4. Property-based tests (fast-check): allocation always sums to the total; conversion round-trips within one minor unit; reversal nets to zero.
5. `supabase/fixtures/allocation.json` + `conversion.json` shared vectors.

**Backend** (`database-reviewer` on each migration)
6. `supabase init` (config only, local) + migrations 0001–0006 from DATABASE.md §10: reference data, profiles + trigger, budget/envelopes, accounts + ledger tables + invariant triggers + append-only guards, core RPCs (`setup_budget`, `create_account`, `record_income`, `record_expense`, `record_transfer`, `reverse_entry`), views.
7. pgTAP suites: RLS matrix (two users + anon), invariants, RPC behaviour, idempotency, allocation fixture parity with TS.
8. Generate `database.types.ts` from the local DB.

**Mobile**
9. Replace the Expo template demo (`explore`, demo components) with the target layout (`src/ui`, `src/features`, `src/domain`, `src/lib`), keeping `app.json` untouched.
10. Design tokens + primitives: `Text`, `Surface`, `Button`, `ListRow`, `AmountText` (on domain formatting), light/dark/system theme hook.
11. i18n: i18next + expo-localization, `ru`/`kk`/`en` resources, plural rules, number formatting check on Hermes (kk fallback if needed).
12. Navigation shell: root providers, `(tabs)` with Home · Budget · Stats · Advisor placeholders (localised titles, no features), `(auth)` placeholder route.

**Testing**
13. Jest via `jest-expo` + React Native Testing Library; coverage gate (domain ≥ 95%); `npm test` script.
14. ESLint import boundaries (`domain` imports nothing; features don't cross-import).
15. CI workflow (GitHub Actions): tsc, lint, jest, `supabase start` + `supabase test db`.

**Security**
16. Threat model doc section reviewed; `security-reviewer` pass on migrations/RPCs; check that no secrets exist and `.env.example` lists only public vars.

### Dependencies M1 would add (pending approval)
`jest-expo`, `jest`, `@testing-library/react-native`, `fast-check` (dev) · `i18next`, `react-i18next`, `expo-localization` · `zod` · `@tanstack/react-query` (shell provider only) · Supabase CLI (dev tool, not an app dependency). `@supabase/supabase-js` and `expo-secure-store` wait until M2.

### Exit criteria
- [ ] Domain coverage ≥ 95%, property tests green, fixtures pass in **both** Jest and pgTAP.
- [ ] Local `supabase db reset` applies all migrations cleanly; pgTAP 100% green, including cross-user RLS denial.
- [ ] Unbalanced entries, ledger UPDATE/DELETE and foreign-owned ids are all rejected by tests.
- [ ] App boots on the iOS simulator with tabs, light/dark and language switching (ru/kk/en); no template screens remain.
- [ ] `npx tsc --noEmit`, `npx expo lint`, `npm test` green in CI.
- [ ] `app.json` unchanged; no cloud Supabase project created.

### Risks
| Risk | Mitigation |
|---|---|
| Hermes `Intl` lacks full `kk` locale data | Spike on day 1; custom formatter fallback in `domain/money/format` |
| TS/SQL allocation drift | Shared fixtures; CI fails on mismatch |
| BigInt over JSON | Amounts as strings at the boundary; zod parsing |
| Docker unavailable for local Supabase | Domain work proceeds independently; DB track can run in CI |
