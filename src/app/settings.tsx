import { signOut } from '@/features/auth/api/sign-in';
import { useSession } from '@/features/auth/session-provider';
import { useAppLock } from '@/features/security/app-lock-provider';
import { SettingsScreen } from '@/features/settings/components/settings-screen';

export default function SettingsRoute() {
  const { userId } = useSession();
  const { enabled, setEnabled, confirmOwner, clear } = useAppLock();
  return (
    <SettingsScreen
      userId={userId}
      appLockEnabled={enabled}
      onToggleAppLock={setEnabled}
      // The app is unlocked here, so the owner is authenticated: clear the lock with the session.
      onSignOut={async () => {
        await clear();
        await signOut();
      }}
      confirmOwner={confirmOwner}
      onAccountDeleted={clear}
    />
  );
}
