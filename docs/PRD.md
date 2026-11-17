# UMANI — Product Requirements Document

Status: Draft v0.1 · Owner: Product/Lead architect · Last updated: 2026-11-17

## 1. Vision

UMANI helps people in Kazakhstan and the wider CIS region take control of their money with a calm, premium budgeting experience. Each tenge, dollar or ruble gets a job, users understand *why* through built-in financial education, and they're nudged toward real-world saving habits (separate deposits per goal). UMANI never touches the user's bank.

## 2. Target users

| Persona | Need |
|---|---|
| **Aruzhan, 26, salaried in Almaty** | Gets paid in KZT and wants a simple rule (50/30/20) applied automatically to every paycheck. |
| **Timur, 34, freelancer** | Has irregular income in USD and KZT across several cards and cash; wants one view of all balances and honest monthly reports. |
| **Dana, 41, family budget owner** | Wants to plan savings goals (education, emergency fund) and know which real deposits to open. |

Primary platform: iPhone (minimum iOS to be confirmed against the SDK 58 minimum). Android and web are not v1 targets, but the codebase must not block them.

## 3. Goals & success metrics

| Goal | Metric (90 days after launch) |
|---|---|
| Users adopt a budget method | ≥ 70% of activated users finish budget setup |
| Habitual tracking | ≥ 40% W4 retention; median ≥ 3 transactions/week among retained users |
| Savings behaviour | ≥ 30% of users record at least one savings deposit account |
| Trust | 0 balance-calculation bugs reported; crash-free sessions ≥ 99.5% |
| AI usefulness | ≥ 60% thumbs-up on advisor answers |

## 4. Scope — functional requirements

IDs are referenced from ROADMAP and tests.

### 4.1 Authentication (AUTH)
- AUTH-1 Sign in with Apple (required by App Store guideline 4.8 because Google sign-in is offered).
- AUTH-2 Sign in with Google.
- AUTH-3 Sessions persist securely (Keychain via secure storage); silent refresh.
- AUTH-4 Sign out; **delete account and all data** in-app (App Store requirement), including revoking the Apple token.
- AUTH-5 First-run onboarding: language, base currency, budget method.

### 4.2 Budget allocation methods (BUD)
- BUD-1 Presets (envelopes with default names, localised):
  - **50/30/20** — Needs 50 · Wants 30 · Savings 20
  - **80/20** — Spending 80 · Savings 20
  - **90/10** — Spending 90 · Savings 10
  - **70/20/10** — Living 70 · Savings 20 · Debt/Giving 10
- BUD-2 **Custom**: 1–12 envelopes, user-named, percentages with up to 2 decimals (stored as basis points) that must total exactly 100%.
- BUD-3 Users can switch method later. Past allocations stay as they were; new income uses the new method. Envelope balances carry over (or are reassigned by the user when an envelope is removed).
- BUD-4 Each budget has one **base currency** in which envelopes are tracked.
- BUD-5 Unspent envelope money rolls over month to month (envelope = running balance). Monthly limits are tracked separately (EXP-4).

### 4.3 Financial accounts (ACC)
- ACC-1 Multiple accounts: cash, card, current, savings, deposit.
- ACC-2 Supported currencies: **KZT, USD, EUR, RUB, CNY**. Each account has exactly one currency.
- ACC-3 Opening balance at creation (recorded as a ledger entry, not a mutable field).
- ACC-4 Balance shown per account and as a total in base currency (using the latest user-recorded or reference rate, labelled "approximate").
- ACC-5 Account switcher (filter the home and transaction views by account, or "All").
- ACC-6 **Internal transfers** between own accounts, including cross-currency transfers where the user enters both amounts (the effective rate is derived and shown).
- ACC-7 Archive accounts (hidden, history kept). Manual balance adjustment (reconciliation) creates an adjustment entry.

### 4.4 Income (INC)
- INC-1 Manual income entry: amount, account, date, category (salary, freelance, gift, other…), note.
- INC-2 Automatic allocation into envelopes using the active method, with an exact split (no rounding loss; see DATABASE §Allocation).
- INC-3 Optional manual allocation: the user overrides the split per entry; the parts must equal the total.
- INC-4 Income in a non-base currency is converted to the base currency for envelope tracking at a rate the user confirms (pre-filled when available).
- INC-5 Edit = reverse + re-enter (shown to the user as an ordinary edit).

### 4.5 Expenses (EXP)
- EXP-1 Manual expense entry: amount, account, envelope, category, date, note.
- EXP-2 Categories: a localised default set plus custom categories; each category has a default envelope.
- EXP-3 Overspending an envelope is allowed but clearly shown (negative envelope balance).
- EXP-4 Monthly **budget limits** per envelope and optionally per category, with progress and threshold alerts (local notifications, opt-in; later milestone).
- EXP-5 Edit and delete via reversal (history keeps an audit trail; the UI hides reversed pairs by default).

### 4.6 Bank deposits planner (DEP)
- DEP-1 From the active budget, recommend a set of **real** accounts/deposits to open, one per savings-type envelope (plus an optional "spending" current account), with suggested names (e.g. "UMANI · Подушка безопасности"), the allocation percentage, and the expected monthly contribution based on average income.
- DEP-2 Educational copy: why separate accounts help, what to look for (deposit insurance, withdrawal terms). **No specific bank or product endorsements in v1.**
- DEP-3 The user marks a recommendation as "opened" and creates a tracked account (type `deposit`) linked to the envelope.
- DEP-4 No automatic transfers or bank connections. Contributions are recorded manually as transfers.

### 4.7 Statistics (STAT)
- STAT-1 Income vs expenses per month and per year, in base currency.
- STAT-2 Spending by category and by envelope.
- STAT-3 Budget performance: planned allocation vs actual spending per envelope; limit adherence.
- STAT-4 Savings progress: savings envelope balances and deposit account balances over time; savings rate.
- STAT-5 Monthly and yearly report screens; shareable image export (later).

### 4.8 AI financial advisor (AI)
- AI-1 Chat-style advisor with suggested prompts: "How am I doing this month?", "Where can I cut spending?", "Explain the 50/30/20 rule".
- AI-2 Budget recommendations (e.g. which method fits the user's income pattern), spending analysis and savings guidance, based on **aggregated** user data.
- AI-3 Financial education: short lessons and explainers in all three languages.
- AI-4 Guardrails: no investment execution, no specific securities or crypto picks, no autonomous transactions, no voice input. Shows a standing disclaimer.
- AI-5 Explicit opt-in consent before any data is sent to the AI provider; the user can withdraw it.
- AI-6 Per-user rate limits and a monthly token budget.

### 4.9 UI/UX & localisation (UX)
- UX-1 Premium minimalist design (Apple HIG, Linear-like restraint, modern fintech clarity). See DESIGN_SYSTEM.md.
- UX-2 Light and dark mode following the system, with a manual override.
- UX-3 Languages: **Russian (default for KZ/RU locale), Kazakh, English**; switchable in-app.
- UX-4 iPhone-first responsive layouts (SE through Pro Max); Dynamic Type; VoiceOver.
- UX-5 Locale-correct number, currency and date formatting.

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Accuracy | Integer minor-unit arithmetic everywhere; ledger invariants enforced in the DB; allocation sums are exact. |
| Reliability | Append-only ledger; idempotent writes; reconciliation checks. |
| Security | RLS on all tables; RPC-only financial writes; secrets server-side only; OWASP MASVS-L1 baseline. |
| Privacy | Data minimisation; no amounts or PII in analytics; AI receives aggregates only; App Store privacy manifest; in-app data deletion and export (later). Legal review of Kazakhstan personal-data law (including data localisation) **before public launch**. |
| Performance | Cold start < 2 s on iPhone 12; transaction entry → updated balance < 500 ms perceived (optimistic UI). |
| Accessibility | WCAG 2.2 AA contrast; Dynamic Type to XXL without truncating amounts; VoiceOver labels for amounts. |
| Testability | Pure domain layer ≥ 95% coverage; pgTAP for RLS/RPCs; E2E for critical flows. |

## 6. Non-goals (v1)

- Bank connections, open banking, SMS/receipt parsing, automatic transfers.
- Investment tracking or execution, crypto.
- Voice input.
- Shared/family budgets with multiple users (later candidate).
- Android and web releases (the code stays portable).
- Offline-first sync (online-first with idempotent retries in v1).

## 7. Open questions

1. Data residency: does KZ personal-data localisation apply to our user base and data categories? Is a Supabase region acceptable, or do we need self-hosted Postgres in KZ? (Blocks public launch, not development.)
2. FX reference rates: user-entered only, or a reference feed (e.g. the National Bank of Kazakhstan's official rates) fetched by an Edge Function?
3. Monetisation (subscription for the AI advisor?) affects AI rate limits and the paywall milestone.
4. Minimum iOS version for SDK 58.
5. Final brand assets (the current icon and splash are Expo defaults).
