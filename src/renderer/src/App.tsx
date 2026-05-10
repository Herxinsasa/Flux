import { ErrorBoundary } from './components/ErrorBoundary'
import { AppShell } from './components/layout/AppShell'
import { useTheme } from './hooks/useTheme'

/* ------------------------------------------------------------------ */
/*  App root                                                          */
/* ------------------------------------------------------------------ */

function AppInner() {
  /* Sync data-theme attribute on <html> */
  useTheme()

  return <AppShell />
}

export default function App() {
  return (
    <ErrorBoundary panelName="App">
      <AppInner />
    </ErrorBoundary>
  )
}
