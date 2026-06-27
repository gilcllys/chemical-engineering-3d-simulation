import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CyclonePage   from './pages/CyclonePage'
import CyclonePage2D from './pages/CyclonePage2D'
import BatchPage     from './pages/BatchPage'
import BatchPage2D   from './pages/BatchPage2D'
import CSTRPage      from './pages/CSTRPage'
import CSTRPage2D    from './pages/CSTRPage2D'
import PFRPage       from './pages/PFRPage'
import PFRPage2D     from './pages/PFRPage2D'

// ── Equipment groups for the sidebar ──────────────────────────────────────────
const GROUPS = [
  {
    id: 'cyclone',
    name: 'Ciclone',
    icon: '🌀',
    description: 'Separador Ciclônico',
    items: [
      { id: 'cyclone',   label: 'Vista 3D', badge: '3D' },
      { id: 'cyclone2d', label: 'Vista 2D', badge: '2D' },
    ],
  },
  {
    id: 'batch',
    name: 'Reator Batelada',
    icon: '⚗️',
    description: 'Batch Reactor',
    items: [
      { id: 'batch',   label: 'Vista 3D', badge: '3D' },
      { id: 'batch2d', label: 'Vista 2D', badge: '2D' },
    ],
  },
  {
    id: 'cstr',
    name: 'CSTR',
    icon: '🔄',
    description: 'Tanque Agitado Contínuo',
    items: [
      { id: 'cstr',   label: 'Vista 3D', badge: '3D' },
      { id: 'cstr2d', label: 'Vista 2D', badge: '2D' },
    ],
  },
  {
    id: 'pfr',
    name: 'PFR',
    icon: '📏',
    description: 'Reator Tubular',
    items: [
      { id: 'pfr',   label: 'Vista 3D', badge: '3D' },
      { id: 'pfr2d', label: 'Vista 2D', badge: '2D' },
    ],
  },
]

// ── Page renderer map ──────────────────────────────────────────────────────────
const PAGE_MAP = {
  cyclone:   <CyclonePage   />,
  cyclone2d: <CyclonePage2D />,
  batch:     <BatchPage     />,
  batch2d:   <BatchPage2D   />,
  cstr:      <CSTRPage      />,
  cstr2d:    <CSTRPage2D    />,
  pfr:       <PFRPage       />,
  pfr2d:     <PFRPage2D     />,
}

// ── Badge component ────────────────────────────────────────────────────────────
function Badge({ label, active }) {
  const is3D = label === '3D'
  const bg   = active
    ? (is3D ? '#2563eb' : '#16a34a')
    : (is3D ? '#bfdbfe' : '#bbf7d0')
  const color = active ? '#fff' : (is3D ? '#1d4ed8' : '#15803d')
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      background: bg, color, letterSpacing: 0.4, lineHeight: 1.6,
    }}>
      {label}
    </span>
  )
}

// ── Sidebar ────────────────────────────────────────────────────────────────────
function Sidebar({ selected, onSelect }) {
  // determine which group is active
  const activeGroupId = GROUPS.find(g => g.items.some(i => i.id === selected))?.id

  return (
    <nav
      role="navigation"
      aria-label="Navegação de equipamentos"
      style={{
        width: 220,
        flexShrink: 0,
        height: '100%',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        boxShadow: '2px 0 8px var(--color-shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        zIndex: 50,
      }}
    >
      {/* Section title */}
      <div style={{
        padding: '14px 16px 8px',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--color-muted)',
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderBottom: '1px solid var(--color-border)',
        marginBottom: 6,
      }}>
        <span>⚙️</span> Equipamentos
      </div>

      {/* Groups */}
      {GROUPS.map(group => {
        const groupActive = group.id === activeGroupId
        return (
          <div key={group.id}>
            {/* Group header button */}
            <button
              onClick={() => onSelect(group.items[0].id)}
              title={group.description}
              aria-expanded={groupActive}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--color-text)',
                background: groupActive ? '#eff6ff' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                transition: 'background 0.15s',
                textAlign: 'left',
              }}
              onMouseEnter={e => { if (!groupActive) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { if (!groupActive) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: 16 }}>{group.icon}</span>
              <span style={{ flex: 1 }}>{group.name}</span>
            </button>

            {/* Sub-items — always visible (no collapse) */}
            {group.items.map(item => {
              const itemActive = item.id === selected
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  aria-current={itemActive ? 'page' : undefined}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 16px 7px 36px',
                    fontSize: 12,
                    fontWeight: itemActive ? 700 : 500,
                    color: itemActive ? 'var(--color-primary)' : 'var(--color-muted)',
                    background: itemActive ? '#dbeafe' : 'transparent',
                    border: 'none',
                    borderLeft: `3px solid ${itemActive ? 'var(--color-primary)' : 'transparent'}`,
                    borderRadius: '0 8px 8px 0',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!itemActive) e.currentTarget.style.background = '#f1f5f9' }}
                  onMouseLeave={e => { if (!itemActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <Badge label={item.badge} active={itemActive} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}

// ── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [selected, setSelected] = useState('cyclone')

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg)',
    }}>

      {/* ── Header (branding only, 56px) ── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        height: '56px',
        flexShrink: 0,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        boxShadow: '0 1px 4px var(--color-shadow)',
        zIndex: 100,
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

        {/* Version tag */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontSize: 11, color: 'var(--color-muted)',
            background: '#f1f5f9', border: '1px solid var(--color-border)',
            padding: '2px 8px', borderRadius: 6, fontWeight: 600,
          }}>
            v1.0
          </span>
        </div>
      </header>

      {/* ── Body: sidebar + content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <Sidebar selected={selected} onSelect={setSelected} />

        {/* ── Main content ── */}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={selected}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ width: '100%', height: '100%' }}
            >
              {PAGE_MAP[selected]}
            </motion.div>
          </AnimatePresence>
        </main>

      </div>
    </div>
  )
}
