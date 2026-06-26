import { motion } from 'framer-motion'

const items = [
  { color: '#38bdf8', label: 'Fluxo de Gás (Ar Limpo)' },
  { color: '#f97316', label: 'Partículas de Pó/Sólido' },
  { color: '#7dd3fc', label: 'Cilindro Interno (Vortex Finder)' },
  { color: '#4a90a4', label: 'Parede do Ciclone' },
]

export default function Legend() {
  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      style={{
        position: 'absolute', bottom: 16, left: 16,
        background: 'rgba(17,24,39,0.88)',
        borderRadius: 10, border: '1px solid #1e293b',
        padding: '10px 14px', backdropFilter: 'blur(8px)',
        zIndex: 50
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        Legenda
      </div>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0, boxShadow: `0 0 6px ${item.color}` }} />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.label}</span>
        </div>
      ))}
    </motion.div>
  )
}
