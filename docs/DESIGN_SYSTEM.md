# UMANI — Design System

Status: Draft v0.1 · Inspiration: Apple HIG, Linear, modern fintech (calm, precise, numbers-first)

## 1. Principles

1. **Numbers are the hero.** Amounts are large, tabular and never truncated. Everything else steps back.
2. **Quiet chrome.** Neutral surfaces, one accent, colour used only for meaning (income, over-budget, savings).
3. **Native feel.** System font (SF Pro), native tabs, sheets, haptics, SF Symbols, Liquid Glass where the OS provides it (`expo-glass-effect`, with a fallback to solid surfaces).
4. **Calm motion.** Short, physical, purposeful; respects Reduce Motion.
5. **Inclusive by default.** Dynamic Type, VoiceOver, AA contrast in both themes, three languages.

## 2. Tokens (`src/ui/tokens`)

Tokens are semantic. Components never use raw hex values. The template's `src/constants/theme.ts` gets replaced in Milestone 1.

### 2.1 Colour — semantic

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg.canvas` | `#FFFFFF` | `#000000` | screen background |
| `bg.grouped` | `#F5F5F7` | `#0B0B0D` | grouped list background |
| `bg.surface` | `#FFFFFF` | `#161618` | cards, sheets |
| `bg.surfaceRaised` | `#FAFAFB` | `#1E1E21` | nested cards, inputs |
| `border.subtle` | `#E6E6EA` | `#2A2A2E` | hairlines (StyleSheet.hairlineWidth) |
| `text.primary` | `#0A0A0B` | `#F5F5F7` | |
| `text.secondary` | `#5B5D66` | `#A1A3AB` | labels |
| `text.tertiary` | `#8E9099` | `#6E7079` | captions, placeholders |
| `accent.default` | `#0E7C66` | `#2BC4A0` | UMANI jade: primary actions, selection |
| `accent.subtle` | `#E6F4F0` | `#0F2A24` | accent backgrounds |
| `positive` | `#1A7F37` | `#3FB950` | income, under budget |
| `negative` | `#C9372C` | `#FF6B5E` | expense emphasis, over budget |
| `warning` | `#B26B00` | `#F0B429` | approaching limit (≥ 80%) |
| `savings` | `#3B5BDB` | `#7B93FF` | savings envelopes and deposits |

Envelope palette (charts and envelope chips), checked for colour-blind distinction and AA on both backgrounds: `jade #0E7C66`, `indigo #3B5BDB`, `amber #C77700`, `rose #C2255C`, `violet #7048E8`, `teal #0B7285`, `slate #495057`, plus 5 more for custom budgets (validate with the `dataviz` skill palette validator in Milestone 1).

The accent is a draft. Finalise it with the brand identity (open question in the PRD). All pairs must pass WCAG 2.2 AA (4.5:1 text, 3:1 large text/UI).

### 2.2 Typography

System font via `Fonts.sans` (SF Pro on iOS). All amounts use **tabular numerals** (`fontVariant: ['tabular-nums']`).

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 40 / 44 | 700 | total balance on Home |
| `amountL` | 28 / 34 | 600 | account/envelope detail amount |
| `title1` | 28 / 34 | 700 | screen titles (large title) |
| `title2` | 22 / 28 | 600 | section headers |
| `headline` | 17 / 22 | 600 | list primary |
| `body` | 17 / 22 | 400 | |
| `callout` | 16 / 21 | 400 | |
| `subhead` | 15 / 20 | 400 | secondary rows |
| `footnote` | 13 / 18 | 400 | captions |
| `caption` | 12 / 16 | 500 | chips, labels (sentence case, no all-caps for ru/kk) |

All text scales with Dynamic Type (`allowFontScaling`, `maxFontSizeMultiplier` ≈ 1.6 for amounts, so layouts reflow to two lines rather than truncate).

### 2.3 Spacing, radius, elevation

- Spacing (4-pt grid): `0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 56, 72`. Screen horizontal padding: 20 (16 on SE-width).
- Radius: `sm 8` (chips, inputs), `md 12` (rows), `lg 16` (cards), `xl 24` (sheets), `full` (pills). Use continuous corners (`borderCurve: 'continuous'`).
- Elevation: light mode uses very soft shadows (`0 1 2 rgba(0,0,0,0.04)`, `0 8 24 rgba(0,0,0,0.06)`); dark mode uses surface steps and hairlines, no shadows.

### 2.4 Motion

- Durations: `fast 120ms`, `base 200ms`, `slow 320ms`. Springs for sheets and number changes (Reanimated 4).
- Number roll animation when a balance changes (≤ 400ms); instant when Reduce Motion is on.
- Haptics: `selection` on segmented changes, `success` after saving a transaction, `warning` on an over-budget save.

### 2.5 Iconography

SF Symbols via `expo-symbols` (iOS), with a mapped fallback set for other platforms. Category icons: a curated SF Symbol list per default category. Stroke weight matches text weight.

## 3. Components (`src/ui`)

| Component | Notes |
|---|---|
| `Text` | Variant-driven (`variant="headline"`), colour token prop, i18n-ready |
| `AmountText` | Takes `Money`; formats per locale; sign/colour modes (`neutral` \| `signed` \| `income/expense`); tabular; accessible label spoken in full ("двенадцать тысяч пятьсот тенге") |
| `AmountInput` | Custom keypad sheet (no system keyboard decimal ambiguity), currency-aware decimals, parses into `Money`, large display |
| `Surface` / `Card` | Token background, radius, optional glass variant |
| `ListRow` / `ListSection` | Inset grouped style like iOS Settings; leading icon, title, subtitle, trailing amount/chevron |
| `Button` | `primary`, `secondary`, `ghost`, `destructive`; sizes `L` (52pt) and `M` (44pt); min touch target 44×44 |
| `SegmentedControl` | Income / Expense / Transfer switch |
| `EnvelopeCard` | Name, balance, progress vs limit (bar), state colours |
| `ProgressBar` / `RingProgress` | Budget usage; 80% warning, >100% negative with overflow indicator |
| `AccountSwitcher` | Horizontal chips or menu: All + accounts; shows currency |
| `CurrencyPicker` | 5 supported currencies with flags off by default (symbols + codes) |
| `Sheet` | Expo Router modal / form sheet presentation with detents |
| `EmptyState` | Illustration-free: SF Symbol + one line + primary action |
| `Chart` primitives | Bar (monthly income vs expense), donut (by envelope), line (savings). Library choice in the Stats milestone (Victory Native / Skia, checked against SDK 58) |
| `Disclaimer` | Advisor footer, standing text |
| `Toast` | Non-blocking confirmations with Undo (fires `reverse_entry`) |
| `LockScreen` | App lock (Face ID / passcode prompt), app-switcher blur overlay |
| `MaskedAmount` | Mode of `AmountText` when "hide balances" is on (`•••• ₸`), VoiceOver says "hidden" |
| `UnallocatedBanner` | Shows money waiting in Unallocated (or a negative Unallocated) with an "Assign" action |
| `GoalProgress` | Savings goal: progress ring, target, date, required monthly contribution |
| `BookValueHint` | For foreign-currency accounts: book value vs "≈" current value, "Update to current rate" action |

Each component has: typed props, light/dark support, Dynamic Type check, VoiceOver label/role, and an RNTL test for interactive behaviour.

## 4. Key screens (wireframe intent)

- **Home**: large total balance (base currency, "≈" when converting; eye icon to hide balances), account switcher (opens the accounts list; accounts aren't a tab), Unallocated banner when needed, envelope cards (horizontal scroll or grid), "This month" income vs expense, recent transactions, a floating "+" for the new-transaction sheet.
- **New transaction sheet**: segmented type → AmountInput → account → envelope/category (smart default from category) → date → note → Save. For income: allocation preview with an "Edit split" toggle.
- **Budget**: method header (e.g. 50/30/20 with a segmented bar), envelope list with balance and monthly limit progress, "Deposits plan" entry card.
- **Deposits plan**: recommended accounts with suggested name, %, monthly amount, an explanation and "Mark as opened"; savings goals per envelope.
- **Stats**: month/year switcher, income vs expense bars, envelope performance table, savings line.
- **Advisor**: consent screen (first use), chat with suggested prompts, lessons carousel, persistent disclaimer.

## 5. Localisation & formatting

| Aspect | ru | kk | en |
|---|---|---|---|
| Group / decimal | `12 500,50` (narrow NBSP U+202F, comma) | `12 500,50` | `12,500.50` |
| KZT, RUB | `12 500 ₸` (NBSP before the symbol) | `12 500 ₸` | `12,500 ₸` (decided in M1c: trailing, for consistency) |
| USD, EUR, CNY | `12 500,50 $` | `12 500,50 $` | `$12,500.50` |
| Negative / income | `−1 250 ₸` (U+2212) / `+1 250 ₸` | same | `−$12.50` / `+$12.50` |
| Dates | `17 ноября 2026 г.` | `2026 ж. 17 қараша` | `November 17, 2026` |
| Plurals | one/few/many/other | one/other | one/other |

Implementation (M1c, from the Hermes spike on iOS/Expo Go SDK 58): money is formatted by `src/domain/money/format.ts` without `Intl` (Hermes prints `12 500,50 KZT` in ru and `KZT 12,500.50` in en); its output parses back with `parseMoney`. Dates may use `Intl.DateTimeFormat` (Hermes output above is correct for kk/ru/en). Hermes has **no `Intl.PluralRules`**; `src/lib/i18n/plural-rules.ts` installs a CLDR polyfill for ru/kk/en, tested against Node's ICU. `AmountText` reads amounts in full for VoiceOver ("минус 5 долларов").

- Hide trailing `,00` for whole amounts in lists; show full precision in detail and input.
- Russian and Kazakh strings run 20–40% longer than English. Design for the longest, no fixed-width labels.
- Kazakh uses Cyrillic in v1 (the Latin-script transition is tracked as future work).
- Keys: `feature.screen.element` (e.g. `budget.method.title`). Envelope and category defaults come from `name_key`.

## 6. Accessibility checklist (per screen)

- [ ] All interactive elements ≥ 44×44 pt with `accessibilityRole` + label
- [ ] Amounts read in full with currency; signs spoken ("expense", "income")
- [ ] Dynamic Type up to AX3 without clipping amounts
- [ ] Contrast AA in light and dark
- [ ] Meaning never by colour alone (icons/labels for over-budget)
- [ ] Reduce Motion and Reduce Transparency respected (glass → solid)
- [ ] Focus order logical in sheets; VoiceOver escape closes sheets
