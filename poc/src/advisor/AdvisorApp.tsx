import { useState } from 'react'
import './advisor.css'
import { Dashboard } from './Dashboard'
import { EarlyAccess } from './EarlyAccess'
import { Onboarding } from './Onboarding'
import { DEFAULT_INTENT, type IntentConfig } from '../lib/advisor/onboarding/intent'

type Phase = 'onboarding' | 'access' | 'dashboard'

/** localStorage key marking that the visitor has already submitted the early-access gate, so future activations skip straight to the dashboard. */
const EARLY_ACCESS_STORAGE_KEY = 'advisor-early-access-submitted'

function hasStoredEarlyAccessSubmission(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(EARLY_ACCESS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function storeEarlyAccessSubmission() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(EARLY_ACCESS_STORAGE_KEY, '1')
  } catch {
    // Storage may be unavailable (private browsing, quota); the in-memory flag still gates this session.
  }
}

/**
 * Container for the advisor experience: an onboarding wizard that collects
 * and validates a mandate, an early-access lead-capture gate on first
 * activation, and the post-activation dashboard.
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
  const [earlyAccessSubmitted, setEarlyAccessSubmitted] = useState(() => hasStoredEarlyAccessSubmission())

  const handleActivate = (config: IntentConfig) => {
    setConfirmedIntent(config)
    setAppliedChanges(0)
    setPhase(earlyAccessSubmitted ? 'dashboard' : 'access')
  }

  const handleSkipDemo = () => {
    setConfirmedIntent(DEFAULT_INTENT)
    setAppliedChanges(0)
    setPhase('dashboard')
  }

  const handleReconfigure = () => {
    setPhase('onboarding')
  }

  const handleEarlyAccessSubmitted = () => {
    storeEarlyAccessSubmission()
    setEarlyAccessSubmitted(true)
  }

  const handlePreviewDashboard = () => {
    setPhase('dashboard')
  }

  return (
    <div className="advisor-app">
      {phase === 'onboarding' && (
        <Onboarding
          initialConfig={confirmedIntent}
          appliedChangesNotice={appliedChanges}
          onActivate={handleActivate}
          onSkipDemo={handleSkipDemo}
        />
      )}
      {phase === 'access' && confirmedIntent && (
        <EarlyAccess
          intent={confirmedIntent}
          onSubmitted={handleEarlyAccessSubmitted}
          onPreviewDashboard={handlePreviewDashboard}
        />
      )}
      {phase === 'dashboard' && (
        <Dashboard
          intent={confirmedIntent ?? DEFAULT_INTENT}
          onReconfigure={handleReconfigure}
          onAppliedChangesChange={setAppliedChanges}
        />
      )}
    </div>
  )
}
