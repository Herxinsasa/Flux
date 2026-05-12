import fluxLogo from '../../assets/flux-logo-ui.png'

interface AboutDialogProps {
  open: boolean
  version: string
  onClose: () => void
}

const WEBSITE_URL = 'https://github.com/Herxinsasa/Flux'

export function AboutDialog({ open, version, onClose }: AboutDialogProps) {
  const darkMode = document.documentElement.classList.contains('theme-dark')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="关于 Flux">
      <div className="w-[500px] max-w-[92vw] rounded-[var(--radius-md)] border border-[var(--border-visible)] bg-[var(--bg-card)] p-5 shadow-2xl">
        <div className="flex min-h-[168px] flex-col items-center justify-center text-center">
          <div className="flex w-full items-center justify-center gap-4">
            <img
              src={fluxLogo}
              alt="Flux"
              className="h-20 w-20 shrink-0 rounded-2xl border border-[var(--border-subtle)] bg-white/90 p-2"
            />
            <div className="text-left">
              <h2 className="m-0 inline-flex items-center text-3xl font-semibold leading-tight text-[var(--text-primary)]">Flux</h2>
              <p className="mt-1 text-lg font-medium text-[var(--text-secondary)]">for Windows x64</p>
            </div>
          </div>

          <p className="mt-3 inline-flex items-center justify-center gap-2 text-lg text-[var(--text-secondary)]">
            <span>version {version}</span>
            <span aria-hidden>·</span>
            <span>website:</span>
            <a
              href={WEBSITE_URL}
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer text-[var(--accent)] hover:underline"
            >
              Flux
            </a>
          </p>

          <p className="mt-2 text-sm text-[var(--text-hint)]">喜欢就点个star吧~</p>
        </div>

        <div className="mt-4 flex w-full justify-end">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-4 py-2 text-base text-[var(--text-primary)]"
            style={darkMode ? { backgroundColor: '#2563eb', color: '#ffffff', borderColor: '#2563eb' } : undefined}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
