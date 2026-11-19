import { describe, expect, it } from '@jest/globals';

import { money } from '@/domain/money/money';

import { AccountRowSchema, formatDay, formatRate, rateFromInput, toAccount, toAccountError, todayIso, type AccountRow } from './account';

const ROW: AccountRow = {
  account_id: '11111111-1111-4111-8111-111111111111',
  name: 'Dollars',
  kind: 'cash',
  currency: 'USD',
  include_in_budget: true,
  linked_envelope_id: null,
  archived_at: null,
  balance_minor: '10050',
  book_value_minor: '4800000',
};

describe('toAccount', () => {
  it('maps a view row to an account with money in the right currencies', () => {
    expect(toAccount(ROW, 'KZT')).toEqual({
      ok: true,
      value: {
        id: ROW.account_id,
        name: 'Dollars',
        kind: 'cash',
        currency: 'USD',
        includeInBudget: true,
        linkedEnvelopeId: null,
        archived: false,
        balance: money(10_050n, 'USD'),
        bookValue: money(4_800_000n, 'KZT'),
      },
    });
  });

  it('treats a missing sum (no lines yet) as zero', () => {
    const result = toAccount({ ...ROW, balance_minor: null, book_value_minor: null }, 'KZT');
    expect(result.ok && result.value.balance).toEqual(money(0n, 'USD'));
  });

  it('keeps large amounts exact and rejects ones beyond the domain limit instead of rounding', () => {
    const big = toAccount({ ...ROW, currency: 'KZT', balance_minor: '900719925474099' }, 'KZT');
    expect(big.ok && big.value.balance.amountMinor).toBe(900_719_925_474_099n);
    expect(toAccount({ ...ROW, currency: 'KZT', balance_minor: '900719925474099312' }, 'KZT').ok).toBe(false);
  });

  it.each([
    ['an unknown currency', { currency: 'GBP' }],
    ['a non-integer amount', { balance_minor: '1.5' }],
  ])('rejects %s', (_label, patch) => {
    expect(toAccount({ ...ROW, ...patch }, 'KZT')).toEqual({ ok: false, error: 'invalid_row' });
  });

  it('marks archived accounts', () => {
    const result = toAccount({ ...ROW, archived_at: '2026-11-19T10:00:00Z' }, 'KZT');
    expect(result.ok && result.value.archived).toBe(true);
  });

  it('the schema rejects system accounts and JSON-number amounts', () => {
    expect(AccountRowSchema.safeParse({ ...ROW, kind: 'system' }).success).toBe(false);
    expect(AccountRowSchema.safeParse({ ...ROW, balance_minor: 10050 }).success).toBe(false);
  });
});

describe('toAccountError', () => {
  it('passes known codes through and maps the rest to failed', () => {
    expect(toAccountError('rate_required')).toBe('rate_required');
    expect(toAccountError('same_account')).toBe('same_account');
    expect(toAccountError('reconciliation_gap')).toBe('failed');
    expect(toAccountError(undefined)).toBe('failed');
  });
});

describe('todayIso', () => {
  it('uses the device calendar date', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('rateFromInput', () => {
  it.each([
    ['475,5', '475.5'],
    [' 475.50 ', '475.50'],
    ['1 234,5', '1234.5'],
    ['0,0021', '0.0021'],
  ])('%s → %s', (input, expected) => {
    expect(rateFromInput(input)).toBe(expected);
  });

  it.each(['', '0', '0,000', '-5', '4,7,5', 'abc', '1e3'])('rejects %p', (input) => {
    expect(rateFromInput(input)).toBeNull();
  });
});

describe('formatDay / formatRate', () => {
  it('formats a day as DD.MM.YYYY', () => {
    expect(formatDay('2026-11-09')).toBe('09.11.2026');
  });
  it('uses a comma in ru and kk', () => {
    expect(formatRate('444.16', 'ru')).toBe('444,16');
    expect(formatRate('444.16', 'kk')).toBe('444,16');
    expect(formatRate('444.16', 'en')).toBe('444.16');
  });
});
