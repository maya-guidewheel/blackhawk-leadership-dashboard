const AUTH_KEY = 'bh_auth'
const ENERGY_AUTH_KEY = 'bh_energy_auth'

function getToken(): string {
  try {
    const stored = localStorage.getItem(AUTH_KEY)
    if (!stored) return ''
    const parsed = JSON.parse(stored) as { token?: string }
    return parsed.token ?? ''
  } catch {
    return ''
  }
}

function getEnergyToken(): string {
  try {
    const stored = sessionStorage.getItem(ENERGY_AUTH_KEY)
    if (!stored) return ''
    const { token } = JSON.parse(stored) as { token?: string }
    return token ?? ''
  } catch {
    return ''
  }
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY)
}

export function clearEnergyAuth(): void {
  try { sessionStorage.removeItem(ENERGY_AUTH_KEY) } catch { /* ignore */ }
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(options.headers as HeadersInit)
  if (token) headers.set('Authorization', `Basic ${token}`)

  // Attach the energy session token for energy data requests.
  if (url.startsWith('/api/data/energy')) {
    const energyToken = getEnergyToken()
    if (energyToken) headers.set('X-Energy-Token', energyToken)
  }

  const response = await fetch(url, { ...options, headers })

  if (response.status === 401) {
    if (url.startsWith('/api/data/energy')) {
      // Stale energy session (server restarted) — clear token so EnergyGate re-shows login.
      clearEnergyAuth()
      window.dispatchEvent(new Event('energy:expired'))
    } else if (url !== '/api/auth/energy') {
      clearAuth()
      window.dispatchEvent(new Event('auth:expired'))
    }
  }
  return response
}
