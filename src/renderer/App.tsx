import React, { useState, useCallback, useEffect } from 'react'
import VideoPlayer from './components/VideoPlayer'
import ClipList from './components/ClipList'
import { generateTelemetryFrames } from './utils/telemetry-canvas'

const isKo = navigator.language.startsWith('ko')

export default function App() {
  const [clips, setClips] = useState<ClipGroup[]>([])
  const [selectedClip, setSelectedClip] = useState<ClipGroup | null>(null)
  const [folderPath, setFolderPath] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ latest: string; url: string } | null>(null)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [appVersion, setAppVersion] = useState('')

  // Load settings and listen for update notification
  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion)
    window.api.getAutoUpdate().then(setAutoUpdate)
    window.api.onUpdateAvailable((data) => {
      if (data.hasUpdate) setUpdateInfo({ latest: data.latest, url: data.url })
    })
  }, [])

  const handleSelectFolder = useCallback(async () => {
    const path = await window.api.selectFolder()
    if (!path) return
    setFolderPath(path)
    const scanned = await window.api.scanFolder(path)
    setClips(scanned)
    if (scanned.length > 0) setSelectedClip(scanned[0])
  }, [])

  const [exportStatus, setExportStatus] = useState('')

  const handleExport = useCallback(async (startTime: number, duration: number, telemetry: TelemetryFrame[], videoDuration: number) => {
    if (!selectedClip) return
    const outputPath = await window.api.selectExportPath()
    if (!outputPath) return

    setIsExporting(true)
    let telemetryDir: string | undefined
    let fps = 36

    // Generate telemetry panel frames if data available
    if (telemetry.length > 0) {
      setExportStatus(isKo ? '텔레메트리 패널 렌더링 중...' : 'Rendering telemetry panel...')
      fps = Math.round(telemetry.length / videoDuration) || 36
      const pngFrames = await generateTelemetryFrames(telemetry, fps, (pct) => {
        setExportStatus(isKo ? `텔레메트리 렌더링 ${pct}%` : `Telemetry rendering ${pct}%`)
      })

      setExportStatus(isKo ? '프레임 저장 중...' : 'Saving frames...')
      telemetryDir = await window.api.saveTelemetryFrames(pngFrames)
    }

    setExportStatus(isKo ? '영상 합성 중...' : 'Compositing video...')
    window.api.onExportProgress(() => {})

    const result = await window.api.exportVideo({
      files: {
        front: selectedClip.files.front,
        back: selectedClip.files.back,
        left: selectedClip.files.left_repeater,
        right: selectedClip.files.right_repeater,
        left_pillar: selectedClip.files.left_pillar,
        right_pillar: selectedClip.files.right_pillar,
      },
      outputPath,
      clipTimestamp: selectedClip.timestamp,
      telemetryDir,
      fps,
      startTime,
      duration,
    })

    // Cleanup temp frames
    if (telemetryDir) {
      await window.api.cleanupTemp(telemetryDir)
    }

    window.api.removeExportProgressListener()
    setIsExporting(false)
    setExportStatus('')
    alert(result.success ? (isKo ? '내보내기 완료!' : 'Export complete!') : (isKo ? `내보내기 실패: ${result.error}` : `Export failed: ${result.error}`))
  }, [selectedClip])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>TeslaCam Viewer</h1>
          <button onClick={handleSelectFolder} className="btn-primary">{isKo ? '폴더 열기' : 'Open Folder'}</button>
          {folderPath && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {folderPath}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Auto-update toggle */}
          <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={e => {
                setAutoUpdate(e.target.checked)
                window.api.setAutoUpdate(e.target.checked)
              }}
              style={{ accentColor: '#4ecdc4' }}
            />
            {isKo ? '자동 업데이트' : 'Auto Update'}
          </label>
          {/* Update notification */}
          {updateInfo && (
            <button
              onClick={() => window.api.openUrl(updateInfo.url)}
              style={{
                padding: '3px 10px', fontSize: 12, fontWeight: 600,
                background: '#4ecdc4', color: '#0f0f1a', border: 'none',
                borderRadius: 4, cursor: 'pointer',
              }}
            >
              v{updateInfo.latest} {isKo ? '업데이트' : 'Update'}
            </button>
          )}
          {/* Version */}
          {appVersion && (
            <span style={{ fontSize: 10, color: '#444' }}>v{appVersion}</span>
          )}
        </div>
      </header>

      {/* Main */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {clips.length > 0 && (
          <ClipList clips={clips} selectedClip={selectedClip} onSelect={setSelectedClip} />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedClip ? (
            <VideoPlayer
              clip={selectedClip}
              onExport={handleExport}
              isExporting={isExporting}
              exportStatus={exportStatus}
              onClipEnd={() => {
                const idx = clips.findIndex(c => c.timestamp === selectedClip.timestamp)
                if (idx >= 0 && idx < clips.length - 1) {
                  setSelectedClip(clips[idx + 1])
                }
              }}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: 48, opacity: 0.3 }}>&#x1F3A5;</div>
              <div style={{ fontSize: 16 }}>{isKo ? 'TeslaCam 폴더를 선택하세요' : 'Select a TeslaCam folder'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {isKo ? '폴더 내 영상 파일을 자동으로 인식하여 4채널 동시 재생합니다' : 'Automatically detects video files and plays all channels simultaneously'}
              </div>
              <button onClick={handleSelectFolder} className="btn-primary" style={{ marginTop: 8 }}>
                {isKo ? '폴더 열기' : 'Open Folder'}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .btn-primary {
          padding: 6px 16px;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
        }
        .btn-primary:hover { background: var(--accent-hover); }
      `}</style>
    </div>
  )
}
