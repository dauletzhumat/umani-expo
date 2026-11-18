import { Screen } from '@/ui/screen';
import { Surface } from '@/ui/surface';
import { Text } from '@/ui/text';

export type PlaceholderScreenProps = Readonly<{ title: string; body: string }>;

/** Shell placeholder for tabs whose features arrive in later milestones. */
export function PlaceholderScreen({ title, body }: PlaceholderScreenProps) {
  return (
    <Screen title={title}>
      <Surface>
        <Text variant="callout" color="textSecondary">
          {body}
        </Text>
      </Surface>
    </Screen>
  );
}
