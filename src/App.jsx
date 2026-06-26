import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CyclonePage from './pages/CyclonePage'

const EQUIPMENTS = [
  { id: 'cyclone', name: 'Ciclone', icon: '🌀', status: 'available', description: 'Separador Ciclônico' },
  { id: 'reactor', name: 'Reator CSTR', icon: '⚗️', status: 'coming', description: 'Em breve' },
  { id: 'distillation', name: 'Coluna de Destilação', icon: '🏭', status: 'coming', description: 'Em breve' },
  { id: 'heatexchanger', name: 'Trocador de Calor', icon: '🔁', status: 'coming', description: 'Em breve' },
]

export default function App() {
  const [selected, setSelected] = useState('cyclone')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: '56px', background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)', zIndex: 100, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>⚙️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text)', letterSpacing: 0.5 }}>
              Reatores 3D
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              Equipamentos de Engenharia Química
            </div>
          </div>
        </div>

        {/* Equipment Selector */}
        <div style={{ display: 'flex', gap: 8 }}>
          {EQUIPMENTS.map(eq => (
            <button
              key={eq.id}
              onClick={() => eq.status === 'available' && setSelected(eq.id)}
              title={eq.description}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: eq.status === 'available' ? 'pointer' : 'not-allowed',
                background: selected === eq.id ? 'var(--color-primary)' : 'var(--color-border)',
                color: eq.status === 'coming' ? 'var(--color-muted)' : 'var(--color-text)',
                fontSize: 13, fontWeight: 500, opacity: eq.status === 'coming' ? 0.5 : 1,
                transition: 'all 0.2s'
              }}
            >
              <span>{eq.icon}</span>
              <span>{eq.name}</span>
              {eq.status === 'coming' && <span style={{ fontSize: 10, background: '#334155', padding: '1px 5px', borderRadius: 4 }}>Em breve</span>}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          Arraste para rotacionar • Scroll para zoom
        </div>
      </header>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          {selected === 'cyclone' && (
            <motion.div
              key="cyclone"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ width: '100%', height: '100%' }}
            >
              <CyclonePage />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
