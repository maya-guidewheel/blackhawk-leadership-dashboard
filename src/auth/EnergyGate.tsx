import { useState, useEffect, type ReactNode, type FormEvent } from 'react'
import { apiFetch } from '../utils/api'

const ENERGY_AUTH_KEY = 'bh_energy_auth'
const ENERGY_EXPIRY_MS = 12 * 60 * 60 * 1000

function isEnergyAuthed(): boolean {
  try {
    const stored = sessionStorage.getItem(ENERGY_AUTH_KEY)
    if (!stored) return false
    const { exp } = JSON.parse(stored)
    return typeof exp === 'number' && Date.now() < exp
  } catch {
    return false
  }
}

function setEnergyAuth(token: string) {
  try {
    sessionStorage.setItem(ENERGY_AUTH_KEY, JSON.stringify({ exp: Date.now() + ENERGY_EXPIRY_MS, token }))
  } catch { /* ignore */ }
}

export default function EnergyGate({ children, onAuth }: { children: ReactNode; onAuth?: () => void }) {
  const [authed, setAuthed] = useState(isEnergyAuthed)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  // When the server restarts, apiFetch detects a 401 on energy routes, clears
  // the stale sessionStorage token, and fires this event. Reset authed so the
  // login form reappears instead of showing an empty "no data" state.
  useEffect(() => {
    function onExpired() { setAuthed(false) }
    window.addEventListener('energy:expired', onExpired)
    return () => window.removeEventListener('energy:expired', onExpired)
  }, [])

  if (authed) return <>{children}</>

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password.trim()) {
      setError('Please enter the executive password to continue.')
      return
    }
    setChecking(true)
    setError('')
    try {
      // Password is validated server-side — no client-side secret needed.
      const res = await apiFetch('/api/auth/energy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        const data = await res.json() as { token?: string }
        setEnergyAuth(data.token ?? '')
        setAuthed(true)
        setError('')
        onAuth?.()
      } else if (res.status === 401) {
        setError('Incorrect password. Please try again or contact your Guidewheel representative.')
      } else if (res.status === 500) {
        setError('Energy tab not configured. Contact your administrator.')
      } else {
        setError(`Server error (HTTP ${res.status}). Try again.`)
      }
    } catch {
      setError('Could not connect to the server.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex items-center justify-center py-24 px-4">
      <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6 w-full max-w-sm shadow-sm">
        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 text-warning px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider mb-3">
            <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            Restricted
          </span>
          <h2 className="text-lg font-semibold text-foreground leading-tight">
            Energy &amp; Cost — Executive Access
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            This section contains financial data restricted to leadership. Enter the executive password to continue.
          </p>
        </div>

        <label htmlFor="bh-energy-password" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Executive Password
        </label>
        <input
          id="bh-energy-password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-pale-foreground focus:outline-none focus:ring-2 focus:ring-btn-primary/30 focus:border-btn-primary"
          autoFocus
          disabled={checking}
          placeholder="Enter password"
        />
        {error && (
          <p className="mt-2 text-sm text-danger">{error}</p>
        )}
        <button
          type="submit"
          disabled={checking}
          className="w-full mt-4 rounded-md bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent disabled:opacity-60 px-4 py-2.5 text-sm font-medium transition-colors"
        >
          {checking ? 'Checking…' : 'Access Energy Data'}
        </button>
      </form>
    </div>
  )
}
