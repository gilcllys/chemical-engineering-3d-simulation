import { useState, useEffect, useRef } from 'react'
import { animate, utils } from 'animejs'
import {
  calcNe, calcD50, calcEfficiency, stokesNumber,
  pressureDrop, RHO_GAS, MU_GAS, RHO_PARTICLE,
} from '../../physics/cycloneForces'

function usePrevious(value) {
  const ref = useRef(value)
  useEffect(() => { ref.current = value })
  return ref.current
}

function EquationCard({ title, formula, value, unit, color, description, flash }) {
  const valueRef = useRef(null)
  const cardRef  = useRef(null)
  const prevFlash = usePrevious(flash)

  useEffect(() => {
    if (!flash || flash === prevFlash) return
    if (!valueRef.current || !cardRef.current) return
    animate(valueRef.current, { scale: [1, 1.3, 1], duration: 520, ease: 'outElastic(1, 0.5)' })
    animate(cardRef.current, { borderColor: [color, color + '44'], duration: 900, ease: 'outQuad' })
  }, [flash]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={cardRef}
      style={{
        background: '#f8fafc',
        border: `1.5px solid ${color}55`,
        borderRadius: 10,
        padding: '10px 13px',
        minWidth: 175,
        flex: '1 1 175px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        boxShadow: '0 1px 4px rgba(30,41,59,0.07)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {title}
        </span>
        <span ref={valueRef} style={{ fontSize: 15, fontWeight: 900, color, display: 'inline-block', transformOrigin: 'center' }}>
          {value}<span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 2 }}>{unit}</span>
        </span>
      </div>
      <div style={{ fontSize: 10, color, fontFamily: 'monospace', opacity: 0.85, lineHeight: 1.3 }}>
        {formula}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
        {description}
      </div>
    </div>
  )
}

export default function EquationsPanel({ params }) {
  const [open, setOpen] = useState(false)
  const panelRef  = useRef(null)
  const prevParams = usePrevious(params)

  const { cylinderRadius: R, cylinderHeight: Hc, coneHeight: Hz, inletVelocity: Vi, particleSize, inletWidth: B } = params

  const Ne     = calcNe(Hc, Hz, B)
  const d50_m  = calcD50(Vi, R, Hc, Hz, B)
  const d50_um = d50_m * 1e6
  const dp_m   = particleSize * 1e-6
  const eta    = calcEfficiency(dp_m, d50_m) * 100
  const St     = stokesNumber(dp_m, Vi, R)
  const dP     = pressureDrop(Vi)
  const Re     = (RHO_GAS * Vi * 2 * R) / MU_GAS

  const geomKey = `${R}-${Hc}-${Hz}-${B}`
  const flowKey = `${Vi}-${particleSize}`
  const prevGeomKey = usePrevious(geomKey)
  const prevFlowKey = usePrevious(flowKey)
  const flashGeom = geomKey !== prevGeomKey ? geomKey : null
  const flashFlow = flowKey !== prevFlowKey ? flowKey : null

  useEffect(() => {
    if (!panelRef.current) return
    if (open) {
      animate(panelRef.current, { height: ['0px', '230px'], opacity: [0, 1], duration: 400, ease: 'outQuart' })
    } else {
      animate(panelRef.current, { height: ['230px', '0px'], opacity: [1, 0], duration: 300, ease: 'inQuart' })
    }
  }, [open])

  useEffect(() => {
    if (!open || !panelRef.current) return
    const cards = panelRef.current.querySelectorAll('.eq-card')
    if (!cards.length) return
    animate(cards, { translateY: [18, 0], opacity: [0, 1], delay: utils.stagger(55), duration: 380, ease: 'outQuad' })
  }, [open])

  const etaColor = eta > 80 ? '#16a34a' : eta > 55 ? '#d97706' : '#dc2626'
  const reStr    = Re >= 1000 ? `${(Re / 1000).toFixed(1)}k` : Re.toFixed(0)

  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 60 }}>

      {/* Toggle button */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            background: 'rgba(255,255,255,0.97)',
            border: '1px solid #cbd5e1',
            borderBottom: 'none',
            borderRadius: '8px 8px 0 0',
            color: '#475569',
            padding: '5px 22px',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 7,
            letterSpacing: 0.5, userSelect: 'none',
            boxShadow: '0 -2px 6px rgba(30,41,59,0.07)',
          }}
        >
          <span>📐</span>
          <span style={{ fontWeight: 700 }}>EQUAÇÕES E CÁLCULOS</span>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s ease' }}>▲</span>
        </button>
      </div>

      {/* Sliding panel */}
      <div
        ref={panelRef}
        style={{
          height: 0, overflow: 'hidden',
          background: 'rgba(248,250,252,0.98)',
          borderTop: '1px solid #cbd5e1',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 -4px 16px rgba(30,41,59,0.08)',
        }}
      >
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px 8px', overflowX: 'auto', flexWrap: 'wrap' }}>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard title="Rotações Efetivas"
              formula={`Ne = (Hc + Hz/2) / B  →  ${Ne.toFixed(2)}`}
              value={Ne.toFixed(1)} unit="rot" color="#7c3aed"
              description="Número efetivo de espiras. Maior Ne → maior tempo de separação."
              flash={flashGeom} />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard title="Tamanho de Corte d₅₀"
              formula="d₅₀ = √( 9μB / πNeVᵢΔρ )  [Lapple]"
              value={d50_um.toFixed(1)} unit="µm" color="#d97706"
              description="50 % das partículas com dp = d₅₀ são coletadas. Lapple (1951)."
              flash={flashGeom || flashFlow} />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard title="Eficiência (Lapple)"
              formula="η = 1 / [1 + (d₅₀/dp)²]"
              value={eta.toFixed(1)} unit="%" color={etaColor}
              description={`Eficiência para dp = ${particleSize} µm.`}
              flash={flashGeom || flashFlow} />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard title="Número de Stokes"
              formula="St = ρₚ·dp²·Vᵢ / (18μD)"
              value={St < 0.01 ? St.toExponential(1) : St.toFixed(3)} unit="" color="#0284c7"
              description="St ≫ 1 → inércia domina. St ≪ 1 → partícula segue o gás."
              flash={flashFlow} />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard title="Queda de Pressão"
              formula="ΔP = Eu · ½ρgVᵢ²  (Eu = 6.4)"
              value={Math.round(dP)} unit="Pa" color="#EE7733"
              description="Custo energético. Proporcional a Vᵢ². Típico: 500 – 2 500 Pa."
              flash={flashFlow} />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard title="Reynolds"
              formula="Re = ρg·Vᵢ·D / μ"
              value={reStr} unit="" color="#0077BB"
              description="Regime turbulento (Re ≫ 4 000) — condição normal em ciclones industriais."
              flash={flashGeom || flashFlow} />
          </div>

        </div>

        {/* Constants footer */}
        <div style={{ padding: '0 16px 8px', display: 'flex', gap: 18, fontSize: 10, color: '#94a3b8', flexWrap: 'wrap' }}>
          <span>ρ<sub>gás</sub> = {RHO_GAS} kg/m³ (ar)</span>
          <span>μ = {MU_GAS.toExponential(2)} Pa·s</span>
          <span>ρ<sub>part.</sub> = {RHO_PARTICLE} kg/m³</span>
          <span>Modelo: Lapple (1951) + Rankine vortex</span>
        </div>
      </div>
    </div>
  )
}
