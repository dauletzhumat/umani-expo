import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { I18nextProvider } from 'react-i18next';

import { money } from '@/domain/money/money';
import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { deleteLimit, setLimit } from '../api/expenses';
import type { LimitProgress } from '../model/expense';
import { LimitScreen } from './limit-screen';

jest.mock('../api/expenses', () => ({
  setLimit: jest.fn(async () => ({ ok: true, value: 'limit' })),
  deleteLimit: jest.fn(async () => ({ ok: false, error: 'unknown_limit' })),
  useRefreshAfterSetupWrite: () => async () => undefined,
  useCategories: () => ({
    data: [{ id: 'cat-food', kind: 'expense', name: null, nameKey: 'category.groceries', defaultEnvelopeId: null }],
  }),
  useSpendEnvelopes: () => ({ data: [{ id: 'needs', name: null, nameKey: 'envelope.needs', kind: 'needs' }] }),
}));

const setMock = jest.mocked(setLimit);
const deleteMock = jest.mocked(deleteLimit);

async function renderLimit(initial?: LimitProgress, onDone: () => void = () => undefined) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>
        <LimitScreen userId="u" base="KZT" initial={initial} onDone={onDone} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('LimitScreen', () => {
  beforeEach(() => {
    setMock.mockClear();
    deleteMock.mockClear();
  });

  it('sets a monthly limit for a category', async () => {
    const user = userEvent.setup();
    await renderLimit();
    await user.press(screen.getByRole('radio', { name: 'Category' }));
    await user.press(screen.getByRole('radio', { name: 'Groceries' }));
    await user.type(screen.getByLabelText('Monthly limit, KZT'), '60000');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ categoryId: 'cat-food' }, money(6_000_000n, 'KZT')));
  });

  it('needs a target', async () => {
    const user = userEvent.setup();
    await renderLimit();
    await user.type(screen.getByLabelText('Monthly limit, KZT'), '100');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose an envelope or a category')).toBeTruthy();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('deleting a limit that is already gone (lost response) counts as done', async () => {
    const user = userEvent.setup();
    const onDone = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await renderLimit(
      {
        limitId: 'l1',
        envelopeId: 'needs',
        categoryId: null,
        limit: money(5_000_000n, 'KZT'),
        spent: money(0n, 'KZT'),
        state: 'ok',
        permille: 0,
      },
      onDone,
    );
    expect(screen.getByText('Needs')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Delete limit' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith('l1');
    alert.mockRestore();
  });
});
