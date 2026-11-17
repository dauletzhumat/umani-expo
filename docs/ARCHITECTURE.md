# UMANI — Architecture

Status: Draft v0.1 · Related: [PRD](PRD.md) · [DATABASE](DATABASE.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md)

## 1. Principles

1. **Correctness over cleverness.** Money is integer minor units; the ledger is double-entry and append-only; Postgres is the source of truth and enforces the invariants.
2. **Pure core, thin shell.** Business rules live in `src/domain` (pure TS) and in Postgres functions. React components render state and dispatch intents.
3. **Secure by default.** RLS on every table, RPC-only financial writes, secrets only on the server, least data to third parties.
4. **Modular by feature.** Each feature owns its API hooks, components and mappers; features communicate through domain types and the server.
5. **Use the platform.** Expo modules and native iOS components (NativeTabs, SF Symbols, glass effect) before third-party UI kits.

## 2. System context

```
┌──────────────────────────┐        HTTPS (JWT)        ┌──────────────────────────────┐
│  UMANI iOS app (Expo)    │ ────────────────────────▶ │ Supabase                      │
│  React Native + Router   │   PostgREST /rpc, Auth    │  • Auth (Apple, Google OIDC)  │
│  domain/ (pure TS)       │ ◀──────────────────────── │  • Postgres + RLS + RPCs      │
│  TanStack Query cache    │                           │  • Edge Functions (Deno)      │
└──────────────────────────┘                           │     ai-advisor ──────────────┼──▶ OpenAI API
        │ Apple / Google native sign-in SDKs           │     delete-account ──────────┼──▶ Apple token revoke
        ▼                                              └──────────────────────────────┘
  Apple ID / Google Identity  (ID token → supabase.auth.signInWithIdToken)
```

No bank integrations. No server other than Supabase in v1.

## 3. Client architecture

### 3.1 Layers

| Layer | Path | Responsibility | May import |
|---|---|---|---|
| Routes | `src/app/**` | Expo Router screens and layouts; auth gating; deep links | features, ui, lib |
| Features | `src/features/<name>/` | Screens' building blocks, data hooks, mappers | domain, ui, lib |
| Domain | `src/domain/**` | Money, allocation, ledger builders, report math | nothing (std only) |
| UI kit | `src/ui/**` | Tokens, themed primitives, finance components | domain (types/formatting only) |
| Lib | `src/lib/**` | Supabase client, i18n, secure storage, logging | domain |

Enforce this with ESLint `no-restricted-imports` (Milestone 1).

### 3.2 Feature modules

| Feature | Screens / responsibilities | Key RPCs |
|---|---|---|
| `auth` | Sign-in, session bootstrap, sign-out, delete account | Supabase Auth, `delete-account` fn |
| `onboarding` | Language → base currency → method → first account | `setup_budget`, `create_account` |
| `accounts` | List, detail, create, archive, switcher, transfers, reconcile | `create_account`, `record_transfer`, `record_adjustment` |
| `budget` | Envelopes, method switch, custom editor, limits | `setup_budget`, `change_budget_method`, `reallocate`, `set_limit` |
| `income` | Add income, allocation preview/override | `record_income` |
| `expenses` | Add expense, categories | `record_expense`, `create_category` |
| `transactions` | Unified history, edit/delete (reversal) | `reverse_entry` |
| `deposits` | Recommendations, "mark opened" → linked deposit account | `create_account` |
| `stats` | Monthly/yearly reports, charts | `report_monthly`, `report_yearly` (read RPCs) |
| `advisor` | Consent, chat, lessons | `ai-advisor` fn |
| `settings` | Language, theme, base currency display, privacy | `update_profile` |

### 3.3 Navigation (Expo Router)

```
src/app/
  _layout.tsx                 # providers: Theme, i18n, QueryClient, Auth; splash gating
  (auth)/sign-in.tsx
  (onboarding)/…              # shown until profile.onboarded_at is set
  (tabs)/_layout.tsx          # NativeTabs: Home · Budget · Stats · Advisor
    index.tsx                 # Home: total balance, envelopes summary, recent activity
    budget/…  stats/…  advisor/…
  accounts/[id].tsx           # pushed screens
  transaction/new.tsx         # modal sheet (income | expense | transfer)
  settings/…
```

Auth gating uses `Stack.Protected` / redirect in the root layout. Check the SDK 58 Router docs for the current API before implementing.

### 3.4 State & data flow

```
UI event → feature hook (useRecordExpense)
         → domain builds + validates the intent (Money, allocation preview)
         → supabase.rpc('record_expense', { amount_minor: '12500', idempotency_key, … })
         → Postgres function: auth.uid() check, ownership check, invariant checks, insert entry+lines
         → returns entry id → TanStack Query invalidates ['balances'], ['envelopes'], ['stats', month]
         → optimistic UI rolls forward (or back on error, with a localised message)
```

- Server state: TanStack Query. Persist the cache (MMKV or AsyncStorage) for instant cold start. Read-only offline view.
- Amounts move as strings in the API. `bigint` in the domain. Formatted only at the UI edge.
- Realtime subscriptions are not needed in v1 (single user, single device is the main case).

### 3.5 Finance engine (`src/domain`)

- `money`: `Money = { amountMinor: bigint; currency: CurrencyCode }`; `parseMoney(input, currency, locale)`, `add/sub/negate`, `allocate(total, weightsBps[]) → Money[]` (largest-remainder method, deterministic tie-break by envelope order), `convert(money, rate: Rational, target)` with banker's rounding (half-even), `format(money, locale)`.
- `allocation`: method presets, `validateCustom(bps[])` (sum = 10000, each 1..10000), `previewIncomeAllocation`.
- `ledger`: builders that produce the exact line sets the DB expects (for previews and tests) and invariant checkers.
- `reports`: aggregation helpers (savings rate, budget variance).
- FX rates are rationals (`numerator/denominator` as bigint) or decimal strings, **never floats**.
- Parity: `supabase/fixtures/allocation.json` holds vectors (total, weights, expected parts) that both Jest and pgTAP run.

## 4. Backend architecture (Supabase)

- **Postgres** holds all data. Schema in [DATABASE.md](DATABASE.md).
- **Write path**: `SECURITY DEFINER` PL/pgSQL functions in the `api` schema (exposed), with `set search_path = ''`. Each one checks `auth.uid()`, validates that every referenced row belongs to the caller, enforces invariants and writes. Ledger tables have no INSERT/UPDATE/DELETE grants for `authenticated`.
- **Read path**: tables and `security_invoker` views under RLS (`account_balances`, `envelope_balances`, `monthly_summary`).
- **Edge Functions** (Deno, TypeScript):
  - `ai-advisor`: verifies the JWT, checks consent and rate limits, builds the aggregated context with a service-role read, calls OpenAI, stores the message, returns the answer.
  - `delete-account`: verifies the JWT, revokes the Apple refresh token if present, deletes the auth user (cascades all rows), logs a deletion receipt with no PII.
- **Environments**: `local` (Supabase CLI + Docker, used in Milestone 1), `staging`, `production`. Separate projects and keys. Migrations only via `supabase/migrations` + CI. No dashboard edits in production.

## 5. Authentication

| Provider | Client | Supabase |
|---|---|---|
| Apple | `expo-apple-authentication` (native sheet) → identity token + nonce | `signInWithIdToken({ provider: 'apple', token, nonce })` |
| Google | Native Google Sign-In SDK (choose the SDK 58–compatible library at implementation time; needs a dev build) → ID token | `signInWithIdToken({ provider: 'google', token })` |

- Use a hashed nonce (SHA-256) for Apple to stop replay.
- Store the session in `expo-secure-store` (Keychain). Don't put tokens in AsyncStorage.
- A `profiles` row is created by an `on auth.users insert` trigger.
- The user's display name is taken from Apple only on first sign-in (Apple sends it once); store it then.
- Both providers need a development build (not Expo Go) and `app.json` plugin entries. That change happens in the Auth milestone with explicit sign-off (CLAUDE.md rule 8).

## 6. AI advisor

```
App ──(question, locale, JWT)──▶ ai-advisor fn
   1. verify JWT, load profile; require ai_consent_at not null
   2. rate limit (e.g. 30 msgs/day, monthly token cap) via ai_usage table
   3. build context: last 3–6 months aggregates ONLY
        { base_currency, monthly income/expense totals, per-envelope planned vs actual,
          savings rate, method, category totals (category keys, not free-text notes) }
      no names, emails, account names, notes or raw transactions
   4. system prompt: role = financial educator; rules: no securities/crypto picks,
      no promises of returns, no actions, answer in user locale, cite numbers from context,
      add "education, not individual investment advice" when relevant
   5. call OpenAI (model configurable via secret; streaming), no tools/functions
   6. moderate/validate output; store message + token usage
   7. stream back to app
```

- Prompt templates are versioned in `supabase/functions/ai-advisor/prompts/` and covered by regression evals (`ai-regression-testing`): refusal cases (stock tips, "transfer money for me") and numeric faithfulness.
- Provider abstraction (`LlmProvider` interface) so the model or vendor can change without app changes.
- Disable OpenAI training on API data (the API default) and record the data-processing basis in the privacy policy.

## 7. Security & privacy model

| Threat | Control |
|---|---|
| Cross-user data access | RLS `user_id = (select auth.uid())` on every table; pgTAP tests with two users; ownership checks inside every RPC |
| Ledger tampering / inconsistent balances | No write grants on ledger tables; deferred constraint trigger for zero-sum; append-only (UPDATE/DELETE revoked + trigger guard) |
| Double-posting on retry | `idempotency_key` unique per user |
| Secret leakage | Only URL + anon key in the client; `EXPO_PUBLIC_*` reviewed; secrets in Supabase function secrets / EAS secrets |
| Token theft on device | Keychain storage; short-lived JWT; refresh rotation |
| Prompt injection via user text | Advisor context excludes free-text notes; no tools; output can't trigger actions |
| Over-collection | Analytics events carry no amounts, names or notes; crash reports scrub PII |
| Account deletion compliance | In-app deletion → Edge Function → cascade + Apple token revoke |
| Regulatory | KZ personal-data law review (localisation) before launch; App Store privacy manifest and nutrition labels |

## 8. Cross-cutting

- **i18n**: `i18next` + `react-i18next` + `expo-localization`; keys namespaced per feature; ICU plurals (ru and kk plural rules differ from en). `Intl.NumberFormat` for numbers. Verify Hermes Intl support for `kk` at the start of Milestone 1 and fall back to a custom formatter if needed.
- **Theming**: tokens in `src/ui/tokens`; `useTheme()` returns semantic colours; system/light/dark override saved in the profile and locally.
- **Error handling**: typed `AppError` (network, auth, validation, invariant, unknown) mapped to localised messages; Sentry (or similar) with PII scrubbing. Choose this in the hardening milestone.
- **Observability**: privacy-safe product analytics (screen views, feature usage counts) behind consent.
- **CI** (GitHub Actions): typecheck, lint, jest + coverage gate, `supabase db lint`, pgTAP on an ephemeral local stack, EAS build on main.

## 9. Key decisions (ADR summary)

| # | Decision | Alternatives rejected | Why |
|---|---|---|---|
| 1 | Integer minor units (`bigint`), amounts as strings over JSON | `numeric` floats in JS, decimal.js | Exactness; JSON numbers lose precision above 2^53 |
| 2 | Double-entry money ledger + separate envelope ledger | Single "transactions" table with balance columns | Auditability; balances are derived, never drift |
| 3 | RPC-only writes (security definer) | Client inserts under RLS | Multi-row atomic invariants can't be expressed in RLS alone |
| 4 | Allocation computed in SQL (authoritative) and TS (preview) with shared fixtures | Client-only | The server can't trust client math; the UI needs instant previews |
| 5 | Supabase Edge Function proxy for OpenAI | Direct client calls | Key secrecy, rate limits, data minimisation |
| 6 | Online-first + idempotent RPCs | Offline-first sync engine | Lower complexity for v1; path to offline stays open |
| 7 | TanStack Query for server state | Redux, a heavy global store | Server-cache semantics fit; less boilerplate |

Record new decisions as ADRs in `docs/adr/NNNN-title.md` (ECC `architecture-decision-records` skill).
