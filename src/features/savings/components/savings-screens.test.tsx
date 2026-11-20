import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { I18nextProvider } from 'react-i18next';

import { money } from '@/domain/money/money';
import { createI18n } from '@/lib/i18n/i18n';
import { ThemeProvider } from '@/ui/theme/theme-provider';

import { archiveSavingsGoal, setSavingsGoal, useGoals } from '../api/savings';
import type { PlanEnvelope } from '../model/savings';
import { GoalScreen } from './goal-screen';
import { SavingsScreen } from './savings-screen';

jest.mock('../model/savings', () => {
  const actual = jest.requireActual<typeof import('../model/savings')>('../model/savings');
  return { ...actual, todayIso: () => '2026-11-20' };
});

const SAVINGS: PlanEnvelope = {
  id: 'savings',
  name: null,
  nameKey: 'envelope.savings',
  kind: 'savings',
  allocationBps: 2000,
  sortOrder: 2,
  balance: money(20_000_000n, 'KZT'),
};

jest.mock('../api/savings', () => {
  const { money: m } = jest.requireActual<typeof import('@/domain/money/money')>('@/domain/money/money');
  const env = (id: string, kind: string, bps: number, sortOrder: number, balance = 0n) => ({
    id,
    name: null,
    nameKey: `envelope.${kind}`,
    kind,
    allocationBps: bps,
    sortOrder,
    balance: m(balance, 'KZT'),
  });
  return {
    usePlanEnvelopes: () => ({
      data: [env('needs', 'needs', 5000, 0), env('wants', 'wants', 3000, 1), env('savings', 'savings', 2000, 2, 20_000_000n)],
      isError: false,
    }),
    useGoals: jest.fn(() => ({ data: [], isError: false })),
    useMonthlyIncome: () => ({
      data: [
        { month: '2026-08-01', income: m(50_000_000n, 'KZT') },
        { month: '2026-09-01', income: m(50_000_000n, 'KZT') },
        { month: '2026-10-01', income: m(50_000_000n, 'KZT') },
      ],
      isError: false,
    }),
    useRefreshAfterGoalWrite: () => async () => undefined,
    setSavingsGoal: jest.fn(async () => ({ ok: true, value: 'goal' })),
    archiveSavingsGoal: jest.fn(async () => ({ ok: true, value: undefined })),
  };
});

const useGoalsMock = jest.mocked(useGoals);
const setGoalMock = jest.mocked(setSavingsGoal);
const archiveMock = jest.mocked(archiveSavingsGoal);

async function renderWith(node: ReactNode) {
  await render(
    <I18nextProvider i18n={createI18n('en')}>
      <ThemeProvider>{node}</ThemeProvider>
    </I18nextProvider>,
  );
}

const handlers = () => ({
  onOpenDeposit: jest.fn(),
  onOpenEverydayAccount: jest.fn(),
  onContribute: jest.fn(),
  onEditGoal: jest.fn(),
});

describe('SavingsScreen', () => {
  beforeEach(() => {
    useGoalsMock.mockClear();
  });

  it('recommends a deposit for the savings envelope with the typical monthly contribution (DEP-1, DEP-2)', async () => {
    const user = userEvent.setup();
    const h = handlers();
    await renderWith(<SavingsScreen userId="u" base="KZT" accounts={[]} {...h} />);
    expect(screen.getByText(/doesn’t recommend specific banks/)).toBeTruthy();
    expect(screen.getByText(/Average monthly income: .*500,000\.00/)).toBeTruthy();
    // 20 % of 500 000
    expect(screen.getByText(/100,000\.00/)).toBeTruthy();
    const opened = screen.getAllByRole('button', { name: 'I’ve opened it' });
    expect(opened).toHaveLength(2); // the savings deposit and the everyday account
    const first = opened[0];
    if (first === undefined) throw new Error('missing button');
    await user.press(first);
    expect(h.onOpenDeposit).toHaveBeenCalledWith('savings', 'UMANI · Savings');
    // no everyday account yet: suggested with the rest of the month
    expect(screen.getByText(/about 400,000\.00.* a month/)).toBeTruthy();
  });

  it('an opened deposit replaces the recommendation and tops up by transfer (DEP-3, DEP-4)', async () => {
    const user = userEvent.setup();
    const h = handlers();
    await renderWith(
      <SavingsScreen
        userId="u"
        base="KZT"
        accounts={[
          { id: 'dep', name: 'UMANI · Savings', kind: 'deposit', linkedEnvelopeId: 'savings', balance: money(0n, 'KZT') },
          { id: 'card', name: 'Card', kind: 'card', linkedEnvelopeId: null, balance: money(0n, 'KZT') },
        ]}
        {...h}
      />,
    );
    expect(screen.queryByText(/Suggested: open a separate deposit/)).toBeNull();
    expect(screen.queryByText('Everyday account')).toBeNull();
    await user.press(screen.getByRole('button', { name: 'UMANI · Savings' }));
    expect(h.onContribute).toHaveBeenCalledWith('dep');
  });

  it('shows goal progress and the monthly amount needed (BUD-7)', async () => {
    useGoalsMock.mockReturnValue({
      data: [{ id: 'g', envelopeId: 'savings', target: money(80_000_000n, 'KZT'), targetDate: '2027-04-30' }],
      isError: false,
    } as unknown as ReturnType<typeof useGoals>);
    await renderWith(<SavingsScreen userId="u" base="KZT" accounts={[]} {...handlers()} />);
    // 600 000 missing over Nov…Apr = 6 months → 100 000
    expect(screen.getByText(/200,000\.00 ₸ of 800,000\.00 ₸/)).toBeTruthy();
    expect(screen.getByText(/by 30\.04\.2027 · Put aside 100,000\.00.* a month for 6 months/)).toBeTruthy();
  });
});

describe('GoalScreen', () => {
  beforeEach(() => {
    setGoalMock.mockClear();
    archiveMock.mockClear();
  });

  it('previews the monthly amount and saves the goal with a date one year out', async () => {
    const user = userEvent.setup();
    const onDone = jest.fn();
    await renderWith(<GoalScreen base="KZT" envelope={SAVINGS} onDone={onDone} />);
    await user.type(screen.getByLabelText('Target, KZT'), '1500000');
    // 1 300 000 missing over Nov 2026 … Nov 2027 = 13 months → 100 000
    expect(screen.getByText(/Put aside 100,000\.00.* a month for 13 months/)).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(setGoalMock).toHaveBeenCalledWith('savings', money(150_000_000n, 'KZT'), '2027-11-20');
  });

  it('no date: saves without one and shows what is missing', async () => {
    const user = userEvent.setup();
    await renderWith(<GoalScreen base="KZT" envelope={SAVINGS} onDone={() => undefined} />);
    await user.type(screen.getByLabelText('Target, KZT'), '300000');
    await user.press(screen.getByRole('radio', { name: 'No date' }));
    expect(screen.getByText(/100,000\.00 ₸ still to go/)).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setGoalMock).toHaveBeenCalledWith('savings', money(30_000_000n, 'KZT'), null));
  });

  it('editing keeps the existing date until another horizon is picked', async () => {
    const user = userEvent.setup();
    const goal = { id: 'g', envelopeId: 'savings', target: money(80_000_000n, 'KZT'), targetDate: '2027-04-30' };
    await renderWith(<GoalScreen base="KZT" envelope={SAVINGS} goal={goal} onDone={() => undefined} />);
    expect(screen.getByText('by 30.04.2027')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setGoalMock).toHaveBeenCalledWith('savings', money(80_000_000n, 'KZT'), '2027-04-30'));
  });

  it('removes the goal after confirmation', async () => {
    const user = userEvent.setup();
    const onDone = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const goal = { id: 'g', envelopeId: 'savings', target: money(80_000_000n, 'KZT'), targetDate: null };
    await renderWith(<GoalScreen base="KZT" envelope={SAVINGS} goal={goal} onDone={onDone} />);
    await user.press(screen.getByRole('button', { name: 'Remove goal' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(archiveMock).toHaveBeenCalledWith('g');
    alert.mockRestore();
  });

  it('an overdue goal starts from a new horizon (a passed date cannot be saved again)', async () => {
    const user = userEvent.setup();
    const goal = { id: 'g', envelopeId: 'savings', target: money(80_000_000n, 'KZT'), targetDate: '2026-10-01' };
    await renderWith(<GoalScreen base="KZT" envelope={SAVINGS} goal={goal} onDone={() => undefined} />);
    expect(screen.getByRole('radio', { name: 'in 12 months' }).props.accessibilityState).toEqual({ checked: true });
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setGoalMock).toHaveBeenCalledWith('savings', money(80_000_000n, 'KZT'), '2027-11-20'));
  });

  it('rejects an empty target without calling the server', async () => {
    const user = userEvent.setup();
    await renderWith(<GoalScreen base="KZT" envelope={SAVINGS} onDone={() => undefined} />);
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a target, for example 1 000 000')).toBeTruthy();
    expect(setGoalMock).not.toHaveBeenCalled();
  });
});
