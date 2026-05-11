// Fetch wrapper that attaches the stored auth token to every API call.
// The token is set in localStorage by AuthGate after successful login.
const AUTH_KEY = 'bh_auth'

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

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(options.headers as HeadersInit)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...options, headers })
}
