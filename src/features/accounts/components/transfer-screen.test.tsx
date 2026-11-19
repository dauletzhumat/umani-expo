import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

import { money } from '@/domain/money/money';
import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { recordTransfer } from '../api/accounts';
import type { Account } from '../model/account';
import { TransferScreen } from './transfer-screen';

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('../api/accounts', () => ({
  recordTransfer: jest.fn(async () => ({ ok: true, value: undefined })),
  useRefreshAfterWrite: () => async () => undefined,
  useEnvelopeChoices: () => ({
    data: [
      { id: 'env-needs', name: null, nameKey: 'envelope.needs', kind: 'needs' },
      { id: 'env-unalloc', name: null, nameKey: 'envelope.unallocated', kind: 'unallocated' },
    ],
  }),
  useFxRate: (from?: string, to?: string) => ({
    data: from === 'KZT' && to === 'USD' ? { rate: '0.0021', source: 'nbk', asOf: '2026-11-19' } : undefined,
  }),
}));

const recordTransferMock = jest.mocked(recordTransfer);

const account = (id: string, name: string, currency: 'KZT' | 'USD', includeInBudget = true): Account => ({
  id,
  name,
  kind: 'card',
  currency,
  includeInBudget,
  linkedEnvelopeId: null,
  archived: false,
  balance: money(10_000_000n, currency),
  bookValue: money(10_000_000n, 'KZT'),
});

const KASPI = account('kaspi', 'Kaspi', 'KZT');
const DOLLARS = account('usd', 'Dollars', 'USD');
const BROKER = account('broker', 'Broker', 'KZT', false);

async function renderTransfer(accounts: Account[]) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>
        <TransferScreen userId="user-1" accounts={accounts} onDone={() => undefined} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('TransferScreen', () => {
  beforeEach(() => {
    recordTransferMock.mockClear();
  });

  it('derives and shows the rate for a cross-currency transfer and sends both amounts', async () => {
    const user = userEvent.setup();
    await renderTransfer([KASPI, DOLLARS]);
    await user.type(screen.getByLabelText('Amount, KZT'), '50000');
    // suggested from the NBK rate until the user types what they actually received
    expect(screen.getByLabelText('Received, USD').props.placeholder).toBe('105.00');
    await user.press(screen.getByRole('button', { name: 'Transfer' }));
    expect(await screen.findByText('Enter the amount that arrived')).toBeTruthy();
    expect(recordTransferMock).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Received, USD'), '100');
    expect(screen.getByText('Rate: 1 KZT = 0.002 USD')).toBeTruthy();

    await user.press(screen.getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(recordTransferMock).toHaveBeenCalledTimes(1));
    expect(recordTransferMock.mock.calls[0]?.[0]).toEqual({
      fromId: 'kaspi',
      toId: 'usd',
      sent: money(5_000_000n, 'KZT'),
      received: money(10_000n, 'USD'),
      envelopeId: undefined,
      rate: undefined,
    });
  });

  it('asks which envelope to take from when money leaves the budget (default Unallocated)', async () => {
    const user = userEvent.setup();
    await renderTransfer([KASPI, BROKER]);
    expect(screen.getByText('The money leaves the budget. Take it from:')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Unallocated' }).props.accessibilityState).toEqual({ checked: true });

    await user.press(screen.getByRole('radio', { name: 'Needs' }));
    await user.type(screen.getByLabelText('Amount, KZT'), '1000');
    await user.press(screen.getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(recordTransferMock).toHaveBeenCalledTimes(1));
    expect(recordTransferMock.mock.calls[0]?.[0]).toMatchObject({
      sent: money(100_000n, 'KZT'),
      received: money(100_000n, 'KZT'),
      envelopeId: 'env-needs',
    });
  });

  it('shows no envelope choice between two budgeted accounts', async () => {
    await renderTransfer([KASPI, account('cash', 'Cash', 'KZT')]);
    expect(screen.queryByText(/Take it from|Put it into/)).toBeNull();
  });

  it('explains rate_required and reveals the rate field', async () => {
    recordTransferMock.mockResolvedValueOnce({ ok: false, error: 'rate_required' });
    const user = userEvent.setup();
    await renderTransfer([DOLLARS, KASPI]);
    await user.type(screen.getByLabelText('Amount, USD'), '500');
    await user.type(screen.getByLabelText('Received, KZT'), '237750');
    await user.press(screen.getByRole('button', { name: 'Transfer' }));
    expect(await screen.findByText(/doesn't have enough money/)).toBeTruthy();
    expect(screen.getByLabelText('Rate, KZT per 1 USD')).toBeTruthy();
  });

  it('rejects an invalid amount without calling the server', async () => {
    const user = userEvent.setup();
    await renderTransfer([KASPI, account('cash', 'Cash', 'KZT')]);
    await user.type(screen.getByLabelText('Amount, KZT'), '1.2.3');
    await user.press(screen.getByRole('button', { name: 'Transfer' }));
    expect(await screen.findByText('Enter an amount, for example 150 000,50')).toBeTruthy();
    expect(recordTransferMock).not.toHaveBeenCalled();
  });
});
