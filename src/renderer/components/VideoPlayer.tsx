import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import TelemetryPanel from './TelemetryPanel'

interface Props {
  clip: ClipGroup
  onExport: (startTime: number, duration: number, telemetry: TelemetryFrame[], videoDuration: number) => void
  isExporting: boolean
  exportStatus?: string
  onClipEnd: () => void
}

function parseClipTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`)
}

function formatClock(d: Date): string {
  return d.toTimeString().slice(0, 8)
}

const isKo = navigator.language.startsWith('ko')

const CAMERAS_4CH: { key: keyof ClipGroup['files']; label: string }[] = [
  { key: 'front', label: isKo ? '전면' : 'Front' },
  { key: 'back', label: isKo ? '후면' : 'Rear' },
  { key: 'right_repeater', label: isKo ? '우측' : 'Right' },
  { key: 'left_repeater', label: isKo ? '좌측' : 'Left' },
]

const CAMERAS_6CH: { key: keyof ClipGroup['files']; label: string }[] = [
  { key: 'right_pillar', label: isKo ? '우측B필러' : 'Right B-Pillar' },
  { key: 'front', label: isKo ? '전면' : 'Front' },
  { key: 'left_pillar', label: isKo ? '좌측B필러' : 'Left B-Pillar' },
  { key: 'right_repeater', label: isKo ? '우측' : 'Right' },
  { key: 'back', label: isKo ? '후면' : 'Rear' },
  { key: 'left_repeater', label: isKo ? '좌측' : 'Left' },
]

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4]

export default function VideoPlayer({ clip, onExport, isExporting, exportStatus, onClipEnd }: Props) {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [exportStart, setExportStart] = useState(0)
  const [exportDuration, setExportDuration] = useState(0)
  const [videoErrors, setVideoErrors] = useState<Record<number, string>>({})
  const [autoPlay, setAutoPlay] = useState(false)
  const [telemetry, setTelemetry] = useState<TelemetryFrame[]>([])
  const seekingRef = useRef(false)
  const rafRef = useRef(0)

  const hasPillar = !!(clip.files.left_pillar || clip.files.right_pillar)
  const cameraList = hasPillar ? CAMERAS_6CH : CAMERAS_4CH
  const activeVideos = cameraList
    .map((cam, idx) => ({ ...cam, path: clip.files[cam.key], idx }))
    .filter(v => v.path)

  // Load telemetry when clip changes
  useEffect(() => {
    setCurrentTime(0)
    setDuration(0)
    setFocusedIdx(null)
    setShowExport(false)
    setVideoErrors({})
    setTelemetry([])
    videoRefs.current = []
    if (isPlaying) setAutoPlay(true)
    setIsPlaying(false)

    const frontFile = clip.files.front
    if (frontFile) {
      window.api.extractTelemetry(frontFile).then((frames: TelemetryFrame[]) => {
        if (frames.length > 0) setTelemetry(frames)
      })
    }
  }, [clip.timestamp])

  // Time update loop
  useEffect(() => {
    const tick = () => {
      const primary = videoRefs.current.find(Boolean)
      if (primary && !seekingRef.current) {
        setCurrentTime(primary.currentTime)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // Sync playback rate
  useEffect(() => {
    videoRefs.current.filter(Boolean).forEach(v => { v!.playbackRate = playbackRate })
  }, [playbackRate])

  const allVideos = useCallback(
    () => videoRefs.current.filter(Boolean) as HTMLVideoElement[],
    []
  )

  const handlePlayPause = useCallback(() => {
    const videos = allVideos()
    if (isPlaying) {
      videos.forEach(v => v.pause())
    } else {
      videos.forEach(v => v.play().catch(() => {}))
    }
    setIsPlaying(prev => !prev)
  }, [isPlaying, allVideos])

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    seekingRef.current = true
    setCurrentTime(time)
    allVideos().forEach(v => { v.currentTime = time })
    setTimeout(() => { seekingRef.current = false }, 100)
  }

  const handleSkip = (sec: number) => {
    const t = Math.max(0, Math.min(duration, currentTime + sec))
    seekingRef.current = true
    setCurrentTime(t)
    allVideos().forEach(v => { v.currentTime = t })
    setTimeout(() => { seekingRef.current = false }, 100)
  }

  const handleLoaded = (i: number) => {
    const v = videoRefs.current[i]
    if (v && v.duration && (i === 0 || duration === 0)) {
      setDuration(v.duration)
    }
    if (i === 0 && autoPlay) {
      setAutoPlay(false)
      setTimeout(() => {
        allVideos().forEach(v => v.play().catch(() => {}))
        setIsPlaying(true)
      }, 100)
    }
  }

  const handleVideoError = (i: number, e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget
    const err = video.error
    setVideoErrors(prev => ({
      ...prev,
      [i]: err ? `Error ${err.code}: ${err.message}` : 'Unknown error'
    }))
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const buildSrc = (filePath: string) => {
    // Windows: C:\path → file:///C:/path, macOS: /path → file:///path
    const normalized = filePath.replace(/\\/g, '/')
    const parts = normalized.split('/').map(part => encodeURIComponent(part)).join('/')
    return normalized.match(/^[A-Za-z]:/) ? `file:///${parts}` : `file://${parts}`
  }

  // Get current telemetry frame synced to video time
  const currentFrame = useMemo(() => {
    if (telemetry.length === 0 || duration === 0) return null
    const fps = telemetry.length / duration
    const idx = Math.min(Math.floor(currentTime * fps), telemetry.length - 1)
    return telemetry[Math.max(0, idx)]
  }, [telemetry, currentTime, duration])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Main area: video grid + telemetry panel */}
      <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
        {/* Video Grid */}
        <div style={{
          flex: '1 1 0', minHeight: 0,
          display: 'grid',
          gridTemplateColumns: focusedIdx !== null ? '1fr' : activeVideos.length > 4 ? '1fr 1fr 1fr' : '1fr 1fr',
          gridTemplateRows: focusedIdx !== null ? '1fr' : '1fr 1fr',
          gap: 2, background: '#000', padding: 2,
        }}>
          {activeVideos.map((item, i) => {
            const hidden = focusedIdx !== null && i !== focusedIdx
            return (
              <div
                key={item.key}
                style={{
                  position: 'relative', background: '#000', cursor: 'pointer', overflow: 'hidden',
                  display: hidden ? 'none' : 'block',
                }}
                onDoubleClick={() => {
                  if (focusedIdx === i) {
                    setFocusedIdx(null)
                    // Re-sync all videos to the focused video's currentTime
                    const focusedVideo = videoRefs.current[i]
                    if (focusedVideo) {
                      const t = focusedVideo.currentTime
                      videoRefs.current.forEach((v, idx) => {
                        if (v && idx !== i) {
                          v.currentTime = t
                          if (isPlaying) v.play().catch(() => {})
                        }
                      })
                    }
                  } else {
                    setFocusedIdx(i)
                  }
                }}
              >
                <video
                  ref={el => { videoRefs.current[i] = el }}
                  src={buildSrc(item.path!)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  muted={i !== 0}
                  preload="auto"
                  onLoadedMetadata={() => handleLoaded(i)}
                  onEnded={i === 0 ? () => { onClipEnd(); } : undefined}
                  onError={(e) => handleVideoError(i, e)}
                  onClick={handlePlayPause}
                />
                <div style={{
                  position: 'absolute', top: 8, left: 8,
                  padding: '2px 8px', background: 'rgba(0,0,0,0.7)',
                  borderRadius: 4, fontSize: 12, fontWeight: 600, color: '#fff',
                  pointerEvents: 'none',
                }}>
                  {item.label}
                </div>
                <div style={{
                  position: 'absolute', top: 8, right: 8,
                  padding: '2px 8px', background: 'rgba(0,0,0,0.7)',
                  borderRadius: 4, fontSize: 11, color: '#aaa',
                  pointerEvents: 'none', fontVariantNumeric: 'tabular-nums',
                }}>
                  {clip.date} {(() => {
                    const base = parseClipTime(clip.date, clip.time)
                    base.setSeconds(base.getSeconds() + Math.floor(currentTime))
                    return formatClock(base)
                  })()}
                </div>
                {videoErrors[i] && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.8)', color: '#e94560',
                    fontSize: 13, padding: 16, textAlign: 'center',
                    pointerEvents: 'none',
                  }}>
                    {videoErrors[i]}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Telemetry Panel */}
        <TelemetryPanel frame={currentFrame} />
      </div>

      {/* Controls */}
      <div style={{
        flex: '0 0 auto', padding: '8px 16px',
        background: '#1a1a2e', borderTop: '1px solid #2a2a4a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#aaa', minWidth: 40 }}>{fmt(currentTime)}</span>
          <input
            type="range" min={0} max={duration || 0} step={0.1}
            value={currentTime} onChange={handleSeek}
            style={{ flex: 1, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 12, color: '#aaa', minWidth: 40, textAlign: 'right' }}>{fmt(duration)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Btn onClick={() => handleSkip(-10)}>-10</Btn>
            <Btn onClick={() => handleSkip(-5)}>-5</Btn>
            <Btn onClick={handlePlayPause} primary>
              {isPlaying ? '\u23F8' : '\u25B6'}
            </Btn>
            <Btn onClick={() => handleSkip(5)}>+5</Btn>
            <Btn onClick={() => handleSkip(10)}>+10</Btn>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#aaa', marginRight: 4 }}>{isKo ? '배속:' : 'Speed:'}</span>
            {SPEEDS.map(s => (
              <button
                key={s}
                onClick={() => setPlaybackRate(s)}
                style={{
                  padding: '3px 8px', fontSize: 12,
                  background: playbackRate === s ? '#e94560' : '#16213e',
                  color: playbackRate === s ? '#fff' : '#aaa',
                  border: '1px solid #2a2a4a', borderRadius: 4, cursor: 'pointer',
                }}
              >
                {s}x
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {focusedIdx !== null && (
              <Btn onClick={() => setFocusedIdx(null)}>{activeVideos.length > 4 ? (isKo ? '6분할' : '6-Grid') : (isKo ? '4분할' : '4-Grid')}</Btn>
            )}
            {showExport && (
              <>
                <label style={{ fontSize: 12, color: '#aaa' }}>
                  {isKo ? '시작(초):' : 'Start(s):'}
                  <input type="number" min={0} value={exportStart}
                    onChange={e => setExportStart(Number(e.target.value))}
                    style={{ width: 55, marginLeft: 4, padding: '2px 4px', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 4, color: '#eee', fontSize: 12 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: '#aaa' }}>
                  {isKo ? '길이(초):' : 'Duration(s):'}
                  <input type="number" min={0} value={exportDuration}
                    onChange={e => setExportDuration(Number(e.target.value))}
                    style={{ width: 55, marginLeft: 4, padding: '2px 4px', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: 4, color: '#eee', fontSize: 12 }}
                  />
                </label>
              </>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <button
                onClick={() => {
                  if (showExport) onExport(exportStart, exportDuration, telemetry, duration)
                  else setShowExport(true)
                }}
                disabled={isExporting}
                style={{
                  padding: '6px 14px', fontSize: 13, fontWeight: 600, borderRadius: 6,
                  border: 'none', cursor: isExporting ? 'not-allowed' : 'pointer',
                  background: isExporting ? '#666' : '#e94560', color: '#fff',
                }}
              >
                {isExporting ? (isKo ? '내보내는 중...' : 'Exporting...') : showExport ? (isKo ? '내보내기 시작' : 'Start Export') : (isKo ? '내보내기' : 'Export')}
              </button>
              {isExporting && exportStatus && (
                <span style={{ fontSize: 11, color: '#f39c12', whiteSpace: 'nowrap' }}>
                  {exportStatus}
                </span>
              )}
            </div>
            {showExport && !isExporting && (
              <Btn onClick={() => setShowExport(false)}>{isKo ? '취소' : 'Cancel'}</Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Btn({ onClick, children, primary }: {
  onClick: () => void; children: React.ReactNode; primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: primary ? 40 : 'auto', height: primary ? 40 : 32,
        minWidth: primary ? undefined : 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: primary ? 0 : '0 8px',
        background: primary ? '#e94560' : '#16213e',
        color: '#fff', border: '1px solid #2a2a4a',
        borderRadius: primary ? '50%' : 6, cursor: 'pointer',
        fontSize: primary ? 16 : 12,
      }}
    >
      {children}
    </button>
  )
}
