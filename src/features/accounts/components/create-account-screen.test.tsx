import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

import { money } from '@/domain/money/money';
import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { createAccount } from '../api/accounts';
import { CreateAccountScreen } from './create-account-screen';

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000002' }));
jest.mock('../api/accounts', () => ({
  createAccount: jest.fn(async () => ({ ok: true, value: 'new-id' })),
  useRefreshAfterWrite: () => async () => undefined,
  useFxRate: (from?: string, to?: string) => ({
    data: from === 'USD' && to === 'KZT' ? { rate: '444.16', source: 'nbk', asOf: '2026-11-19' } : undefined,
  }),
}));

const createAccountMock = jest.mocked(createAccount);

async function renderCreate(onDone = jest.fn()) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>
        <CreateAccountScreen base="KZT" onDone={onDone} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return onDone;
}

describe('CreateAccountScreen', () => {
  beforeEach(() => {
    createAccountMock.mockClear();
  });

  it('creates a base-currency account without asking for a rate', async () => {
    const user = userEvent.setup();
    const onDone = await renderCreate();
    await user.type(screen.getByLabelText('Name'), 'Kaspi Gold');
    await user.type(screen.getByLabelText('Opening balance, KZT'), '150000.50');
    expect(screen.queryByLabelText(/^Rate/)).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createAccountMock).toHaveBeenCalledWith(
      {
        name: 'Kaspi Gold',
        kind: 'card',
        opening: money(15_000_050n, 'KZT'),
        openingRate: undefined,
        includeInBudget: true,
      },
      '00000000-0000-4000-8000-000000000002',
    );
  });

  it('pre-fills the NBK rate for a foreign opening balance and sends it', async () => {
    const user = userEvent.setup();
    await renderCreate();
    await user.press(screen.getByRole('radio', { name: 'USD' }));
    await user.type(screen.getByLabelText('Opening balance, USD'), '100');
    expect(screen.getByLabelText('Rate, KZT per 1 USD').props.value).toBe('444.16');
    expect(screen.getByText('National Bank rate for 19.11.2026')).toBeTruthy();

    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createAccountMock).toHaveBeenCalledTimes(1));
    expect(createAccountMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'Card', // empty name falls back to the kind
      opening: money(10_000n, 'USD'),
      openingRate: '444.16',
    });
  });

  it('sends the rate the user typed and the outside-the-budget flag', async () => {
    const user = userEvent.setup();
    await renderCreate();
    await user.press(screen.getByRole('radio', { name: 'USD' }));
    await user.type(screen.getByLabelText('Opening balance, USD'), '100');
    await user.clear(screen.getByLabelText('Rate, KZT per 1 USD'));
    await user.type(screen.getByLabelText('Rate, KZT per 1 USD'), '450,5');
    await user.press(screen.getByRole('radio', { name: 'No' }));
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createAccountMock).toHaveBeenCalledTimes(1));
    expect(createAccountMock.mock.calls[0]?.[0]).toMatchObject({ openingRate: '450.5', includeInBudget: false });
  });

  it('shows the server error and stays on the screen', async () => {
    createAccountMock.mockResolvedValueOnce({ ok: false, error: 'account_limit' });
    const user = userEvent.setup();
    const onDone = await renderCreate();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('You can have up to 50 accounts')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
