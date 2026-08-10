import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'

// Gated on VITE_SENTRY_DSN being set — unset (the default, e.g. in dev)
// means Sentry.init() never runs, so nothing is captured or sent anywhere.
// release/environment mirror the backend's (see app/main.py): same
// VERSION-driven APP_VERSION, same per-environment tagging.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? 'development',
    release: import.meta.env.VITE_APP_VERSION,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please reload the page.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
