import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

import { money } from '@/domain/money/money';
import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { amendIncome, recordIncome } from '../api/budget';
import type { AccountOption, Envelope } from '../model/budget';
import { IncomeScreen } from './income-screen';

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000003' }));

const envelope = (id: string, kind: Envelope['kind'], bps: number, sortOrder: number): Envelope => ({
  id,
  name: null,
  nameKey: kind === 'unallocated' ? 'envelope.unallocated' : `envelope.${kind}`,
  kind,
  allocationBps: bps,
  sortOrder,
  balance: money(0n, 'KZT'),
});

jest.mock('../api/budget', () => ({
  recordIncome: jest.fn(async () => ({ ok: true, value: 'entry' })),
  amendIncome: jest.fn(async () => ({ ok: true, value: undefined })),
  reverseEntry: jest.fn(async () => ({ ok: true, value: undefined })),
  useRefreshAfterBudgetWrite: () => async () => undefined,
  useIncomeRate: () => ({ data: undefined }),
  useIncomeCategories: () => ({ data: [{ id: 'cat-salary', name: null, nameKey: 'category.salary' }] }),
  useEnvelopes: () => ({
    data: [
      envelope('needs', 'needs', 5000, 0),
      envelope('wants', 'wants', 3000, 1),
      envelope('savings', 'savings', 2000, 2),
      envelope('unalloc', 'unallocated', 0, 1000),
    ],
  }),
}));

const recordIncomeMock = jest.mocked(recordIncome);
const amendIncomeMock = jest.mocked(amendIncome);
const ACCOUNTS: AccountOption[] = [{ id: 'cash', name: 'Cash', currency: 'KZT', includeInBudget: true }];

async function renderIncome(props: Partial<Parameters<typeof IncomeScreen>[0]> = {}) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>
        <IncomeScreen userId="u" base="KZT" accounts={ACCOUNTS} onDone={() => undefined} {...props} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('IncomeScreen', () => {
  beforeEach(() => {
    recordIncomeMock.mockClear();
    amendIncomeMock.mockClear();
  });

  it('previews the exact automatic split and records income with auto allocation', async () => {
    const user = userEvent.setup();
    await renderIncome();
    await user.type(screen.getByLabelText('Amount, KZT'), '1000.01');
    // 1 000.01 split 50/30/20 with largest remainder: 500.01 / 300.00 / 200.00
    expect(screen.getByText('Split by your method:')).toBeTruthy();
    expect(screen.getByText('500.01 ₸', { exact: false })).toBeTruthy();
    await user.press(screen.getByRole('radio', { name: 'Salary' }));
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recordIncomeMock).toHaveBeenCalledTimes(1));
    expect(recordIncomeMock.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'cash',
      amount: money(100_001n, 'KZT'),
      categoryId: 'cat-salary',
      manualParts: undefined,
    });
  });

  it('manual split: shows the remainder for Unallocated and sends only non-zero parts', async () => {
    const user = userEvent.setup();
    await renderIncome();
    await user.type(screen.getByLabelText('Amount, KZT'), '1200');
    await user.press(screen.getByRole('radio', { name: 'Manual' }));
    await user.type(screen.getByLabelText('Needs, KZT'), '500');
    await user.type(screen.getByLabelText('Savings, KZT'), '500');
    expect(screen.getByText(/Left for Unallocated: .*200\.00/)).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recordIncomeMock).toHaveBeenCalledTimes(1));
    expect(recordIncomeMock.mock.calls[0]?.[0].manualParts).toEqual([
      { envelopeId: 'needs', amount: money(50_000n, 'KZT') },
      { envelopeId: 'savings', amount: money(50_000n, 'KZT') },
    ]);
  });

  it('manual split above the income is rejected without calling the server', async () => {
    const user = userEvent.setup();
    await renderIncome();
    await user.type(screen.getByLabelText('Amount, KZT'), '100');
    await user.press(screen.getByRole('radio', { name: 'Manual' }));
    await user.type(screen.getByLabelText('Needs, KZT'), '150');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The parts add up to more than the income')).toBeTruthy();
    expect(recordIncomeMock).not.toHaveBeenCalled();
  });

  it('edit starts from the original manual split instead of re-splitting automatically', async () => {
    const user = userEvent.setup();
    await renderIncome({
      initial: {
        id: 'entry-2',
        occurredOn: '2026-11-01',
        note: null,
        categoryId: null,
        accountId: 'cash',
        amount: money(120_000n, 'KZT'),
      },
      // 500 / 500 / 200 left in Unallocated: not what 50/30/20 would give
      initialParts: [
        { envelopeId: 'needs', amount: '50000' },
        { envelopeId: 'savings', amount: '50000' },
        { envelopeId: 'unalloc', amount: '20000' },
      ],
    });
    expect(screen.getByRole('radio', { name: 'Manual' }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByLabelText('Needs, KZT').props.value).toBe('500.00');
    expect(screen.getByText(/Left for Unallocated: .*200\.00/)).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(amendIncomeMock).toHaveBeenCalledTimes(1));
    expect(amendIncomeMock.mock.calls[0]?.[1].manualParts).toEqual([
      { envelopeId: 'needs', amount: money(50_000n, 'KZT') },
      { envelopeId: 'savings', amount: money(50_000n, 'KZT') },
    ]);
  });

  it('edit keeps the original date and saves through amend_entry', async () => {
    const user = userEvent.setup();
    await renderIncome({
      initial: {
        id: 'entry-1',
        occurredOn: '2026-11-01',
        note: null,
        categoryId: 'cat-salary',
        accountId: 'cash',
        amount: money(10_000_000n, 'KZT'),
      },
    });
    expect(screen.getByText('Date: 01.11.2026')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(amendIncomeMock).toHaveBeenCalledTimes(1));
    expect(amendIncomeMock.mock.calls[0]?.[0]).toBe('entry-1');
    expect(amendIncomeMock.mock.calls[0]?.[1]).toMatchObject({ occurredOn: '2026-11-01', amount: money(10_000_000n, 'KZT') });
    expect(recordIncomeMock).not.toHaveBeenCalled();
  });
});
