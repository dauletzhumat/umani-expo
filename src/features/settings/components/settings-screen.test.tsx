import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Alert, type AlertButton } from 'react-native';

import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { deleteAccount } from '../api/account';
import { SettingsScreen } from './settings-screen';

jest.mock('../api/account', () => ({
  deleteAccount: jest.fn(async () => ({ ok: true, value: undefined })),
  savePreferences: jest.fn(async () => undefined),
}));

const deleteAccountMock = jest.mocked(deleteAccount);

/** Presses the destructive button of the confirmation alert. */
function confirmAlert() {
  const alert = jest.mocked(Alert.alert);
  const buttons = (alert.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  buttons.find((button) => button.style === 'destructive')?.onPress?.();
}

async function renderScreen(confirmOwner: (prompt: string) => Promise<boolean>) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>
        <SettingsScreen
          userId="user-1"
          appLockEnabled={false}
          onToggleAppLock={async () => true}
          onSignOut={async () => undefined}
          confirmOwner={confirmOwner}
          onAccountDeleted={async () => undefined}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('SettingsScreen account deletion', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.mocked(Alert.alert).mockClear();
    deleteAccountMock.mockClear();
  });

  it('does not delete when the Face ID / passcode check fails or is cancelled', async () => {
    const confirmOwner = jest.fn(async (_prompt: string) => false);
    await renderScreen(confirmOwner);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete account' }));
    confirmAlert();
    await waitFor(() => expect(confirmOwner).toHaveBeenCalledWith('Confirm account deletion'));
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('deletes after the owner is confirmed', async () => {
    await renderScreen(async () => true);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete account' }));
    confirmAlert();
    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalledTimes(1));
  });
});
