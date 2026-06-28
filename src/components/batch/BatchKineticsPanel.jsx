import { motion } from 'framer-motion'

function Metric({ label, value, unit, color, bar = null }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#475569', letterSpacing: 0.3 }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>
          {value}<span style={{ fontSize: 10, marginLeft: 2, color: '#94a3b8' }}>{unit}</span>
        </span>
      </div>
      {bar !== null && (
        <div style={{ height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
          <motion.div
            animate={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
            transition={{ duration: 0.5 }}
            style={{ height: '100%', background: color, borderRadius: 3 }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * BatchKineticsPanel
 * ──────────────────
 * Displays live kinetics parameters as a rich "Parâmetros Calculados" card.
 *
 * Props:
 *   kinetics: { Ca, X, k, T, kT }
 */
export default function BatchKineticsPanel({ kinetics }) {
  const { Ca, X, k, T, kT } = kinetics

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      style={{
        position: 'absolute', top: 16, left: 16,
        width: 230,
        background: 'rgba(255,255,255,0.93)',
        borderRadius: 12,
        border: '1px solid #cbd5e1',
        padding: '14px 16px',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 16px rgba(30,41,59,0.10)',
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#2563eb',
        marginBottom: 12, letterSpacing: 0.6, textTransform: 'uppercase',
      }}>
        🧪 Parâmetros Calculados
      </div>

      <Metric
        label="Concentração CA"
        value={Ca.toFixed(3)}
        unit=" mol/L"
        color="#2563eb"
      />
      <Metric
        label="Conversão X"
        value={(X * 100).toFixed(1)}
        unit="%"
        color="#16a34a"
        bar={X * 100}
      />
      <Metric
        label="Constante k"
        value={k.toFixed(4)}
        unit=" s⁻¹"
        color="#7c3aed"
      />
      <Metric
        label="Temperatura"
        value={T.toFixed(0)}
        unit=" K"
        color="#d97706"
      />
      <Metric
        label="k(T) Arrhenius"
        value={kT.toFixed(4)}
        unit=" s⁻¹"
        color="#0891b2"
      />

      {/* Hint — shown only when conversion < 50% */}
      {X < 0.5 && (
        <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
            💡 <strong style={{ color: '#475569' }}>Dica:</strong> Aumente a temperatura
            ou a velocidade de agitação para acelerar a reação.
          </div>
        </div>
      )}
    </motion.div>
  )
}
