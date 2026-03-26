const PANEL_W = 260
const PANEL_H = 960
const BG = '#0f0f1a'
const GEARS: Record<number, string> = { 0: 'P', 1: 'D', 2: 'R', 3: 'N' }
const AP_LABELS: Record<number, string> = { 0: 'OFF', 1: 'FSD', 2: 'Autosteer', 3: 'TACC' }

// ── Map tile cache ──
const TILE_ZOOM = 17
const TILE_SIZE = 256
const tileCache = new Map<string, HTMLImageElement>()

function lonToTile(lon: number, zoom: number) { return Math.floor(((lon + 180) / 360) * (1 << zoom)) }
function latToTile(lat: number, zoom: number) {
  const r = (Math.PI / 180) * lat
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << zoom))
}
function lonToPixel(lon: number, zoom: number) { return (((lon + 180) / 360) * (1 << zoom) * TILE_SIZE) }
function latToPixel(lat: number, zoom: number) {
  const r = (Math.PI / 180) * lat
  return (((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << zoom) * TILE_SIZE)
}

function loadTile(x: number, y: number, zoom: number): Promise<HTMLImageElement> {
  const key = `${zoom}/${x}/${y}`
  if (tileCache.has(key)) return Promise.resolve(tileCache.get(key)!)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { tileCache.set(key, img); resolve(img) }
    img.onerror = () => resolve(img) // return broken img, we'll draw grey
    img.src = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
  })
}

async function preloadMapTiles(telemetry: TelemetryFrame[]): Promise<void> {
  const tilesToLoad = new Set<string>()
  for (const f of telemetry) {
    if (f.lat === 0 && f.lon === 0) continue
    const tx = lonToTile(f.lon, TILE_ZOOM)
    const ty = latToTile(f.lat, TILE_ZOOM)
    // Load center + surrounding tiles for smooth panning
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        tilesToLoad.add(`${tx + dx},${ty + dy}`)
      }
    }
  }
  const promises: Promise<HTMLImageElement>[] = []
  for (const key of tilesToLoad) {
    const [x, y] = key.split(',').map(Number)
    promises.push(loadTile(x, y, TILE_ZOOM))
  }
  await Promise.all(promises)
}

function drawMap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lat: number, lon: number) {
  // Grey background
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(x, y, w, h)

  if (lat === 0 && lon === 0) return

  const centerPx = lonToPixel(lon, TILE_ZOOM)
  const centerPy = latToPixel(lat, TILE_ZOOM)

  // Draw tiles centered on the GPS position
  const startTx = Math.floor((centerPx - w / 2) / TILE_SIZE)
  const startTy = Math.floor((centerPy - h / 2) / TILE_SIZE)
  const endTx = Math.floor((centerPx + w / 2) / TILE_SIZE)
  const endTy = Math.floor((centerPy + h / 2) / TILE_SIZE)

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  for (let tx = startTx; tx <= endTx; tx++) {
    for (let ty = startTy; ty <= endTy; ty++) {
      const key = `${TILE_ZOOM}/${tx}/${ty}`
      const tile = tileCache.get(key)
      if (tile && tile.complete && tile.naturalWidth > 0) {
        const drawX = x + (tx * TILE_SIZE - centerPx + w / 2)
        const drawY = y + (ty * TILE_SIZE - centerPy + h / 2)
        ctx.drawImage(tile, drawX, drawY, TILE_SIZE, TILE_SIZE)
      }
    }
  }

  // Position marker
  ctx.fillStyle = '#e94560'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x + w / 2, y + h / 2, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.restore()

  // GPS text overlay at bottom
  ctx.fillStyle = 'rgba(0,0,0,0.75)'
  ctx.fillRect(x, y + h - 18, w, 18)
  ctx.fillStyle = '#aaa'
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(`${lat.toFixed(5)}, ${lon.toFixed(5)} | ${0}°`, x + w / 2, y + h - 5)
}

// ── Main render function ──

export function renderTelemetryFrame(
  canvas: HTMLCanvasElement,
  frame: TelemetryFrame,
): void {
  canvas.width = PANEL_W
  canvas.height = PANEL_H
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, PANEL_W, PANEL_H)

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, PANEL_W, PANEL_H)

  let y = 0

  // ── Speed ──
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 56px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  const speedKmh = Math.max(0, Math.abs(frame.speed))
  ctx.fillText(speedKmh.toFixed(0), PANEL_W / 2, y + 65)

  ctx.fillStyle = '#666'
  ctx.font = '14px -apple-system, sans-serif'
  ctx.fillText('km/h', PANEL_W / 2, y + 85)

  // Gear badge
  const gear = GEARS[frame.gear] || '?'
  const gearColor = frame.gear === 1 ? '#4ecdc4' : '#e94560'
  ctx.fillStyle = frame.gear === 1 ? '#16213e' : '#2a1a1a'
  roundRect(ctx, PANEL_W / 2 - 16, y + 92, 32, 20, 4)
  ctx.fill()
  ctx.fillStyle = gearColor
  ctx.font = 'bold 13px -apple-system, sans-serif'
  ctx.fillText(gear, PANEL_W / 2, y + 107)

  y += 125
  ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PANEL_W, y); ctx.stroke()

  // ── Blinkers + Steering Wheel ──
  y += 10
  const wheelCx = PANEL_W / 2
  const wheelCy = y + 55
  const apActive = frame.autopilot > 0
  const wheelColor = apActive ? '#4ecdc4' : '#555'

  drawBlinkerArrow(ctx, wheelCx - 75, wheelCy, true, frame.blinkerLeft)
  drawBlinkerArrow(ctx, wheelCx + 75, wheelCy, false, frame.blinkerRight)

  ctx.save()
  ctx.translate(wheelCx, wheelCy)
  ctx.rotate((frame.steeringAngle * Math.PI) / 180)
  ctx.strokeStyle = wheelColor; ctx.lineWidth = 6
  ctx.beginPath(); ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = '#888'; ctx.lineWidth = 4; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-15, 0); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(30, 0); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, 30); ctx.stroke()
  ctx.fillStyle = '#333'; ctx.strokeStyle = '#555'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = apActive ? '#4ecdc4' : '#e94560'
  ctx.beginPath(); ctx.arc(0, -44, 4, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  y += 115
  ctx.fillStyle = '#aaa'; ctx.font = '13px -apple-system, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(`${frame.steeringAngle.toFixed(1)}°`, PANEL_W / 2, y)

  y += 20
  const apColor = apActive ? '#4ecdc4' : '#666'
  const apLabel = AP_LABELS[frame.autopilot] || 'OFF'
  ctx.fillStyle = apActive ? 'rgba(78,205,196,0.2)' : 'rgba(102,102,102,0.2)'
  const apW = ctx.measureText(apLabel).width + 12
  roundRect(ctx, PANEL_W / 2 - apW / 2, y - 10, apW, 18, 3); ctx.fill()
  ctx.strokeStyle = apColor; ctx.lineWidth = 1
  roundRect(ctx, PANEL_W / 2 - apW / 2, y - 10, apW, 18, 3); ctx.stroke()
  ctx.fillStyle = apColor; ctx.font = '11px -apple-system, sans-serif'
  ctx.fillText(apLabel, PANEL_W / 2, y + 3)

  y += 20
  ctx.strokeStyle = '#1a1a2e'
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PANEL_W, y); ctx.stroke()
  y += 10

  // ── Brake & Accel Gauges ──
  const gaugeW = 36, gaugeH = 80, gapX = 50
  drawGauge(ctx, PANEL_W / 2 - gapX - gaugeW / 2, y, gaugeW, gaugeH, frame.brakeApplied ? 1 : 0, '#e94560', frame.brakeApplied, 'BRK')
  const accelVal = Math.max(0, Math.min(1, frame.accelPedal))
  drawGauge(ctx, PANEL_W / 2 + gapX - gaugeW / 2, y, gaugeW, gaugeH, accelVal, '#4ecdc4', accelVal > 0.01, 'ACC')

  y += gaugeH + 35
  ctx.strokeStyle = '#1a1a2e'
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PANEL_W, y); ctx.stroke()
  y += 5

  // ── Map ──
  const mapH = PANEL_H - y
  drawMap(ctx, 0, y, PANEL_W, mapH, frame.lat, frame.lon)
}

function drawBlinkerArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, isLeft: boolean, active: boolean) {
  ctx.fillStyle = active ? '#f39c12' : '#2a2a4a'
  ctx.beginPath()
  if (isLeft) {
    ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 8, cy - 16); ctx.lineTo(cx + 8, cy + 16)
  } else {
    ctx.moveTo(cx + 12, cy); ctx.lineTo(cx - 8, cy - 16); ctx.lineTo(cx - 8, cy + 16)
  }
  ctx.closePath(); ctx.fill()
}

function drawGauge(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  value: number, color: string, active: boolean, label: string,
) {
  const pct = Math.max(0, Math.min(100, value * 100))
  ctx.fillStyle = '#1a1a2e'; ctx.strokeStyle = active ? color : '#2a2a4a'; ctx.lineWidth = 1
  roundRect(ctx, x, y, w, h, 4); ctx.fill()
  roundRect(ctx, x, y, w, h, 4); ctx.stroke()
  const fillH = (pct / 100) * h
  ctx.fillStyle = color; ctx.globalAlpha = active ? 0.8 : 0.2
  ctx.fillRect(x + 1, y + h - fillH, w - 2, fillH); ctx.globalAlpha = 1
  ctx.fillStyle = active ? color : '#666'; ctx.font = 'bold 11px -apple-system, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(label, x + w / 2, y + h + 16)
  ctx.fillStyle = '#aaa'; ctx.font = '10px -apple-system, sans-serif'
  ctx.fillText(`${pct.toFixed(0)}%`, x + w / 2, y + h + 30)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

export async function generateTelemetryFrames(
  telemetry: TelemetryFrame[],
  fps: number,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array[]> {
  // Preload all map tiles first
  onProgress?.(0)
  await preloadMapTiles(telemetry)

  const canvas = document.createElement('canvas')
  canvas.width = PANEL_W
  canvas.height = PANEL_H
  const frames: Uint8Array[] = []

  for (let i = 0; i < telemetry.length; i++) {
    renderTelemetryFrame(canvas, telemetry[i])
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob(b => resolve(b!), 'image/png')
    )
    frames.push(new Uint8Array(await blob.arrayBuffer()))

    if (onProgress && i % 50 === 0) {
      onProgress(Math.round((i / telemetry.length) * 100))
    }
  }
  return frames
}
