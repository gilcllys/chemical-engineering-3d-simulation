import { useState, useEffect, useRef } from 'react'
import { animate, utils } from 'animejs'

/* ─── helpers ──────────────────────────────────────────────────── */

function usePrevious(value) {
  const ref = useRef(value)
  useEffect(() => { ref.current = value })
  return ref.current
}

/* ─── EquationCard ──────────────────────────────────────────────── */

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
        <span
          ref={valueRef}
          style={{ fontSize: 15, fontWeight: 900, color, display: 'inline-block', transformOrigin: 'center' }}
        >
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

/* ─── BatchEquationsPanel ───────────────────────────────────────── */

/**
 * Props:
 *   kinetics : { Ca, X, k, T, kT }
 *   params   : { initialConc, temperature, agitatorSpeed }
 */
export default function BatchEquationsPanel({ kinetics, params }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)

  const { Ca, X, k, kT } = kinetics
  const { initialConc } = params

  /* flash keys — re-trigger card animations when values change */
  const kineticsKey   = `${Ca.toFixed(4)}-${k.toFixed(4)}`
  const convKey       = `${X.toFixed(4)}`
  const prevKinetics  = usePrevious(kineticsKey)
  const prevConv      = usePrevious(convKey)
  const flashKinetics = kineticsKey !== prevKinetics ? kineticsKey : null
  const flashConv     = convKey     !== prevConv     ? convKey     : null

  /* expand / collapse animation */
  useEffect(() => {
    if (!panelRef.current) return
    if (open) {
      animate(panelRef.current, { height: ['0px', '210px'], opacity: [0, 1], duration: 400, ease: 'outQuart' })
    } else {
      animate(panelRef.current, { height: ['210px', '0px'], opacity: [1, 0], duration: 300, ease: 'inQuart' })
    }
  }, [open])

  /* stagger cards when panel first opens */
  useEffect(() => {
    if (!open || !panelRef.current) return
    const cards = panelRef.current.querySelectorAll('.eq-card')
    if (!cards.length) return
    animate(cards, { translateY: [18, 0], opacity: [0, 1], delay: utils.stagger(55), duration: 380, ease: 'outQuad' })
  }, [open])

  /* derived values */
  const rate      = k * Ca                         // mol/L·s
  const halfLife  = Math.log(2) / Math.max(k, 1e-9)  // s
  const EA_R      = 5000                           // K (fixed model param)

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200 }}>

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
          <span style={{
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s ease',
          }}>▲</span>
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
            <EquationCard
              title="TAXA DE REAÇÃO"
              formula="−rA = k · CA"
              value={rate.toFixed(4)}
              unit=" mol/L·s"
              color="#dc2626"
              description="Velocidade de consumo do reagente A"
              flash={flashKinetics}
            />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard
              title="CONCENTRAÇÃO"
              formula={`CA(t) = CA₀·e^(−kt)  →  CA₀=${initialConc.toFixed(2)}`}
              value={Ca.toFixed(3)}
              unit=" mol/L"
              color="#2563eb"
              description="Concentração atual do reagente"
              flash={flashKinetics}
            />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard
              title="CONVERSÃO"
              formula="X = 1 − CA/CA₀"
              value={(X * 100).toFixed(1)}
              unit="%"
              color="#16a34a"
              description="Fração de reagente convertida"
              flash={flashConv}
            />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard
              title="CONSTANTE k"
              formula="k(T) = k₀·e^(−Ea/R·ΔT)"
              value={kT.toFixed(4)}
              unit=" s⁻¹"
              color="#7c3aed"
              description="Constante de velocidade a T atual"
              flash={flashKinetics}
            />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard
              title="TEMPO DE MEIA-VIDA"
              formula="t½ = ln(2) / k"
              value={halfLife.toFixed(1)}
              unit=" s"
              color="#d97706"
              description="Tempo para converter 50% do reagente"
              flash={flashKinetics}
            />
          </div>

          <div className="eq-card" style={{ display: 'contents' }}>
            <EquationCard
              title="ENERGIA ATIVAÇÃO"
              formula="Ea/R = 5000 K"
              value={EA_R}
              unit=" K"
              color="#0891b2"
              description="Parâmetro de Arrhenius para esta reação"
              flash={null}
            />
          </div>

        </div>

        {/* Constants footer */}
        <div style={{ padding: '0 16px 8px', display: 'flex', gap: 18, fontSize: 10, color: '#94a3b8', flexWrap: 'wrap' }}>
          <span>k₀ = 0.1 s⁻¹ &nbsp;|&nbsp; T<sub>ref</sub> = 350 K</span>
          <span>Ea/R = {EA_R} K</span>
          <span>CA₀ = {initialConc.toFixed(2)} mol/L</span>
          <span>Modelo: 1ª ordem irreversível (Arrhenius)</span>
        </div>
      </div>
    </div>
  )
}
