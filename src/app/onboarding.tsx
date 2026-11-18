import { OnboardingScreen } from '@/features/onboarding/components/onboarding-screen';
import { useAppLock } from '@/features/security/app-lock-provider';

export default function OnboardingRoute() {
  const { setEnabled } = useAppLock();
  return <OnboardingScreen enableLock={() => setEnabled(true)} />;
}
