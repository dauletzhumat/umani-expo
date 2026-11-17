# UMANI — Database Design (Supabase Postgres)

Status: Draft v0.1 — **design only; no Supabase resources exist yet.** Related: [ARCHITECTURE](ARCHITECTURE.md)

## 1. Conventions

- Schemas: `public` (tables, RLS-protected, read via PostgREST), `api` (exposed RPC functions), `private` (internal helpers and triggers, not exposed).
- PKs: `uuid` default `gen_random_uuid()`. All user-owned tables carry `user_id uuid not null references auth.users(id) on delete cascade`.
- Money: `amount_minor bigint` + `currency char(3)`. **Never `numeric` floats or `money`.** FX rates: `numeric(24,12)`, used only inside SQL with explicit rounding.
- Timestamps: `created_at timestamptz not null default now()`. Business dates: `occurred_on date` (user's local date; the timezone is stored in the profile).
- Enums are Postgres enums for closed sets (account kind, entry kind).
- Every table: `alter table … enable row level security;` plus policies plus pgTAP tests in the same migration PR.
- Indexes on every FK and on `(user_id, occurred_on desc)` for history queries.

## 2. Reference data

```sql
create table public.currencies (
  code        char(3) primary key,          -- ISO 4217
  minor_units smallint not null check (minor_units between 0 and 4),
  symbol      text not null
);
-- seed: KZT 2 ₸ · USD 2 $ · EUR 2 € · RUB 2 ₽ · CNY 2 ¥
-- RLS: select to authenticated; no writes.
```

## 3. Core tables

### profiles
| column | type | notes |
|---|---|---|
| id | uuid PK → auth.users | created by trigger on signup |
| display_name | text null | from Apple/Google on first sign-in |
| locale | text not null default 'ru' | `ru` \| `kk` \| `en` |
| timezone | text not null default 'Asia/Almaty' | |
| base_currency | char(3) → currencies | display/total currency |
| theme | text default 'system' | system \| light \| dark |
| onboarded_at | timestamptz null | |
| ai_consent_at | timestamptz null | null = AI disabled |

### budgets
| column | type | notes |
|---|---|---|
| id, user_id | | |
| base_currency | char(3) | envelopes are tracked in this currency |
| method | enum `budget_method` | `50_30_20`, `80_20`, `90_10`, `70_20_10`, `custom` |
| is_active | bool | partial unique index: one active budget per user |

### envelopes
| column | type | notes |
|---|---|---|
| id, user_id, budget_id | | |
| name | text null | null → use localised `name_key` |
| name_key | text null | e.g. `envelope.needs` |
| kind | enum `envelope_kind` | `needs`, `wants`, `savings`, `spending`, `living`, `debt_giving`, `custom`, `unallocated` |
| allocation_bps | int | 0–10000; the system `unallocated` envelope = 0 |
| sort_order | int | also the tie-break order for rounding |
| is_system | bool | one `unallocated` envelope per budget |
| archived_at | timestamptz null | |

Invariant (checked in `api.setup_budget` / `api.change_budget_method`): the sum of `allocation_bps` over active non-system envelopes = 10000.

### accounts
| column | type | notes |
|---|---|---|
| id, user_id | | |
| name | text | user-facing |
| kind | enum `account_kind` | `cash`, `card`, `current`, `savings`, `deposit`, `system` |
| system_role | enum null | `income`, `expense`, `opening_balance`, `fx_clearing`, `adjustment` (only when kind = system) |
| currency | char(3) → currencies | immutable after creation |
| institution | text null | free text bank name (user-entered) |
| linked_envelope_id | uuid null → envelopes | deposit planner link |
| include_in_budget | bool default true | whether its money is "budgeted" |
| archived_at | timestamptz null | |

System accounts (hidden) are created lazily per user and currency: they're the counterparties that keep every entry zero-sum. They're never shown as user accounts.

### categories
`id, user_id, kind ('income'|'expense'), name, name_key, icon, default_envelope_id null, archived_at`. Default categories are seeded per user at onboarding from a localised template.

### ledger_entries (journal header — append-only)
| column | type | notes |
|---|---|---|
| id, user_id | | |
| kind | enum `entry_kind` | `opening_balance`, `income`, `expense`, `transfer`, `allocation`, `adjustment`, `fx_revaluation`, `reversal` |
| occurred_on | date | for a reversal: **copied from the original entry** (see §5a R5) |
| category_id | uuid null | |
| note | text null | max 500 chars; **never sent to AI** |
| reverses_entry_id | uuid null unique → ledger_entries | at most one reversal per entry |
| idempotency_key | uuid not null | `unique (user_id, idempotency_key)` |
| request_hash | bytea not null | SHA-256 of the canonical RPC parameters; same key + different hash → error `idempotency_conflict` |
| created_at | timestamptz | real time the entry was recorded |

### ledger_lines (money movements — append-only)
| column | type | notes |
|---|---|---|
| id | uuid | |
| entry_id | uuid → ledger_entries | |
| user_id | uuid | denormalised for RLS/indexing |
| account_id | uuid → accounts | |
| amount_minor | bigint | signed: + increases the account. ≠ 0, except lines of `fx_revaluation` entries (= 0) and of their reversals |
| currency | char(3) | must equal the account currency (trigger) |
| base_amount_minor | bigint null | **book value** of this movement in the budget base currency. Required on lines of user accounts, null on system accounts (trigger). Equals `amount_minor` when the account currency = base currency. On unbudgeted accounts it's the value at the user-confirmed rate, used only for reports and excluded from R1. See §5a |

**Invariant L1**: for each entry and currency, `sum(amount_minor) = 0`. A deferred constraint trigger (`deferrable initially deferred`) checks it at commit.

`accounts.currency` is immutable (a `before update` trigger rejects changes).

### envelope_lines (budget movements — append-only)
| column | type | notes |
|---|---|---|
| id, entry_id, user_id | | |
| envelope_id | uuid → envelopes | |
| amount_minor | bigint ≠ 0 | in the budget's base currency |
| fx_rate | numeric(24,12) null | rate the user confirmed, kept for display and audit (income in a non-base currency) |

Envelope lines don't have to be zero-sum per entry (income adds to envelopes; expenses subtract). **Invariant E1**: for `allocation` entries they sum to 0. **Invariant R1** (§5a) ties envelopes to accounts.

### limits
`id, user_id, envelope_id null, category_id null, period_month date (first of month) null = recurring, limit_minor bigint > 0`. Always in the budget base currency (no currency column). Check: exactly one of `envelope_id` / `category_id`.

### savings_goals
`id, user_id, envelope_id → envelopes (kind savings), target_minor bigint > 0, target_date date null, archived_at`. Base currency. Progress = envelope balance / target. At most one active goal per envelope.

### AI tables
- `ai_conversations (id, user_id, created_at, title)`
- `ai_messages (id, conversation_id, user_id, role, content text, prompt_version, tokens_in, tokens_out, created_at)`
- `ai_usage (user_id, day date, messages int, tokens int, primary key (user_id, day))`, written only by the Edge Function (service role)

## 4. How entries look (examples, KZT base)

All accounts below are budgeted (`include_in_budget = true`) unless noted. `base` = `base_amount_minor`.

**Opening balance 200 000 ₸ in cash**: cash +20 000 000 (base +20 000 000) · system:opening_balance(KZT) −20 000 000 · envelope **Unallocated** +20 000 000. The user can then reallocate it.

**Income 500 000 ₸ into "Kaspi Gold", 50/30/20**
| table | account / envelope | amount_minor | base |
|---|---|---|---|
| ledger_lines | Kaspi Gold (KZT) | +50 000 000 | +50 000 000 |
| ledger_lines | system:income (KZT) | −50 000 000 | null |
| envelope_lines | Needs | +25 000 000 | |
| envelope_lines | Wants | +15 000 000 | |
| envelope_lines | Savings | +10 000 000 | |

**Income 1 000 USD into a USD card, the user confirms a rate of 505.00**: USD card +100 000 (base +50 500 000) · system:income(USD) −100 000 · envelopes split 50 500 000 ₸ (`fx_rate` = 505.00).

**Expense 12 500 ₸ groceries from cash, Needs**: cash −1 250 000 (base −1 250 000) · system:expense(KZT) +1 250 000 · envelope Needs −1 250 000.

**Expense 40 USD from the USD card** (balance 1 000 USD, book value 505 000 ₸): base = moving average = round_half_even(50 500 000 × 4 000 / 100 000) = −2 020 000 → USD card −4 000 (base −2 020 000) · system:expense(USD) +4 000 · envelope Wants −2 020 000.

**Cross-currency transfer 100 USD → 50 300 ₸** (the user enters both amounts; budgeted → budgeted):
USD card −10 000 (base −5 050 000, moving average) · system:fx_clearing(USD) +10 000 · KZT account +5 030 000 (base +5 030 000, since a base-currency account's book value always equals its balance) · system:fx_clearing(KZT) −5 030 000 · envelope **Unallocated −20 000** (the 200 ₸ realised FX difference). Each currency nets to zero and R1 holds. The effective rate 503.00 is shown for information.

**Transfer 100 000 ₸ from a budgeted card to an unbudgeted brokerage account**: card −10 000 000 (base −10 000 000) · brokerage +10 000 000 (base +10 000 000, but outside R1 because the account is unbudgeted) · envelope chosen by the user (default Unallocated) −10 000 000.

**Reversal of the 12 500 ₸ expense**: a new entry, `kind = reversal`, `reverses_entry_id` = original, `occurred_on` = the original's date. Every ledger line (including base) and every envelope line is negated. The original is never touched.

## 5a. Accounting rules (budget side)

These rules make "money in envelopes" always equal "money in budgeted accounts". Every RPC follows them, and pgTAP checks them.

- **R1 — Reconciliation invariant.** For each budget: Σ envelope_lines.amount_minor (all envelopes, including Unallocated) = Σ ledger_lines.base_amount_minor over accounts with `include_in_budget = true`. RPCs keep it inside each transaction; pgTAP checks it after every scenario; a nightly check (later) alerts on drift.
- **R2 — Book value (base amount).**
  - For an account in the base currency, base = amount.
  - Money **entering** a foreign-currency account from outside (income, opening balance, adjustment) is valued at the rate the user confirms (pre-filled from the last rate used or a reference rate).
  - Money **leaving** a foreign-currency account (expense, transfer out, negative adjustment) is valued at **moving average**: `base = round_half_even(book_value × amount / balance)`. If the amount equals the whole balance, base = the whole book value (no residue).
  - **Overdraft**: the part up to the positive balance uses the moving average; any excess (or everything, when the balance is ≤ 0) is valued at the rate the user confirms. Without a rate the operation is rejected (`rate_required`).
  - A transfer between two budgeted accounts: base-out by moving average. If the destination is in the base currency, base-in = the received amount; otherwise base-in = base-out (the book value moves with the money). The difference `base_in − base_out` (realised FX result) goes to Unallocated; it's zero for same-currency and foreign→foreign transfers.
- **R3 — Budget boundary.** Envelope lines are created only when money crosses the budget boundary:

  | Operation | Envelope effect |
  |---|---|
  | Income into a budgeted account | + split by method (auto) or by the user (manual) |
  | Income into an unbudgeted account | none |
  | Expense from a budgeted account | − chosen envelope, amount = base |
  | Expense from an unbudgeted account | none (still counted in spending reports via its base amount) |
  | Transfer budgeted ↔ budgeted | none, except the realised FX result ± Unallocated (R2) |
  | Transfer budgeted → unbudgeted | − chosen envelope (default: the account's linked envelope, else Unallocated) |
  | Transfer unbudgeted → budgeted | + chosen envelope (default Unallocated) |
  | Opening balance / adjustment on a budgeted account | ± Unallocated |
  | FX revaluation | ± Unallocated |

  Deposit accounts linked to a savings envelope are budgeted by default. Moving money checking → deposit doesn't change envelopes; the money stays in the savings envelope.
- **R4 — FX revaluation** (foreign-currency accounts only; manual in v1, the "Update to current rate" action): a `fx_revaluation` entry with one line on the account, `amount_minor = 0`, `base_amount_minor = target_book_value − current_book_value`, plus the same amount on Unallocated. No automatic revaluation in v1. Balances in other currencies shown in base currency on Home use the latest rate and are marked "≈".
- **R5 — Reversals.** Negate every ledger line (amount and base) and every envelope line of the original, keep the original's `occurred_on`. Reports leave out both the reversed entry and its reversal, so past months show corrected figures. An "edit" in the UI = reversal + new entry in one RPC call (`api.amend_entry`).
- **R6 — Manual allocation.** The parts must be ≥ 0 and sum to ≤ the base amount; any remainder goes to Unallocated. Auto allocation is exact (§5).
- **R7 — Base currency.** The budget base currency is fixed once the first entry exists (v1). Changing it later needs a dedicated "rebase" operation (post-v1).
- **R8 — Overspending.** Envelope balances can go negative (EXP-3); Unallocated can go negative only through revaluation or adjustments, and the UI prompts the user to cover it.

## 5. Allocation algorithm (authoritative in SQL, mirrored in TS)

Largest-remainder (Hamilton) method on integer minor units:
1. For each envelope i (ordered by `sort_order`): `exact_i = total * bps_i`; `base_i = floor(exact_i / 10000)`; `rem_i = exact_i mod 10000`.
2. `leftover = total − Σ base_i` (0 ≤ leftover < number of envelopes).
3. Give +1 minor unit to the `leftover` envelopes with the largest `rem_i`; ties go to the lower `sort_order`.
4. Result: `Σ parts = total` exactly. Negative totals are rejected.

Test vectors live in `supabase/fixtures/allocation.json`, e.g. `{ total: 100, bps: [3333,3333,3334] } → [33,33,34]`, `{ total: 1, bps: [5000,3000,2000] } → [1,0,0]`.

FX conversion for envelope tracking: `round_half_even(source_minor * rate * 10^(base_minor_units − source_minor_units))`.

## 6. Views (security_invoker = true, so RLS applies)

Amounts leave the database as **text** (CLAUDE.md rule 1): PostgREST serialises `bigint` as a JSON number, which loses precision above 2^53. Every view and read RPC casts its amount columns to `text`.

```sql
create view public.account_balances with (security_invoker = true) as
  select a.id as account_id, a.user_id, a.currency, a.include_in_budget,
         coalesce(sum(l.amount_minor), 0)::text      as balance_minor,
         coalesce(sum(l.base_amount_minor), 0)::text as book_value_minor
  from public.accounts a left join public.ledger_lines l on l.account_id = a.id
  where a.kind <> 'system'
  group by a.id;

-- envelope_balances: sum(envelope_lines)::text per envelope
-- reportable_entries: entries that are neither reversed nor reversals (R5);
--   all report views build on it
-- monthly_summary: per user and month, income and expense totals in base currency.
--   Always from ledger_lines.base_amount_minor of user accounts (budgeted or not).
--   Transfers, allocations, revaluations and adjustments are not income or expense.
-- category_monthly: expense totals per category per month
```

If history grows large, add a `balance_snapshots` table refreshed by trigger or materialised per month. Not needed in v1.

## 7. Row Level Security

Pattern for every user-owned table:

```sql
alter table public.accounts enable row level security;

create policy "accounts_select_own" on public.accounts
  for select to authenticated
  using (user_id = (select auth.uid()));
-- (select auth.uid()) is wrapped so it's evaluated once per statement (performance)
```

| Table | select | insert | update | delete |
|---|---|---|---|---|
| currencies | authenticated: all | — | — | — |
| profiles | own | trigger only | own: locale, theme, timezone, display_name, ai_consent_at (column grants) | via delete-account fn |
| budgets, envelopes, accounts, categories, limits, savings_goals | own | via RPC | via RPC | — (archive via RPC) |
| ledger_entries, ledger_lines, envelope_lines | own | **RPC only** | **never** | **never** (cascade on user delete only) |
| ai_conversations, ai_messages | own | Edge Function (service role) | — | own (clear history) |
| ai_usage | own | service role | service role | — |

Hardening:
- `revoke insert, update, delete on ledger_* , envelope_lines from authenticated, anon;`
- A `before update or delete` trigger on ledger tables always rejects UPDATE. It rejects DELETE unless `current_setting('umani.purge_user', true) = old.user_id::text`. Only `private.purge_user(p_user_id)` sets that flag (`set_config(..., true)`, transaction-local). It's `security definer`, executable by `service_role` only, deletes the user's rows explicitly, and is called by the `delete-account` Edge Function right before it deletes the `auth.users` row. The flag is defence in depth, not the main control: `authenticated` has no DELETE grant on ledger tables at all, so setting the flag from a client session achieves nothing (a pgTAP test covers this).
- `revoke execute on all functions in schema api from anon, public; grant execute … to authenticated;`
- Security definer functions: `set search_path = ''`, fully qualified names, `auth.uid()` null check first.

## 8. RPC catalogue (`api` schema)

The `api` schema isn't exposed by default: add it to `[api] schemas` in `supabase/config.toml` (and in the project's API settings for staging/production). The client calls `supabase.schema('api').rpc(...)`. Keep `public` for tables and views only.

All mutating RPCs take `p_idempotency_key uuid` and return the entry/row id. The function hashes its canonical parameters: same key + same hash → returns the existing id (safe retry); same key + different hash → raises `idempotency_conflict`. Amount parameters are `text`, parsed to `bigint` with validation (integer digits only, > 0, ≤ 10^15). Rates are `text` decimal strings parsed to `numeric`.

| Function | Purpose | Key checks |
|---|---|---|
| `setup_budget(p_method, p_base_currency, p_custom jsonb)` | Create budget + envelopes + unallocated envelope + default categories | one active budget; bps sum 10000 |
| `change_budget_method(p_method, p_custom, p_reassign jsonb)` | Switch method; move balances of removed envelopes | allocation entry zero-sum |
| `create_account(p_name, p_kind, p_currency, p_opening_minor, p_linked_envelope)` | Account + opening balance entry | currency supported; envelope owned |
| `archive_account(p_account_id)` | Archive | owned |
| `record_income(p_account_id, p_amount, p_occurred_on, p_category_id, p_allocation jsonb null, p_fx_rate, p_note, p_idempotency_key)` | Income + allocation (auto or manual) | manual parts ≥ 0, sum ≤ base amount, remainder → Unallocated (R6) |
| `record_expense(p_account_id, p_envelope_id, p_amount, p_occurred_on, p_category_id, p_fx_rate, p_note, p_idempotency_key)` | Expense | all ids owned; same budget; envelope required only for budgeted accounts (R3) |
| `record_transfer(p_from, p_to, p_amount_from, p_amount_to, p_envelope_id null, p_occurred_on, p_note, p_idempotency_key)` | Internal transfer (same or cross currency) | from ≠ to; same-currency ⇒ amounts equal; envelope used when crossing the budget boundary (R3) |
| `reallocate(p_from_envelope, p_to_envelope, p_amount, p_idempotency_key)` | Move budget between envelopes | same budget |
| `record_adjustment(p_account_id, p_target_balance, p_fx_rate, p_idempotency_key)` | Reconciliation | diff entry vs system:adjustment; ± Unallocated |
| `record_revaluation(p_account_id, p_rate, p_idempotency_key)` | FX revaluation (R4) | foreign-currency budgeted account only |
| `reverse_entry(p_entry_id, p_idempotency_key)` | Undo/delete (R5) | not already reversed; not a reversal itself |
| `amend_entry(p_entry_id, p_new jsonb, p_idempotency_key)` | Edit = reversal + new entry, atomically | as above + validation of the new entry |
| `set_limit(...)` / `set_savings_goal(...)` / `create_category(...)` / `update_profile(...)` | Metadata | ownership |
| `report_monthly(p_month)` / `report_yearly(p_year)` | Read aggregates (security invoker) | RLS |

## 9. Testing (pgTAP, `supabase/tests`)

- RLS matrix: for each table, user A can see own rows, can't see user B's rows, and can't insert/update/delete directly where forbidden; anon sees nothing.
- Invariants: an unbalanced entry fails at commit; UPDATE/DELETE on ledger tables fails; a line currency ≠ account currency fails.
- RPCs: happy paths; foreign-owned ids rejected; idempotency (same key + same params → one entry; same key + different params → `idempotency_conflict`); reversal twice rejected; allocation fixtures parity.
- Reconciliation properties after every scenario: for each user and currency, Σ ledger_lines over all accounts (including system) = 0 (L1); for each budget, envelopes = book value of budgeted accounts (R1); a base-currency account's book value = its balance.
- FX scenarios from §4 (income at a confirmed rate, moving-average expense, cross-currency transfer with FX result, revaluation) as fixtures shared with Jest (`supabase/fixtures/fx.json`).

## 10. Migrations

- `supabase/migrations/<timestamp>_<name>.sql`, forward-only, reviewed by ECC `database-reviewer`.
- Order for Milestone 1: `0001_reference` (currencies, enums) → `0002_profiles` → `0003_budget` (budgets, envelopes, categories, limits, savings_goals) → `0004_accounts_ledger` → `0005_rpc_core` → `0006_views`.
- Not modelled in v1 (see PRD non-goals): debts/loans as their own entity, recurring transactions, split expenses. The schema already allows several envelope lines per entry, so splits need only a new RPC later.
- Generate TS types with `supabase gen types typescript --local > src/lib/supabase/database.types.ts`.
- Applied only to the **local** stack until the user approves creating cloud projects.
