import posthog from 'posthog-js'

function isDisabled(): boolean {
  return import.meta.env.VITE_POSTHOG_DISABLED === 'true'
}

export function initPostHog() {
  if (isDisabled()) return
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return // no key configured — skip tracking
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
