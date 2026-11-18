import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { money } from '../domain/money/money';
import { createI18n, type Language } from '../lib/i18n/i18n';
import { AmountText } from './amount-text';
import { Button } from './button';
import { ListRow } from './list-row';
import { SegmentedControl } from './segmented-control';
import { Text } from './text';
import { ThemeProvider, useTheme } from './theme/theme-provider';
import { colors } from './tokens';

const NNBSP = ' ';
const NBSP = ' ';

function renderWithProviders(ui: ReactNode, language: Language = 'ru') {
  return render(
    <I18nextProvider i18n={createI18n(language)}>
      <ThemeProvider>{ui}</ThemeProvider>
    </I18nextProvider>,
  );
}

describe('Button', () => {
  it('is an accessible button that calls onPress', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<Button label="Сохранить" onPress={onPress} />);
    await user.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled and says so to assistive tech', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<Button label="Сохранить" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Сохранить' });
    expect(button).toBeDisabled();
    await user.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  it('marks the selected option and reports changes', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <SegmentedControl
        accessibilityLabel="Язык"
        value="ru"
        onChange={onChange}
        options={[
          { value: 'ru', label: 'Русский' },
          { value: 'kk', label: 'Қазақша' },
          { value: 'en', label: 'English' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Русский' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Қазақша' })).not.toBeChecked();
    await user.press(screen.getByRole('radio', { name: 'Қазақша' }));
    expect(onChange).toHaveBeenCalledWith('kk');
  });
});

describe('AmountText', () => {
  it('formats with the current language and reads the amount in words', async () => {
    await renderWithProviders(<AmountText money={money(2_500_000n, 'KZT')} />, 'ru');
    expect(screen.getByText(`25${NNBSP}000,00${NBSP}₸`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`25${NNBSP}000 тенге`)).toBeOnTheScreen();
  });

  it('uses the right plural for the spoken currency and says minus', async () => {
    await renderWithProviders(<AmountText money={money(-500n, 'USD')} />, 'ru');
    expect(screen.getByLabelText('минус 5 долларов')).toBeOnTheScreen();
  });

  it('reads fractional amounts with the "other" form', async () => {
    await renderWithProviders(<AmountText money={money(150n, 'USD')} />, 'en');
    expect(screen.getByText('$1.50')).toBeOnTheScreen();
    expect(screen.getByLabelText('1.50 dollars')).toBeOnTheScreen();
  });

  it('income mode shows a plus sign', async () => {
    await renderWithProviders(<AmountText money={money(100n, 'KZT')} mode="income" hideZeroFraction />, 'kk');
    expect(screen.getByText(`+1${NBSP}₸`)).toBeOnTheScreen();
  });
});

describe('ListRow', () => {
  it('is a button when pressable and shows title and value', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<ListRow title="Настройки" value="Русский" onPress={onPress} />);
    await user.press(screen.getByRole('button', { name: /Настройки/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Русский')).toBeOnTheScreen();
  });

  it('is static text without onPress', async () => {
    await renderWithProviders(<ListRow title="Баланс" />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    expect(screen.getByText('Баланс')).toBeOnTheScreen();
  });
});

describe('ThemeProvider', () => {
  function Probe() {
    const { scheme, colors: c, setPreference } = useTheme();
    return (
      <>
        <Text>{`${scheme}:${c.bgCanvas}`}</Text>
        <Button label="dark" onPress={() => setPreference('dark')} />
        <Button label="light" onPress={() => setPreference('light')} />
      </>
    );
  }

  it('follows the chosen preference', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Probe />);
    await user.press(screen.getByRole('button', { name: 'dark' }));
    expect(screen.getByText(`dark:${colors.dark.bgCanvas}`)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'light' }));
    expect(screen.getByText(`light:${colors.light.bgCanvas}`)).toBeOnTheScreen();
  });

  it('useTheme outside the provider is a programmer error', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow('useTheme must be used inside ThemeProvider');
    spy.mockRestore();
  });
});
