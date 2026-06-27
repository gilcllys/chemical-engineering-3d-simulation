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
            animate={{ width: `${bar}%` }}
            transition={{ duration: 0.5 }}
            style={{ height: '100%', background: color, borderRadius: 3 }}
          />
        </div>
      )}
    </div>
  )
}

export default function InfoPanel({ params, efficiency }) {
  const pressureDrop = Math.round(6.4 * 0.5 * 1.2 * params.inletVelocity ** 2)
  const d50_um = Math.round(
    Math.sqrt(Math.max(0,
      (9 * 1.81e-5 * params.inletWidth) /
      (Math.PI * ((params.cylinderHeight + params.coneHeight / 2) / params.inletWidth) *
       params.inletVelocity * (1500 - 1.2))
    )) * 1e6 * 10
  ) / 10
  const Re = Math.round((1.2 * params.inletVelocity * 2 * params.cylinderRadius) / 1.81e-5)

  const effColor = efficiency > 80 ? '#16a34a' : efficiency > 55 ? '#d97706' : '#dc2626'

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
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#2563eb',
        marginBottom: 12, letterSpacing: 0.6, textTransform: 'uppercase',
      }}>
        📊 Parâmetros Calculados
      </div>

      <Metric label="Eficiência de Separação" value={efficiency} unit="%" color={effColor} bar={efficiency} />
      <Metric label="Queda de Pressão (est.)"  value={pressureDrop} unit=" Pa"  color="#d97706" />
      <Metric label="Tamanho de Corte (d₅₀)"  value={d50_um}      unit=" µm"  color="#7c3aed" />
      <Metric label="Reynolds (est.)"          value={(Re/1000).toFixed(1)+'k'} unit="" color="#0284c7" />

      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
          💡 <strong style={{ color: '#475569' }}>Dica:</strong> Aumente a velocidade ou reduza o raio para melhorar a eficiência.
        </div>
      </div>
    </motion.div>
  )
}
