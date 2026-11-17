import { describe, expect, it } from '@jest/globals';

import { money } from '../money/money';
import { checkEntry } from './invariants';
import type { EntryDraft, LedgerLine } from './types';

const kzt = (n: bigint) => money(n, 'KZT');
const usd = (n: bigint) => money(n, 'USD');
const user = (accountId: string) => ({ type: 'user' as const, accountId });
const sys = (role: 'income' | 'expense' | 'fx_clearing') => ({ type: 'system' as const, role });

const userIncomeLine: LedgerLine<string> = { account: user('a'), amount: kzt(100n), base: kzt(100n) };
const systemIncomeLine: LedgerLine<string> = { account: sys('income'), amount: kzt(-100n), base: null };

const balanced: EntryDraft<string, string> = {
  kind: 'income',
  lines: [userIncomeLine, systemIncomeLine],
  envelopeLines: [{ envelopeId: 'e', amount: kzt(100n) }],
};

describe('checkEntry (L1 and line shape)', () => {
  it('accepts a balanced entry', () => {
    expect(checkEntry(balanced, 'KZT')).toEqual({ ok: true, value: undefined });
  });

  it('L1: lines must sum to zero per currency', () => {
    const entry: EntryDraft<string, string> = {
      ...balanced,
      lines: [
        { account: user('a'), amount: usd(-100n), base: kzt(-50_000n) },
        { account: user('b'), amount: kzt(50_000n), base: kzt(50_000n) },
        { account: sys('fx_clearing'), amount: usd(100n), base: null },
        { account: sys('fx_clearing'), amount: kzt(-49_999n), base: null },
      ],
    };
    expect(checkEntry(entry, 'KZT')).toEqual({ ok: false, error: { code: 'unbalanced', currency: 'KZT', sum: 1n } });
  });

  it('rejects zero-amount lines except in a revaluation', () => {
    const zero: EntryDraft<string, string> = {
      ...balanced,
      lines: [...balanced.lines, { account: user('c'), amount: kzt(0n), base: kzt(0n) }],
    };
    expect(checkEntry(zero, 'KZT')).toEqual({ ok: false, error: { code: 'zero_line', index: 2 } });

    const revaluation: EntryDraft<string, string> = {
      kind: 'fx_revaluation',
      lines: [{ account: user('a'), amount: usd(0n), base: kzt(500n) }],
      envelopeLines: [{ envelopeId: 'u', amount: kzt(500n) }],
    };
    expect(checkEntry(revaluation, 'KZT').ok).toBe(true);
  });

  it('user lines carry a base amount in the base currency; system lines carry none', () => {
    const missing: EntryDraft<string, string> = {
      ...balanced,
      lines: [{ ...userIncomeLine, base: null }, systemIncomeLine],
    };
    expect(checkEntry(missing, 'KZT')).toEqual({ ok: false, error: { code: 'base_missing', index: 0 } });

    const onSystem: EntryDraft<string, string> = {
      ...balanced,
      lines: [userIncomeLine, { ...systemIncomeLine, base: kzt(-100n) }],
    };
    expect(checkEntry(onSystem, 'KZT')).toEqual({ ok: false, error: { code: 'base_on_system_line', index: 1 } });

    const wrongBase: EntryDraft<string, string> = {
      ...balanced,
      lines: [{ ...userIncomeLine, base: usd(100n) }, systemIncomeLine],
    };
    expect(checkEntry(wrongBase, 'KZT')).toEqual({ ok: false, error: { code: 'base_currency_mismatch', index: 0 } });
  });

  it('envelope lines are non-zero and in the base currency', () => {
    expect(checkEntry({ ...balanced, envelopeLines: [{ envelopeId: 'e', amount: kzt(0n) }] }, 'KZT')).toEqual({
      ok: false,
      error: { code: 'zero_envelope_line', index: 0 },
    });
    expect(checkEntry({ ...balanced, envelopeLines: [{ envelopeId: 'e', amount: usd(1n) }] }, 'KZT')).toEqual({
      ok: false,
      error: { code: 'envelope_currency_mismatch', index: 0 },
    });
  });

  it('E1: allocation entries move budget without creating it', () => {
    const allocation: EntryDraft<string, string> = {
      kind: 'allocation',
      lines: [],
      envelopeLines: [
        { envelopeId: 'a', amount: kzt(-5n) },
        { envelopeId: 'b', amount: kzt(4n) },
      ],
    };
    expect(checkEntry(allocation, 'KZT')).toEqual({ ok: false, error: { code: 'allocation_unbalanced' } });
  });

  it('rejects empty entries', () => {
    expect(checkEntry({ kind: 'income', lines: [], envelopeLines: [] }, 'KZT')).toEqual({
      ok: false,
      error: { code: 'empty_entry' },
    });
  });
});
