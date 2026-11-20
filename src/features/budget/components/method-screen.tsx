import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { parsePercentToBps, validateCustomBudget, type CustomEnvelopeKind } from '@/domain/allocation/custom';
import type { BudgetMethod } from '@/domain/allocation/envelope';
import { PRESET_METHODS, presetEnvelopes } from '@/domain/allocation/presets';
import type { CurrencyCode } from '@/domain/money/currency';
import { formatMoney } from '@/domain/money/format';
import { useIntentKey } from '@/lib/use-intent-key';
import { Button } from '@/ui/button';
import { ChoiceList } from '@/ui/choice-list';
import { Screen } from '@/ui/screen';
import { SegmentedControl } from '@/ui/segmented-control';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { spacing } from '@/ui/tokens';

import { changeBudgetMethod, useEnvelopes, useRefreshAfterBudgetWrite, type CustomLayoutItem } from '../api/budget';
import { bpsLabel, isEnvelopeNameKey, planMethodSwitch, type BudgetError, type Envelope } from '../model/budget';
import { envelopeLabel, localeOf } from './labels';

type Row = { key: string; name: string; percent: string; kind: CustomEnvelopeKind; envelopeId?: string };

export type MethodScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  current: BudgetMethod;
  onDone: () => void;
}>;

/** Switch the budget method or edit a custom one (BUD-1…3), with the money of removed envelopes. */
export function MethodScreen({ userId, base, current, onDone }: MethodScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = localeOf(i18n.language);
  const refresh = useRefreshAfterBudgetWrite();
  const envelopes = useEnvelopes(userId, base);
  const intent = useIntentKey();

  const [method, setMethod] = useState<BudgetMethod>(current);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<BudgetError | null>(null);
  const [saving, setSaving] = useState(false);

  const active: Envelope[] = (envelopes.data ?? []).filter((e) => e.kind !== 'unallocated');
  // the custom editor starts from the current envelopes, kept by id
  const editorRows: Row[] =
    rows ??
    active.map((e) => ({
      key: e.id,
      name: envelopeLabel(e, t),
      percent: bpsLabel(e.allocationBps, locale),
      kind: e.kind === 'savings' ? 'savings' : 'custom',
      envelopeId: e.id,
    }));

  const plan = planMethodSwitch(
    envelopes.data ?? [],
    method === 'custom' ? null : presetEnvelopes(method),
    editorRows.map((r) => ({ name: r.name, envelopeId: r.envelopeId })),
  );
  const toMove = plan.removed.filter((e) => e.balance.amountMinor !== 0n);
  // a removed envelope's target: a layout slot (by row key for custom layouts, so removing or
  // reordering rows never points the money at the wrong envelope) or Unallocated
  const slotValue = (index: number) => (method === 'custom' ? `row:${editorRows[index]?.key ?? ''}` : `slot:${index}`);
  const slotIndex = (value: string): number | null => {
    if (value.startsWith('row:')) {
      const index = editorRows.findIndex((r) => r.key === value.slice(4));
      return index >= 0 ? index : null;
    }
    if (value.startsWith('slot:')) {
      const index = Number(value.slice(5));
      return method !== 'custom' && Number.isInteger(index) && index < plan.layout.length ? index : null;
    }
    return null;
  };
  const slotLabel = (index: number) => {
    const slot = plan.layout[index];
    if (slot === undefined) return '';
    return isEnvelopeNameKey(slot.nameKey) ? t(slot.nameKey) : (slot.name ?? '');
  };
  const totalBps = editorRows.reduce((sum, r) => {
    const bps = parsePercentToBps(r.percent);
    return bps.ok ? sum + bps.value : sum;
  }, 0);

  function updateRow(key: string, patch: Partial<Row>) {
    setRows(editorRows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function apply() {
    let custom: CustomLayoutItem[] | undefined;
    if (method === 'custom') {
      const parsed = editorRows.map((r) => parsePercentToBps(r.percent));
      const badIndex = parsed.findIndex((p) => !p.ok);
      if (badIndex >= 0) {
        setFormError(t('budget.invalidPercent'));
        return;
      }
      const inputs = editorRows.map((r, i) => {
        const bps = parsed[i];
        return { name: r.name, allocationBps: bps?.ok === true ? bps.value : 0, kind: r.kind };
      });
      const valid = validateCustomBudget(inputs);
      if (!valid.ok) {
        setFormError(
          valid.error.code === 'not_100_percent'
            ? t('budget.error_not_100_percent')
            : valid.error.code === 'duplicate_name'
              ? t('budget.error_duplicate_name')
              : valid.error.code === 'too_many_envelopes'
                ? t('budget.error_too_many_envelopes')
                : valid.error.code === 'invalid_percentage'
                  ? t('budget.invalidPercent')
                  : t('budget.error_invalid_name'),
        );
        return;
      }
      custom = valid.value.map((e, i) => ({ ...e, envelopeId: editorRows[i]?.envelopeId }));
    }
    const reassign: Record<string, number | 'unallocated'> = {};
    for (const envelope of toMove) {
      const index = slotIndex(targets[envelope.id] ?? 'unallocated');
      reassign[envelope.id] = index === null ? 'unallocated' : index;
    }
    setFormError(null);
    setError(null);
    setSaving(true);
    const signature = JSON.stringify({ method, custom, reassign });
    const result = await changeBudgetMethod(method, intent.keyFor(signature), custom, reassign);
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    intent.reset();
    await refresh();
    onDone();
  }

  const methodChoices = [
    ...PRESET_METHODS.map((m) => ({ value: m as BudgetMethod, label: t(`onboarding.method_${m}`) })),
    { value: 'custom' as BudgetMethod, label: t('budget.methodCustom') },
  ];

  return (
    <Screen>
      <Text variant="callout" color="textSecondary">
        {t('budget.methodHint')}
      </Text>
      <ChoiceList accessibilityLabel={t('budget.methodTitle')} value={method} onChange={setMethod} choices={methodChoices} />

      {method === 'custom' && envelopes.isSuccess && (
        <View style={styles.group}>
          <Text variant="headline" accessibilityRole="header">
            {t('budget.customEnvelopes')}
          </Text>
          {editorRows.map((row) => (
            <Surface key={row.key} style={styles.group}>
              <TextField
                label={t('budget.envelopeName')}
                value={row.name}
                onChangeText={(name) => updateRow(row.key, { name })}
                maxLength={40}
              />
              <TextField
                label={t('budget.percent')}
                value={row.percent}
                onChangeText={(percent) => updateRow(row.key, { percent })}
                keyboardType="decimal-pad"
              />
              <SegmentedControl
                accessibilityLabel={t('budget.savingsKind')}
                value={row.kind}
                onChange={(kind) => updateRow(row.key, { kind })}
                options={[
                  { value: 'custom', label: t('budget.regularKind') },
                  { value: 'savings', label: t('budget.savingsKind') },
                ]}
              />
              {editorRows.length > 1 && (
                <Button
                  label={t('budget.removeEnvelope')}
                  variant="ghost"
                  onPress={() => setRows(editorRows.filter((r) => r.key !== row.key))}
                />
              )}
            </Surface>
          ))}
          {editorRows.length < 12 && (
            <Button
              label={t('budget.addEnvelope')}
              variant="secondary"
              onPress={() => setRows([...editorRows, { key: Crypto.randomUUID(), name: '', percent: '', kind: 'custom' }])}
            />
          )}
          <Text variant="footnote" color={totalBps === 10_000 ? 'textSecondary' : 'negative'}>
            {t('budget.totalPercent', { percent: bpsLabel(totalBps, locale) })}
          </Text>
        </View>
      )}

      {toMove.length > 0 && (
        <View style={styles.group}>
          <Text variant="headline" accessibilityRole="header">
            {t('budget.removedTitle')}
          </Text>
          {toMove.map((envelope) => (
            <Surface key={envelope.id} style={styles.group}>
              <Text variant="body">{`${envelopeLabel(envelope, t)} · ${formatMoney(envelope.balance, locale)}`}</Text>
              <ChoiceList
                accessibilityLabel={envelopeLabel(envelope, t)}
                value={(() => {
                  const value = targets[envelope.id] ?? 'unallocated';
                  return slotIndex(value) === null ? 'unallocated' : value;
                })()}
                onChange={(value) => setTargets({ ...targets, [envelope.id]: value })}
                choices={[
                  ...plan.layout.map((_, index) => ({ value: slotValue(index), label: slotLabel(index) })),
                  { value: 'unallocated', label: t('envelope.unallocated') },
                ]}
              />
            </Surface>
          ))}
        </View>
      )}

      {(formError !== null || error !== null) && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {formError ?? t(`budget.error_${error ?? 'failed'}`)}
        </Text>
      )}
      <Button
        label={saving ? t('budget.saving') : t('budget.apply')}
        // nothing to send until the envelopes are known, or when nothing changed
        disabled={saving || !envelopes.isSuccess || (method === current && rows === null)}
        onPress={() => void apply()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.sm } });
