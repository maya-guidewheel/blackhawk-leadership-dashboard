import { useState, type ReactNode, type FormEvent } from 'react'

const ENERGY_AUTH_KEY = 'bh_energy_auth'
const ENERGY_PASSWORD = import.meta.env.VITE_ENERGY_PASSWORD || 'energy2026'

function isEnergyAuthed(): boolean {
  try {
    return sessionStorage.getItem(ENERGY_AUTH_KEY) === '1'
  } catch {
    return false
  }
}

export default function EnergyGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(isEnergyAuthed)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  if (authed) return <>{children}</>

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password.trim()) {
      setError('Please enter the executive password to continue.')
      return
    }
    if (password === ENERGY_PASSWORD) {
      try { sessionStorage.setItem(ENERGY_AUTH_KEY, '1') } catch { /* ignore */ }
      setAuthed(true)
      setError('')
    } else {
      setError('Incorrect password. Please try again or contact your Guidewheel representative.')
    }
  }

  return (
    <div className="flex items-center justify-center py-24">
      <form onSubmit={handleSubmit} className="bh-card p-8 w-full max-w-sm">
        <div className="mb-6">
          <div
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3"
            style={{ background: '#dbeafe', color: '#1d4ed8' }}
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            Executive Access Required
          </div>
          <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
            Energy &amp; Cost Analysis
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            This section contains financial data restricted to leadership. Enter the executive password to continue.
          </p>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Executive Password
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-1 focus:outline-none focus:ring-2 text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          autoFocus
          placeholder="Enter password"
        />
        {error && (
          <p className="text-sm mt-1 mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>
        )}
        <button
          type="submit"
          className="w-full mt-4 text-white rounded px-4 py-2.5 font-semibold transition-opacity hover:opacity-90 text-sm"
          style={{ backgroundColor: 'var(--color-secondary)' }}
        >
          Access Energy Data
        </button>
      </form>
    </div>
  )
}
