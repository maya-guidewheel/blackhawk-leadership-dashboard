import posthog from 'posthog-js'

const DEFAULT_KEY = 'phc_QIgbD8nFuxMwPrURQbXJxKqI1uEwrmWrnorrr5v1oto'

function isDisabled(): boolean {
  return import.meta.env.VITE_POSTHOG_DISABLED === 'true'
}

export function initPostHog() {
  if (isDisabled()) return
  const key = import.meta.env.VITE_POSTHOG_KEY || DEFAULT_KEY
  posthog.init(key, {
    api_host: 'https://us.i.posthog.com',
    autocapture: false,
  })
  posthog.capture('$pageview')
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (isDisabled()) return
  posthog.capture(event, properties)
}
