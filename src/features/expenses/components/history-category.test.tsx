import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { money } from '@/domain/money/money';
import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { createCategory, updateCategory, useHistory } from '../api/expenses';
import type { HistoryItem } from '../model/expense';
import { CategoryScreen } from './category-screen';
import { HistoryScreen } from './history-screen';

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000005' }));

const item = (entryId: string, kind: HistoryItem['kind'], amount: bigint, accountId = 'cash'): HistoryItem => ({
  key: `${entryId}:${accountId}`,
  entryId,
  kind,
  occurredOn: '2026-11-19',
  categoryId: null,
  note: null,
  accountId,
  amount: money(amount, 'KZT'),
  envelopeId: null,
});

jest.mock('../api/expenses', () => ({
  useHistory: jest.fn(() => ({ data: [], isPending: false, isError: false })),
  useCategories: () => ({
    data: [{ id: 'cat-food', kind: 'expense', name: null, nameKey: 'category.groceries', defaultEnvelopeId: null }],
  }),
  useSpendEnvelopes: () => ({ data: [] }),
  useRefreshAfterSetupWrite: () => async () => undefined,
  createCategory: jest.fn(async () => ({ ok: true, value: 'new' })),
  updateCategory: jest.fn(async () => ({ ok: true, value: undefined })),
  archiveCategory: jest.fn(async () => ({ ok: true, value: undefined })),
}));

const useHistoryMock = jest.mocked(useHistory);
const createMock = jest.mocked(createCategory);
const updateMock = jest.mocked(updateCategory);

async function renderWithProviders(node: ReactNode) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>{node}</ThemeProvider>
    </I18nextProvider>,
  );
}

describe('HistoryScreen', () => {
  beforeEach(() => {
    useHistoryMock.mockClear();
  });

  it('filters by account (ACC-5) and opens only income and expenses', async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn();
    useHistoryMock.mockReturnValue({
      data: [item('e1', 'expense', -5_000n), item('t1', 'transfer', -10_000n)],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useHistory>);
    await renderWithProviders(
      <HistoryScreen
        userId="u"
        accounts={[
          { id: 'cash', name: 'Cash' },
          { id: 'card', name: 'Card' },
        ]}
        onOpen={onOpen}
      />,
    );
    expect(useHistoryMock).toHaveBeenLastCalledWith('u', null, 50);
    await user.press(screen.getByRole('radio', { name: 'Card' }));
    expect(useHistoryMock).toHaveBeenLastCalledWith('u', 'card', 50);

    await user.press(screen.getByRole('button', { name: 'Expense' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'e1' }));
    expect(screen.queryByRole('button', { name: 'Transfer' })).toBeNull();
    expect(screen.getByText('Transfer')).toBeTruthy();
  });

  it('starts on the account it was opened from', async () => {
    await renderWithProviders(
      <HistoryScreen userId="u" accounts={[{ id: 'cash', name: 'Cash' }]} initialAccountId="cash" onOpen={() => undefined} />,
    );
    expect(useHistoryMock).toHaveBeenLastCalledWith('u', 'cash', 50);
    expect(screen.getByRole('radio', { name: 'Cash' }).props.accessibilityState).toEqual({ checked: true });
  });
});

describe('CategoryScreen', () => {
  beforeEach(() => {
    createMock.mockClear();
    updateMock.mockClear();
  });

  it('rejects a name equal to a default category in the current language (the DB cannot see it)', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<CategoryScreen userId="u" base="KZT" kind="expense" onDone={() => undefined} />);
    await user.type(screen.getByLabelText('Name'), ' groceries ');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A category with this name already exists')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates a category with a trimmed name', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<CategoryScreen userId="u" base="KZT" kind="expense" onDone={() => undefined} />);
    await user.type(screen.getByLabelText('Name'), ' Coffee ');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0]?.slice(0, 3)).toEqual(['expense', 'Coffee', null]);
  });

  it('editing a default category without renaming keeps its localised name', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <CategoryScreen
        userId="u"
        base="KZT"
        kind="expense"
        initial={{ id: 'cat-food', kind: 'expense', name: null, nameKey: 'category.groceries', defaultEnvelopeId: null }}
        onDone={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Name').props.value).toBe('Groceries');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]?.[1]).toEqual({ name: undefined, defaultEnvelopeId: null });
  });
});
