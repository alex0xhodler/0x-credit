import { useState } from 'react'
import './advisor.css'
import { AdvisorDashboard } from '../AdvisorDashboard'
import { Onboarding } from './Onboarding'
import { DEFAULT_INTENT, type IntentConfig } from '../lib/advisor/onboarding/intent'

type Phase = 'onboarding' | 'dashboard'

/**
 * Container for the two-phase advisor experience: an onboarding wizard that
 * collects and validates a mandate, and the post-activation dashboard.
 *
 * Pass A keeps the dashboard phase rendering the existing, unchanged
 * {@link AdvisorDashboard}; Pass B replaces it with the restructured
 * dashboard. `appliedChanges` counts approved agent actions since activation
 * for the Reconfigure notice — wired to real mutations in Pass B, so it stays
 * 0 here.
 */
export function AdvisorApp() {
  const [phase, setPhase] = useState<Phase>('onboarding')
  const [confirmedIntent, setConfirmedIntent] = useState<IntentConfig | undefined>(undefined)
  const [appliedChanges] = useState(0)

  const handleActivate = (config: IntentConfig) => {
    setConfirmedIntent(config)
    setPhase('dashboard')
  }

  const handleSkipDemo = () => {
    setConfirmedIntent(DEFAULT_INTENT)
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
        <>
          <button type="button" className="advisor-app-reconfigure" onClick={handleReconfigure}>
            Reconfigure
          </button>
          <AdvisorDashboard />
        </>
      )}
    </div>
  )
}
