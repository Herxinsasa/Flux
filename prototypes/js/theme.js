/* Theme toggle — reads theme from localStorage, applies to document */
(function() {
  const saved = localStorage.getItem('flux-theme') || 'dark'
  document.documentElement.setAttribute('data-theme', saved)
  window.toggleTheme = function() {
    const current = document.documentElement.getAttribute('data-theme')
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('flux-theme', next)
  }
})()
