/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bh-primary':    'var(--color-primary)',
        'bh-secondary':  'var(--color-secondary)',
        'bh-accent':     'var(--color-accent)',
        'bh-bg':         'var(--color-background)',
        'bh-surface':    'var(--color-surface)',
        'bh-text':       'var(--color-text)',
        'bh-muted':      'var(--color-muted)',
        'bh-border':     'var(--color-border)',
        'bh-danger':     'var(--color-danger)',
        'bh-warning':    'var(--color-warning)',
        'bh-success':    'var(--color-success)',
      },
      maxWidth: {
        dashboard: '1300px',
      },
    },
  },
  plugins: [],
}
