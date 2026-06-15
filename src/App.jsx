import { useEffect, useState } from 'react'
import Landing from './components/Landing.jsx'
import Capture from './components/Capture.jsx'
import Protocol from './components/Protocol.jsx'

const THEME_KEY = 'protokol-theme'

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  // Экраны: 'landing' → 'capture' → 'protocol'
  const [screen, setScreen] = useState('landing')
  const [protocol, setProtocol] = useState(null)
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const goCapture = () => {
    setScreen('capture')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goLanding = () => {
    setScreen('landing')
    window.scrollTo({ top: 0 })
  }

  const handleProtocol = (data) => {
    setProtocol(data)
    setScreen('protocol')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleRestart = () => {
    setProtocol(null)
    setScreen('capture')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={goLanding} aria-label="На главную">
          <span className="brand__mark">П</span>
          <span className="brand__name">
            Протокол<span>·001</span>
          </span>
        </button>
        <div className="topbar__right">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Переключить тему"
            title="Светлая / тёмная тема"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="app__main">
        {screen === 'landing' && <Landing onStart={goCapture} />}
        {screen === 'capture' && <Capture onResult={handleProtocol} />}
        {screen === 'protocol' && protocol && (
          <Protocol protocol={protocol} onRestart={handleRestart} />
        )}
      </main>

      <footer className="footer">
        <span>Протокол·001 — ИИ-секретарь совещаний</span>
        <span className="mono">claude-sonnet-4-6 · фаза 1 (MVP)</span>
      </footer>
    </div>
  )
}
