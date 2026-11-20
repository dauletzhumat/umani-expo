import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

import { money } from '@/domain/money/money';
import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { amendExpense, recordExpense } from '../api/expenses';
import type { ExpenseAccount, HistoryItem } from '../model/expense';
import { ExpenseScreen } from './expense-screen';

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000004' }));

jest.mock('../api/expenses', () => {
  const { money: m } = jest.requireActual<typeof import('@/domain/money/money')>('@/domain/money/money');
  return {
    recordExpense: jest.fn(async () => ({ ok: true, value: 'entry' })),
    amendExpense: jest.fn(async () => ({ ok: true, value: undefined })),
    reverseEntry: jest.fn(async () => ({ ok: true, value: undefined })),
    useRefreshAfterExpenseWrite: () => async () => undefined,
    useExpenseRate: () => ({ data: undefined }),
    useCategories: () => ({
      data: [
        { id: 'cat-food', kind: 'expense', name: null, nameKey: 'category.groceries', defaultEnvelopeId: 'needs' },
        { id: 'cat-fun', kind: 'expense', name: 'Cinema', nameKey: null, defaultEnvelopeId: null },
        { id: 'cat-salary', kind: 'income', name: null, nameKey: 'category.salary', defaultEnvelopeId: null },
      ],
    }),
    useSpendEnvelopes: () => ({
      data: [
        { id: 'needs', name: null, nameKey: 'envelope.needs', kind: 'needs', balance: m(500_000n, 'KZT') },
        { id: 'wants', name: null, nameKey: 'envelope.wants', kind: 'wants', balance: m(10_000n, 'KZT') },
      ],
    }),
  };
});

const recordMock = jest.mocked(recordExpense);
const amendMock = jest.mocked(amendExpense);

const CASH: ExpenseAccount = {
  id: 'cash',
  name: 'Cash',
  currency: 'KZT',
  includeInBudget: true,
  balance: money(1_000_000n, 'KZT'),
  bookValue: money(1_000_000n, 'KZT'),
};

async function renderExpense(props: Partial<Parameters<typeof ExpenseScreen>[0]> = {}) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>
        <ExpenseScreen
          userId="u"
          base="KZT"
          accounts={[CASH]}
          onManageCategories={() => undefined}
          onDone={() => undefined}
          {...props}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('ExpenseScreen', () => {
  beforeEach(() => {
    recordMock.mockClear();
    amendMock.mockClear();
  });

  it('records an expense in three steps: amount, category (its default envelope), save', async () => {
    const user = userEvent.setup();
    await renderExpense();
    await user.type(screen.getByLabelText('Amount, KZT'), '4500.50');
    await user.press(screen.getByRole('radio', { name: 'Groceries' }));
    expect(screen.getByRole('radio', { name: /^Needs/ }).props.accessibilityState).toEqual({ checked: true });
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'cash',
      amount: money(450_050n, 'KZT'),
      categoryId: 'cat-food',
      envelopeId: 'needs',
    });
  });

  it('only offers expense categories', async () => {
    await renderExpense();
    expect(screen.queryByRole('radio', { name: 'Salary' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Cinema' })).toBeTruthy();
  });

  it('asks for an envelope when the category has no default, without calling the server', async () => {
    const user = userEvent.setup();
    await renderExpense();
    await user.type(screen.getByLabelText('Amount, KZT'), '100');
    await user.press(screen.getByRole('radio', { name: 'Cinema' }));
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose the envelope this comes out of')).toBeTruthy();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('shows overspending before saving but still allows it (EXP-3)', async () => {
    const user = userEvent.setup();
    await renderExpense();
    await user.type(screen.getByLabelText('Amount, KZT'), '250');
    await user.press(screen.getByRole('radio', { name: 'Cinema' }));
    await user.press(screen.getByRole('radio', { name: /^Wants/ }));
    expect(screen.getByText(/Wants will go below zero: .*150\.00/)).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock.mock.calls[0]?.[0].envelopeId).toBe('wants');
  });

  it('rejects an empty amount', async () => {
    const user = userEvent.setup();
    await renderExpense();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter an amount, for example 4 500,50')).toBeTruthy();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('edit keeps the original envelope and date and saves through amend_entry', async () => {
    const user = userEvent.setup();
    const initial: HistoryItem = {
      key: 'e1:cash',
      entryId: 'e1',
      kind: 'expense',
      occurredOn: '2026-11-02',
      categoryId: 'cat-food',
      note: 'market',
      accountId: 'cash',
      amount: money(-120_000n, 'KZT'),
      envelopeId: 'wants', // not the category default: the user chose it back then
    };
    await renderExpense({ initial });
    expect(screen.getByLabelText('Amount, KZT').props.value).toBe('1,200.00');
    expect(screen.getByRole('radio', { name: /^Wants/ }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByText('Date: 02.11.2026')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(amendMock).toHaveBeenCalledTimes(1));
    expect(amendMock.mock.calls[0]?.[0]).toBe('e1');
    expect(amendMock.mock.calls[0]?.[1]).toMatchObject({
      occurredOn: '2026-11-02',
      envelopeId: 'wants',
      note: 'market',
      amount: money(120_000n, 'KZT'),
    });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('accounts outside the budget need no envelope', async () => {
    const user = userEvent.setup();
    await renderExpense({ accounts: [{ ...CASH, includeInBudget: false }] });
    expect(screen.queryByRole('radiogroup', { name: 'Envelope' })).toBeNull();
    await user.type(screen.getByLabelText('Amount, KZT'), '100');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock.mock.calls[0]?.[0].envelopeId).toBeNull();
  });
});
