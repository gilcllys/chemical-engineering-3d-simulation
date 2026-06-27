import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CyclonePage   from './pages/CyclonePage'
import CyclonePage2D from './pages/CyclonePage2D'

const EQUIPMENTS = [
  { id: 'cyclone',      name: 'Ciclone 3D',           icon: '🌀', status: 'available', description: 'Separador Ciclônico 3D' },
  { id: 'cyclone2d',    name: 'Ciclone 2D',            icon: '🌀', status: 'available', description: 'Corte Transversal 2D' },
  { id: 'reactor',      name: 'Reator CSTR',           icon: '⚗️', status: 'coming',    description: 'Em breve' },
  { id: 'distillation', name: 'Coluna de Destilação',  icon: '🏭', status: 'coming',    description: 'Em breve' },
  { id: 'heatexchanger',name: 'Trocador de Calor',     icon: '🔁', status: 'coming',    description: 'Em breve' },
]

export default function App() {
  const [selected, setSelected] = useState('cyclone')

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>

      {/* ── Header ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: '56px',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        boxShadow: '0 1px 4px var(--color-shadow)',
        zIndex: 100, flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>⚙️</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--color-text)', letterSpacing: 0.3 }}>
              Reatores 3D
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              Equipamentos de Engenharia Química
            </div>
          </div>
        </div>

        {/* Equipment selector */}
        <div style={{ display: 'flex', gap: 8 }}>
          {EQUIPMENTS.map(eq => (
            <button
              key={eq.id}
              onClick={() => eq.status === 'available' && setSelected(eq.id)}
              title={eq.description}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8,
                border: selected === eq.id ? '1.5px solid var(--color-primary)' : '1.5px solid var(--color-border)',
                cursor: eq.status === 'available' ? 'pointer' : 'not-allowed',
                background: selected === eq.id ? '#dbeafe' : '#f8fafc',
                color: eq.status === 'coming' ? 'var(--color-muted)' : selected === eq.id ? 'var(--color-primary)' : 'var(--color-text)',
                fontSize: 13, fontWeight: selected === eq.id ? 700 : 500,
                opacity: eq.status === 'coming' ? 0.55 : 1,
                transition: 'all 0.2s',
              }}
            >
              <span>{eq.icon}</span>
              <span>{eq.name}</span>
              {eq.status === 'coming' && (
                <span style={{ fontSize: 10, background: '#e2e8f0', color: '#64748b', padding: '1px 5px', borderRadius: 4 }}>
                  Em breve
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          Arraste para rotacionar · Scroll para zoom
        </div>
      </header>

      {/* ── Content ── */}
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
          {selected === 'cyclone2d' && (
            <motion.div
              key="cyclone2d"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ width: '100%', height: '100%' }}
            >
              <CyclonePage2D />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
