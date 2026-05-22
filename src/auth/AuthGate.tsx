import { useState, useEffect, type ReactNode, type FormEvent } from 'react'

const AUTH_KEY = 'bh_auth'
const EXPIRY_MS = 12 * 60 * 60 * 1000

function isAuthenticated(): boolean {
  const stored = localStorage.getItem(AUTH_KEY)
  if (!stored) return false
  try {
    const { exp, token } = JSON.parse(stored)
    if (typeof exp !== 'number' || Date.now() >= exp) return false
    if (!token) return false
    // Reject old Bearer-format tokens (no colon in decoded value).
    try {
      if (!atob(token).includes(':')) {
        localStorage.removeItem(AUTH_KEY)
        return false
      }
    } catch {
      localStorage.removeItem(AUTH_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

function setAuth(password: string) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({
    exp: Date.now() + EXPIRY_MS,
    token: btoa('admin:' + password),
  }))
}

export default function AuthGate({ children, onLogin }: { children: ReactNode; onLogin?: () => void }) {
  const [authed, setAuthed] = useState(isAuthenticated)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  // Re-check expiry every minute.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isAuthenticated()) setAuthed(false)
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Drop to login immediately when apiFetch receives 401.
  useEffect(() => {
    function handleAuthExpired() { setAuthed(false) }
    window.addEventListener('auth:expired', handleAuthExpired)
    return () => window.removeEventListener('auth:expired', handleAuthExpired)
  }, [])

  if (authed) return <>{children}</>

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password.trim()) {
      setError('Please enter a password to continue.')
      return
    }
    setChecking(true)
    setError('')
    try {
      // Validate the password against the server — no client-side secret needed.
      const token = btoa('admin:' + password)
      const res = await fetch('/api/status', {
        headers: { Authorization: `Basic ${token}` },
      })
      if (res.ok) {
        setAuth(password)
        setAuthed(true)
        onLogin?.()
      } else if (res.status === 401) {
        setError('Incorrect password. Please try again.')
      } else {
        setError(`Server error (HTTP ${res.status}). Try again or contact support.`)
      }
    } catch {
      setError('Could not connect to the server. Check your network and try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6 w-full max-w-sm shadow-sm">
        <div className="mb-6">
          <img
            src="/blackhawk_molding_logo.jpg"
            alt="Blackhawk Molding"
            className="h-10 w-auto object-contain mb-3"
          />
          <div className="text-[10px] font-semibold uppercase tracking-widest text-subtle-foreground">
            Powered by Guidewheel
          </div>
          <h1 className="text-xl font-semibold text-foreground leading-tight mt-0.5">
            Leadership Dashboard
          </h1>
        </div>
        <label htmlFor="bh-auth-password" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Password
        </label>
        <input
          id="bh-auth-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-pale-foreground focus:outline-none focus:ring-2 focus:ring-btn-primary/30 focus:border-btn-primary"
          autoFocus
          disabled={checking}
        />
        {error && (
          <p className="mt-2 text-sm text-danger">{error}</p>
        )}
        <button
          type="submit"
          disabled={checking}
          className="w-full mt-4 rounded-md bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-accent disabled:opacity-60 px-4 py-2.5 text-sm font-medium transition-colors"
        >
          {checking ? 'Checking…' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
