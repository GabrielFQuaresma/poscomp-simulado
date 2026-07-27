import { useEffect } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Exam from './pages/Exam'
import Results from './pages/Results'
import Stats from './pages/Stats'
import Topics from './pages/Topics'
import { startSync } from './lib/sync'

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded-md text-sm font-medium ${
          isActive
            ? 'bg-indigo-600 text-white'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function App() {
  // Sem as variaveis do Supabase isto e uma funcao que retorna na primeira
  // linha; com elas, e o unico ponto de partida da sincronia no app inteiro.
  // A propria startSync se protege da montagem dupla do StrictMode.
  useEffect(() => {
    startSync()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <NavLink to="/" className="font-semibold text-lg">
            Simulado POSCOMP
          </NavLink>
          <nav className="flex gap-1">
            <NavItem to="/">Inicio</NavItem>
            <NavItem to="/topicos">Temas</NavItem>
            <NavItem to="/stats">Estatisticas</NavItem>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/exam/:sessionId" element={<Exam />} />
          <Route path="/results/:sessionId" element={<Results />} />
          <Route path="/topicos" element={<Topics />} />
          <Route path="/stats" element={<Stats />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
