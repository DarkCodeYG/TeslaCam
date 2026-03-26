import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  frame: TelemetryFrame | null
}

const GEARS: Record<number, string> = { 0: 'P', 1: 'D', 2: 'R', 3: 'N' }
const AP_LABELS: Record<number, string> = { 0: 'OFF', 1: 'FSD', 2: 'Autosteer', 3: 'TACC' }

export default function TelemetryPanel({ frame }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMap = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)

  // Init map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([37.48, 127.06], 17)

    // Naver-style satellite tiles via OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    marker.current = L.circleMarker([37.48, 127.06], {
      radius: 7, color: '#e94560', fillColor: '#e94560', fillOpacity: 1, weight: 2,
    }).addTo(map)

    leafletMap.current = map
    return () => { map.remove(); leafletMap.current = null }
  }, [])

  // Update map position
  useEffect(() => {
    if (!frame || !leafletMap.current || !marker.current) return
    if (frame.lat !== 0 && frame.lon !== 0) {
      const pos: L.LatLngExpression = [frame.lat, frame.lon]
      leafletMap.current.setView(pos, 17, { animate: false })
      marker.current.setLatLng(pos)
    }
  }, [frame?.lat, frame?.lon])

  const f = frame || {
    speed: 0, accelPedal: 0, steeringAngle: 0,
    blinkerLeft: false, blinkerRight: false, brakeApplied: false,
    gear: 0, autopilot: 0, lat: 0, lon: 0, heading: 0,
  } as TelemetryFrame

  const speedKmh = Math.max(0, Math.abs(f.speed))
  const accelClamped = Math.max(0, Math.min(1, f.accelPedal))
  const apActive = f.autopilot > 0
  const apColor = apActive ? '#4ecdc4' : '#666'

  return (
    <div style={{
      width: 260, background: '#0f0f1a', borderLeft: '1px solid #2a2a4a',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Speed */}
      <div style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid #1a1a2e' }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {speedKmh.toFixed(0)}
        </div>
        <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>km/h</div>
        <div style={{
          fontSize: 12, marginTop: 6, padding: '2px 8px', display: 'inline-block',
          borderRadius: 4, background: f.gear === 1 ? '#16213e' : '#2a1a1a',
          color: f.gear === 1 ? '#4ecdc4' : '#e94560',
        }}>
          {GEARS[f.gear] || '?'}
        </div>
      </div>

      {/* Steering Wheel + Blinkers */}
      <div style={{ padding: '10px 16px', textAlign: 'center', borderBottom: '1px solid #1a1a2e' }}>
        <style>{`
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.1; }
          }
        `}</style>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          {/* Blinker Left */}
          <svg width="28" height="40" viewBox="0 0 28 40">
            <polygon
              points="4,20 24,4 24,36"
              fill={f.blinkerLeft ? '#f39c12' : '#2a2a4a'}
              style={f.blinkerLeft ? { animation: 'blink 0.8s ease-in-out infinite' } : {}}
            />
          </svg>

          {/* Wheel SVG */}
          <svg width="100" height="100" viewBox="-50 -50 100 100">
            <g transform={`rotate(${f.steeringAngle})`}>
              <circle cx="0" cy="0" r="44" fill="none" stroke={apActive ? '#4ecdc4' : '#555'} strokeWidth="6" />
              <line x1="-30" y1="0" x2="-15" y2="0" stroke="#888" strokeWidth="4" strokeLinecap="round" />
              <line x1="15" y1="0" x2="30" y2="0" stroke="#888" strokeWidth="4" strokeLinecap="round" />
              <line x1="0" y1="15" x2="0" y2="30" stroke="#888" strokeWidth="4" strokeLinecap="round" />
              <circle cx="0" cy="0" r="10" fill="#333" stroke="#555" strokeWidth="2" />
              <circle cx="0" cy="-44" r="4" fill={apActive ? '#4ecdc4' : '#e94560'} />
            </g>
          </svg>

          {/* Blinker Right */}
          <svg width="28" height="40" viewBox="0 0 28 40">
            <polygon
              points="24,20 4,4 4,36"
              fill={f.blinkerRight ? '#f39c12' : '#2a2a4a'}
              style={f.blinkerRight ? { animation: 'blink 0.8s ease-in-out infinite' } : {}}
            />
          </svg>
        </div>

        <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
          {f.steeringAngle.toFixed(1)}°
        </div>
        <div style={{
          fontSize: 11, marginTop: 2, padding: '1px 6px', display: 'inline-block',
          borderRadius: 3, background: apActive ? 'rgba(78,205,196,0.2)' : 'rgba(102,102,102,0.2)',
          color: apColor, border: `1px solid ${apColor}`,
        }}>
          {AP_LABELS[f.autopilot] || 'OFF'}
        </div>
      </div>

      {/* Brake & Accelerator Gauges */}
      <div style={{
        padding: '10px 16px', display: 'flex', gap: 16, justifyContent: 'center',
        borderBottom: '1px solid #1a1a2e',
      }}>
        {/* Brake */}
        <GaugeBar
          label="BRK"
          value={f.brakeApplied ? 1 : 0}
          color="#e94560"
          active={f.brakeApplied}
        />
        {/* Accel */}
        <GaugeBar
          label="ACC"
          value={accelClamped}
          color="#4ecdc4"
          active={accelClamped > 0.01}
        />
      </div>

      {/* Map */}
      <div style={{ flex: 1, minHeight: 150, position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        {/* GPS info overlay */}
        <div style={{
          position: 'absolute', bottom: 4, left: 4, right: 4,
          padding: '2px 6px', background: 'rgba(0,0,0,0.75)',
          borderRadius: 4, fontSize: 10, color: '#aaa', zIndex: 1000,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {f.lat.toFixed(6)}, {f.lon.toFixed(6)} | {f.heading.toFixed(0)}°
        </div>
      </div>
    </div>
  )
}

function GaugeBar({ label, value, color, active }: {
  label: string; value: number; color: string; active: boolean
}) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: 36, height: 80, background: '#1a1a2e', borderRadius: 4,
        border: `1px solid ${active ? color : '#2a2a4a'}`,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: `${pct}%`, background: color, opacity: active ? 0.8 : 0.2,
          transition: 'height 0.1s',
        }} />
      </div>
      <div style={{ fontSize: 11, color: active ? color : '#666', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 10, color: '#aaa', fontVariantNumeric: 'tabular-nums' }}>
        {pct.toFixed(0)}%
      </div>
    </div>
  )
}
