import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import type { CurrencyCode } from '@/domain/money/currency';
import { useIntentKey } from '@/lib/use-intent-key';
import { Button } from '@/ui/button';
import { ChoiceList } from '@/ui/choice-list';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

import {
  archiveCategory,
  createCategory,
  updateCategory,
  useCategories,
  useRefreshAfterSetupWrite,
  useSpendEnvelopes,
} from '../api/expenses';
import type { Category, CategoryKind, ExpenseError } from '../model/expense';
import { LoadError } from './load-error';
import { categoryLabel, envelopeLabel } from './labels';

const NONE = 'none';
const MAX_NAME = 40;

export type CategoryScreenProps = Readonly<{
  userId: string | null;
  base: CurrencyCode;
  kind: CategoryKind;
  /** Set when editing; otherwise a new category of `kind` is created. */
  initial?: Category;
  onDone: () => void;
}>;

/** Create or edit a category: name and (for expenses) the default envelope; archive (EXP-2). */
export function CategoryScreen({ userId, base, kind, initial, onDone }: CategoryScreenProps) {
  const { t } = useTranslation();
  const refresh = useRefreshAfterSetupWrite();
  const categories = useCategories(userId);
  const envelopes = useSpendEnvelopes(userId, base);
  const intent = useIntentKey();

  const currentLabel = initial === undefined ? '' : categoryLabel(initial, t);
  const [name, setName] = useState(currentLabel);
  const [envelopeId, setEnvelopeId] = useState<string>(initial?.defaultEnvelopeId ?? NONE);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ExpenseError | null>(null);
  const [saving, setSaving] = useState(false);

  const loadFailed = categories.isError || envelopes.isError;
  const retryLoad = () => {
    void categories.refetch();
    void envelopes.refetch();
  };

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_NAME) {
      setNameError(t('expenses.error_invalid_name'));
      return;
    }
    // the database compares custom names only; defaults are compared here by their translation
    const clash = (categories.data ?? []).some(
      (c) => c.kind === kind && c.id !== initial?.id && categoryLabel(c, t).toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
    );
    if (clash) {
      setNameError(t('expenses.error_duplicate_name'));
      return;
    }
    setNameError(undefined);
    setError(null);
    setSaving(true);
    const defaultEnvelopeId = kind === 'expense' && envelopeId !== NONE ? envelopeId : null;
    const result =
      initial === undefined
        ? await createCategory(kind, trimmed, defaultEnvelopeId, intent.keyFor(`${kind}|${trimmed}|${defaultEnvelopeId}`))
        : await updateCategory(initial.id, {
            name: trimmed === currentLabel ? undefined : trimmed,
            defaultEnvelopeId: kind === 'expense' ? defaultEnvelopeId : initial.defaultEnvelopeId,
          });
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    intent.reset();
    onDone();
    void refresh();
  }

  function confirmArchive() {
    if (initial === undefined) return;
    Alert.alert(t('expenses.archiveCategoryTitle'), t('expenses.archiveCategoryMessage'), [
      { text: t('expenses.cancel'), style: 'cancel' },
      {
        text: t('expenses.archiveCategory'),
        style: 'destructive',
        onPress: () => {
          setSaving(true);
          void archiveCategory(initial.id).then((result) => {
            if (!result.ok) {
              setSaving(false);
              setError(result.error);
              return;
            }
            onDone();
            void refresh();
          });
        },
      },
    ]);
  }

  return (
    <Screen>
      {loadFailed && <LoadError onRetry={retryLoad} />}
      <TextField
        label={t('expenses.categoryName')}
        value={name}
        onChangeText={setName}
        maxLength={MAX_NAME}
        autoFocus={initial === undefined}
        error={nameError}
      />
      {kind === 'expense' && (
        <>
          <Text variant="footnote" color="textSecondary">
            {t('expenses.defaultEnvelopeLabel')}
          </Text>
          <ChoiceList
            accessibilityLabel={t('expenses.defaultEnvelopeLabel')}
            value={envelopeId}
            onChange={setEnvelopeId}
            choices={[
              { value: NONE, label: t('expenses.noDefaultEnvelope') },
              ...(envelopes.data ?? []).map((e) => ({ value: e.id, label: envelopeLabel(e, t) })),
            ]}
          />
        </>
      )}
      {error !== null && (
        <Text variant="footnote" color="negative" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(`expenses.error_${error}`)}
        </Text>
      )}
      <Button label={saving ? t('expenses.saving') : t('expenses.save')} disabled={saving} onPress={() => void save()} />
      {initial !== undefined && (
        <Button label={t('expenses.archiveCategory')} variant="destructive" disabled={saving} onPress={confirmArchive} />
      )}
    </Screen>
  );
}
