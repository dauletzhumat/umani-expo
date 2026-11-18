import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { supabase } from '@/lib/supabase/client';

const ActiveBudgetSchema = z.object({
  id: z.uuid(),
  base_currency: z.enum(['KZT', 'USD', 'EUR', 'RUB', 'CNY']),
  method: z.enum(['50_30_20', '80_20', '90_10', '70_20_10', 'custom']),
});
export type ActiveBudget = z.infer<typeof ActiveBudgetSchema>;

export const activeBudgetKey = (userId: string | null) => ['budget', 'active', userId] as const;

/** The user's active budget, or null when onboarding has not created one yet. */
export function useActiveBudget(userId: string | null) {
  return useQuery({
    queryKey: activeBudgetKey(userId),
    enabled: userId !== null,
    queryFn: async (): Promise<ActiveBudget | null> => {
      const { data, error } = await supabase
        .from('budgets')
        .select('id, base_currency, method')
        .eq('is_active', true)
        .maybeSingle();
      if (error !== null) throw error;
      return data === null ? null : ActiveBudgetSchema.parse(data);
    },
  });
}
