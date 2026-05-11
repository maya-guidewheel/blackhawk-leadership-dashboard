import { useState, useEffect, type ReactNode, type FormEvent } from 'react'

const AUTH_KEY = 'bh_auth'
const EXPIRY_MS = 12 * 60 * 60 * 1000 // 12 hours

// No fallback — if VITE_PASSWORD is unset the server will also reject API calls.
const EXPECTED_PASSWORD = import.meta.env.VITE_PASSWORD ?? ''

function isAuthenticated(): boolean {
  const stored = localStorage.getItem(AUTH_KEY)
  if (!stored) return false
  try {
    const { exp } = JSON.parse(stored)
    return typeof exp === 'number' && Date.now() < exp
  } catch {
    return false
  }
}

function setAuth(password: string) {
  // Store expiry + base64-encoded token so apiFetch can send it on every API call.
  localStorage.setItem(AUTH_KEY, JSON.stringify({
    exp: Date.now() + EXPIRY_MS,
    token: btoa(password),
  }))
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(isAuthenticated)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isAuthenticated()) setAuthed(false)
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (authed) return <>{children}</>

  // Build-time misconfiguration — show a clear ops error rather than a broken login.
  if (!EXPECTED_PASSWORD) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary)' }}>
        <div className="bh-card p-8 w-full max-w-sm text-center">
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-danger)' }}>
            Dashboard not configured
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Set <code>VITE_PASSWORD</code> in the environment and redeploy.
          </p>
        </div>
      </div>
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password.trim()) {
      setError('Please enter a password to continue.')
      return
    }
    if (password === EXPECTED_PASSWORD) {
      setAuth(password)
      setAuthed(true)
      setError('')
    } else {
      setError('Incorrect password. Please try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary)' }}>
      <form onSubmit={handleSubmit} className="bh-card p-8 w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-primary)' }}>Blackhawk Molding</h1>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>Color Change Dashboard</p>
        </div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-1 focus:outline-none focus:ring-2 text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          autoFocus
        />
        {error && <p className="text-sm mb-2 mt-1" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button
          type="submit"
          className="w-full mt-4 text-white rounded px-4 py-2.5 font-semibold transition-opacity hover:opacity-90 text-sm"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Sign In
        </button>
      </form>
    </div>
  )
}
