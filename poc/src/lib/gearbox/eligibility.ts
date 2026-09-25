export type RwaEligibilityStatus = 'unknown' | 'checking' | 'eligible' | 'ineligible' | 'error'

export interface RwaExecutionGateInput {
  rwa: boolean
  walletConnected: boolean
  eligibility: RwaEligibilityStatus
  kycRegistrationLink?: string
}

export interface RwaExecutionGateResult {
  canExecute: boolean
  reason?: string
  registrationLink?: string
}

/**
 * Gates execution (approve + open) on Midas eligibility for RWA strategies.
 * Non-RWA routes and a disconnected wallet are unaffected — the existing
 * connect-wallet flow already covers that case before this gate applies.
 */
export function rwaExecutionGate({
  rwa,
  walletConnected,
  eligibility,
  kycRegistrationLink,
}: RwaExecutionGateInput): RwaExecutionGateResult {
  if (!rwa || !walletConnected) return { canExecute: true }

  switch (eligibility) {
    case 'eligible':
      return { canExecute: true }
    case 'ineligible':
      return {
        canExecute: false,
        reason: "Your wallet isn't eligible for this strategy yet.",
        registrationLink: kycRegistrationLink,
      }
    case 'error':
      return { canExecute: false, reason: "Couldn't verify eligibility. Try again." }
    case 'checking':
    case 'unknown':
      return { canExecute: false, reason: 'Checking eligibility…' }
  }
}
