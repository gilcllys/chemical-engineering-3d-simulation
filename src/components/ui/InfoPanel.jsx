import { motion } from 'framer-motion'

function Metric({ label, value, unit, color = '#e2e8f0', bar = null }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 0.3 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}<span style={{ fontSize: 10, marginLeft: 2, color: '#64748b' }}>{unit}</span></span>
      </div>
      {bar !== null && (
        <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
          <motion.div
            animate={{ width: `${bar}%` }}
            transition={{ duration: 0.5 }}
            style={{ height: '100%', background: color, borderRadius: 2 }}
          />
        </div>
      )}
    </div>
  )
}

export default function InfoPanel({ params, efficiency }) {
  const reynoldsEst = Math.round(params.inletVelocity * params.cylinderRadius * 1000 / 1.8e-5)
  const pressureDrop = Math.round(0.5 * 1.2 * params.inletVelocity ** 2 * (3 + params.cylinderRadius))
  const cutSize = Math.round(Math.sqrt((9 * 1.8e-5 * params.cylinderRadius) / (Math.PI * params.cylinderHeight * params.inletVelocity * (1500 - 1.2))) * 1e6 * 10) / 10

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      style={{
        position: 'absolute', top: 16, left: 16,
        width: 220, background: 'rgba(17,24,39,0.92)',
        borderRadius: 12, border: '1px solid #1e293b',
        padding: '14px 16px', backdropFilter: 'blur(8px)',
        zIndex: 50
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        📊 Parâmetros Calculados
      </div>

      <Metric
        label="Eficiência de Separação"
        value={efficiency}
        unit="%"
        color={efficiency > 80 ? '#22c55e' : efficiency > 60 ? '#f59e0b' : '#ef4444'}
        bar={efficiency}
      />
      <Metric label="Queda de Pressão (est.)" value={pressureDrop} unit=" Pa" color="#f59e0b" />
      <Metric label="Tamanho de Corte (d₅₀)" value={cutSize} unit=" µm" color="#a78bfa" />
      <Metric label="Re (estimado)" value={(reynoldsEst / 1000).toFixed(1) + 'k'} unit="" color="#38bdf8" />

      <div style={{ borderTop: '1px solid #1e293b', marginTop: 10, paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.6 }}>
          💡 <strong style={{ color: '#94a3b8' }}>Dica:</strong> Aumente a velocidade de entrada ou reduza o raio para melhorar a eficiência de separação.
        </div>
      </div>
    </motion.div>
  )
}
