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
| kind | enum `entry_kind` | `opening_balance`, `income`, `expense`, `transfer`, `allocation`, `adjustment`, `reversal` |
| occurred_on | date | |
| category_id | uuid null | |
| note | text null | max 500 chars; **never sent to AI** |
| reverses_entry_id | uuid null unique → ledger_entries | at most one reversal per entry |
| idempotency_key | uuid not null | `unique (user_id, idempotency_key)` |
| created_at | timestamptz | |

### ledger_lines (money movements — append-only)
| column | type | notes |
|---|---|---|
| id | uuid | |
| entry_id | uuid → ledger_entries | |
| user_id | uuid | denormalised for RLS/indexing |
| account_id | uuid → accounts | |
| amount_minor | bigint, ≠ 0 | signed: + increases the account |
| currency | char(3) | must equal the account currency (trigger) |

**Invariant L1**: for each entry and currency, `sum(amount_minor) = 0`. A deferred constraint trigger checks it at commit.

### envelope_lines (budget movements — append-only)
| column | type | notes |
|---|---|---|
| id, entry_id, user_id | | |
| envelope_id | uuid → envelopes | |
| amount_minor | bigint ≠ 0 | in the budget's base currency |
| fx_rate | numeric(24,12) null | source→base rate used when the source currency ≠ base |

Envelope balances are budget-side and don't need to be zero-sum per entry (income adds to envelopes; expenses subtract). **Invariant E1** for `allocation` entries: lines sum to 0 (moving money between envelopes).

### limits
`id, user_id, envelope_id null, category_id null, period_month date (first of month) null = recurring, limit_minor bigint > 0, currency`. Check: exactly one of `envelope_id` / `category_id`.

### AI tables
- `ai_conversations (id, user_id, created_at, title)`
- `ai_messages (id, conversation_id, user_id, role, content text, prompt_version, tokens_in, tokens_out, created_at)`
- `ai_usage (user_id, day date, messages int, tokens int, primary key (user_id, day))`, written only by the Edge Function (service role)

## 4. How entries look (examples, KZT base)

**Income 500 000 ₸ into "Kaspi Gold", 50/30/20**
| table | account / envelope | amount_minor |
|---|---|---|
| ledger_lines | Kaspi Gold (KZT) | +50 000 000 |
| ledger_lines | system:income (KZT) | −50 000 000 |
| envelope_lines | Needs | +25 000 000 |
| envelope_lines | Wants | +15 000 000 |
| envelope_lines | Savings | +10 000 000 |

**Expense 12 500 ₸ groceries from cash, Needs**: cash −1 250 000 · system:expense +1 250 000 · envelope Needs −1 250 000.

**Cross-currency transfer 100 USD → 50 300 ₸** (the user enters both amounts):
USD card −10 000 · system:fx_clearing(USD) +10 000 · KZT account +5 030 000 · system:fx_clearing(KZT) −5 030 000. Each currency nets to zero. The effective rate 503.00 is derived for display. Transfers between budgeted accounts create no envelope lines.

**Reversal**: a new entry with `reverses_entry_id`, every line negated. The original is never touched.

## 5. Allocation algorithm (authoritative in SQL, mirrored in TS)

Largest-remainder (Hamilton) method on integer minor units:
1. For each envelope i (ordered by `sort_order`): `exact_i = total * bps_i`; `base_i = floor(exact_i / 10000)`; `rem_i = exact_i mod 10000`.
2. `leftover = total − Σ base_i` (0 ≤ leftover < number of envelopes).
3. Give +1 minor unit to the `leftover` envelopes with the largest `rem_i`; ties go to the lower `sort_order`.
4. Result: `Σ parts = total` exactly. Negative totals are rejected.

Test vectors live in `supabase/fixtures/allocation.json`, e.g. `{ total: 100, bps: [3333,3333,3334] } → [33,33,34]`, `{ total: 1, bps: [5000,3000,2000] } → [1,0,0]`.

FX conversion for envelope tracking: `round_half_even(source_minor * rate * 10^(base_minor_units − source_minor_units))`.

## 6. Views (security_invoker = true, so RLS applies)

```sql
create view public.account_balances with (security_invoker = true) as
  select a.id as account_id, a.user_id, a.currency,
         coalesce(sum(l.amount_minor), 0)::bigint as balance_minor
  from public.accounts a left join public.ledger_lines l on l.account_id = a.id
  where a.kind <> 'system'
  group by a.id;

-- envelope_balances: sum(envelope_lines) per envelope
-- monthly_summary: per user, month, kind (income/expense) totals in base currency (from envelope_lines + entry kind)
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
| budgets, envelopes, accounts, categories, limits | own | via RPC | via RPC | — (archive via RPC) |
| ledger_entries, ledger_lines, envelope_lines | own | **RPC only** | **never** | **never** (cascade on user delete only) |
| ai_conversations, ai_messages | own | Edge Function (service role) | — | own (clear history) |
| ai_usage | own | service role | service role | — |

Hardening:
- `revoke insert, update, delete on ledger_* , envelope_lines from authenticated, anon;`
- A `before update or delete` trigger on ledger tables raises an exception unless the session is the cascade from `auth.users` deletion.
- `revoke execute on all functions in schema api from anon, public; grant execute … to authenticated;`
- Security definer functions: `set search_path = ''`, fully qualified names, `auth.uid()` null check first.

## 8. RPC catalogue (`api` schema)

All mutating RPCs take `p_idempotency_key uuid` and return the entry/row id. On a duplicate key they return the existing id (idempotent). Amount parameters are `text` and are parsed to `bigint` with validation (no decimals, > 0, ≤ 10^15).

| Function | Purpose | Key checks |
|---|---|---|
| `setup_budget(p_method, p_base_currency, p_custom jsonb)` | Create budget + envelopes + unallocated envelope + default categories | one active budget; bps sum 10000 |
| `change_budget_method(p_method, p_custom, p_reassign jsonb)` | Switch method; move balances of removed envelopes | allocation entry zero-sum |
| `create_account(p_name, p_kind, p_currency, p_opening_minor, p_linked_envelope)` | Account + opening balance entry | currency supported; envelope owned |
| `archive_account(p_account_id)` | Archive | owned |
| `record_income(p_account_id, p_amount, p_occurred_on, p_category_id, p_allocation jsonb null, p_fx_rate, p_note, p_idempotency_key)` | Income + allocation (auto or manual) | manual parts sum = converted total |
| `record_expense(p_account_id, p_envelope_id, p_amount, p_occurred_on, p_category_id, p_fx_rate, p_note, p_idempotency_key)` | Expense | all ids owned; same budget |
| `record_transfer(p_from, p_to, p_amount_from, p_amount_to, p_occurred_on, p_note, p_idempotency_key)` | Internal transfer (same or cross currency) | from ≠ to; same-currency ⇒ amounts equal |
| `reallocate(p_from_envelope, p_to_envelope, p_amount, p_idempotency_key)` | Move budget between envelopes | same budget |
| `record_adjustment(p_account_id, p_target_balance, p_idempotency_key)` | Reconciliation | creates diff entry vs system:adjustment |
| `reverse_entry(p_entry_id, p_idempotency_key)` | Undo/edit support | not already reversed; not a reversal itself |
| `set_limit(...)` / `create_category(...)` / `update_profile(...)` | Metadata | ownership |
| `report_monthly(p_month)` / `report_yearly(p_year)` | Read aggregates (security invoker) | RLS |

## 9. Testing (pgTAP, `supabase/tests`)

- RLS matrix: for each table, user A can see own rows, can't see user B's rows, and can't insert/update/delete directly where forbidden; anon sees nothing.
- Invariants: an unbalanced entry fails at commit; UPDATE/DELETE on ledger tables fails; a line currency ≠ account currency fails.
- RPCs: happy paths; foreign-owned ids rejected; idempotency (same key twice → one entry); reversal twice rejected; allocation fixtures parity.
- Reconciliation property: for each user and currency, Σ ledger_lines over all accounts (including system) = 0.

## 10. Migrations

- `supabase/migrations/<timestamp>_<name>.sql`, forward-only, reviewed by ECC `database-reviewer`.
- Order for Milestone 1: `0001_reference` (currencies, enums) → `0002_profiles` → `0003_budget` → `0004_accounts_ledger` → `0005_rpc_core` → `0006_views`.
- Generate TS types with `supabase gen types typescript --local > src/lib/supabase/database.types.ts`.
- Applied only to the **local** stack until the user approves creating cloud projects.
