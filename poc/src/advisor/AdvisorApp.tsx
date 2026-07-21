import { useState } from 'react'
import './advisor.css'
import { Dashboard } from './Dashboard'
import { Onboarding } from './Onboarding'
import { DEFAULT_INTENT, type IntentConfig } from '../lib/advisor/onboarding/intent'

type Phase = 'onboarding' | 'dashboard'

/**
 * Container for the two-phase advisor experience: an onboarding wizard that
 * collects and validates a mandate, and the post-activation dashboard.
 *
 * `appliedChanges` counts approved agent actions since the last activation,
 * for the wizard's A8 reconfigure notice — Dashboard reports it back via
 * `onAppliedChangesChange` on every approve. It resets on each fresh
 * activation.
 */
export function AdvisorApp() {
  const [phase, setPhase] = useState<Phase>('onboarding')
  const [confirmedIntent, setConfirmedIntent] = useState<IntentConfig | undefined>(undefined)
  const [appliedChanges, setAppliedChanges] = useState(0)

  const handleActivate = (config: IntentConfig) => {
    setConfirmedIntent(config)
    setAppliedChanges(0)
    setPhase('dashboard')
  }

  const handleSkipDemo = () => {
    setConfirmedIntent(DEFAULT_INTENT)
    setAppliedChanges(0)
    setPhase('dashboard')
  }

  const handleReconfigure = () => {
    setPhase('onboarding')
  }

  return (
    <div className="advisor-app">
      {phase === 'onboarding' ? (
        <Onboarding
          initialConfig={confirmedIntent}
          appliedChangesNotice={appliedChanges}
          onActivate={handleActivate}
          onSkipDemo={handleSkipDemo}
        />
      ) : (
        <Dashboard
          intent={confirmedIntent ?? DEFAULT_INTENT}
          onReconfigure={handleReconfigure}
          onAppliedChangesChange={setAppliedChanges}
        />
      )}
    </div>
  )
}
