import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { initSentry } from '@/lib/sentry'

initSentry()

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary label="OliTechs">
    <ThemeProvider><App /></ThemeProvider>
  </ErrorBoundary>
)
