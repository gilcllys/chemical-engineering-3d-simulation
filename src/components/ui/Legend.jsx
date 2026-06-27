import { motion } from 'framer-motion'

const items = [
  { color: '#0077BB', label: 'Partículas muito finas (< 5 µm)' },
  { color: '#33BBEE', label: 'Partículas finas (5–15 µm)' },
  { color: '#EE7733', label: 'Partículas médias (15–30 µm)' },
  { color: '#CC3311', label: 'Partículas grossas (30–60 µm)' },
  { color: '#EE3377', label: 'Partículas muito grossas (> 60 µm)' },
  { color: '#5bc8f5', label: 'Vortex Finder (Cilindro Interno)' },
  { color: '#3a7d94', label: 'Parede do Ciclone' },
]

export default function Legend() {
  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      style={{
        position: 'absolute', bottom: 16, left: 16,
        background: 'rgba(255,255,255,0.93)',
        borderRadius: 10,
        border: '1px solid #cbd5e1',
        padding: '10px 14px',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 12px rgba(30,41,59,0.10)',
        zIndex: 50,
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#475569',
        marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        Legenda
      </div>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <div style={{
            width: 11, height: 11, borderRadius: '50%',
            background: item.color, flexShrink: 0,
            boxShadow: `0 0 5px ${item.color}99`,
            border: '1.5px solid rgba(0,0,0,0.08)',
          }} />
          <span style={{ fontSize: 11, color: '#334155' }}>{item.label}</span>
        </div>
      ))}
    </motion.div>
  )
}
