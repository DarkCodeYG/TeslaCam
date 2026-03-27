import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } from 'electron'
import { join } from 'path'
import { readdir, mkdir, rm, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { is } from '@electron-toolkit/utils'
import { extractTelemetry } from './sei-parser'

// ── Update checker ──
const REPO = 'DarkCodeYG/TeslaCam'
const settingsPath = join(app.getPath('userData'), 'settings.json')

async function loadSettings(): Promise<{ autoUpdate: boolean }> {
  try {
    const data = await readFile(settingsPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { autoUpdate: true }
  }
}

async function saveSettings(settings: { autoUpdate: boolean }) {
  await writeFile(settingsPath, JSON.stringify(settings, null, 2))
}

async function checkForUpdate(): Promise<{ hasUpdate: boolean; latest: string; url: string } | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    if (!res.ok) return null
    const data = await res.json() as { tag_name: string; html_url: string }
    const latest = data.tag_name.replace(/^v/, '')
    const current = app.getVersion()
    const hasUpdate = latest !== current && compareVersions(latest, current) > 0
    return { hasUpdate, latest, url: data.html_url }
  } catch {
    return null
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function getSystemFont(): string {
  const candidates =
    process.platform === 'win32'
      ? ['C:/Windows/Fonts/malgun.ttf', 'C:/Windows/Fonts/arial.ttf']
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/AppleSDGothicNeo.ttc', '/Library/Fonts/Arial Unicode.ttf']
        : ['/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
  for (const f of candidates) {
    if (existsSync(f)) return f
  }
  return candidates[0]
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'TeslaCam Viewer',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Remove CSP headers to allow map tile loading
  const { session } = require('electron')
  session.defaultSession.webRequest.onHeadersReceived((details: any, callback: any) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [''],
      },
    })
  })

  // Custom protocol for local video files
  protocol.handle('local-video', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
    return net.fetch(`file://${filePath}`)
  })

  createWindow()

  // Auto update check on startup
  loadSettings().then(s => {
    if (s.autoUpdate && mainWindow) {
      checkForUpdate().then(result => {
        if (result?.hasUpdate && mainWindow) {
          mainWindow.webContents.send('update-available', result)
        }
      })
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC Handlers ─────────────────────────────────────────

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('check-update', async () => {
  return await checkForUpdate()
})

ipcMain.handle('get-auto-update', async () => {
  const s = await loadSettings()
  return s.autoUpdate
})

ipcMain.handle('set-auto-update', async (_event, enabled: boolean) => {
  await saveSettings({ autoUpdate: enabled })
})

ipcMain.handle('open-url', (_event, url: string) => {
  shell.openExternal(url)
})

ipcMain.handle('save-telemetry-frames', async (_event, frames: Uint8Array[]) => {
  const tempDir = join(tmpdir(), 'teslacam-export-' + Date.now())
  await mkdir(tempDir, { recursive: true })
  for (let i = 0; i < frames.length; i++) {
    const filename = `frame_${String(i).padStart(6, '0')}.png`
    await writeFile(join(tempDir, filename), Buffer.from(frames[i]))
  }
  return tempDir
})

ipcMain.handle('cleanup-temp', async (_event, tempDir: string) => {
  try { await rm(tempDir, { recursive: true }) } catch {}
})

ipcMain.handle('extract-telemetry', async (_event, filePath: string) => {
  try {
    return extractTelemetry(filePath)
  } catch {
    return []
  }
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'TeslaCam 폴더 선택',
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

interface ClipGroup {
  timestamp: string
  date: string
  time: string
  files: {
    front?: string
    back?: string
    left_repeater?: string
    right_repeater?: string
    left_pillar?: string
    right_pillar?: string
  }
}

ipcMain.handle('scan-folder', async (_event, folderPath: string): Promise<ClipGroup[]> => {
  const entries = await readdir(folderPath)
  const mp4Files = entries.filter(f => f.endsWith('.mp4'))
  const groups = new Map<string, ClipGroup>()

  const pattern = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/

  for (const file of mp4Files) {
    const match = file.match(pattern)
    if (!match) continue

    const [, timestamp, camera] = match
    if (!groups.has(timestamp)) {
      const [date, time] = timestamp.split('_')
      groups.set(timestamp, {
        timestamp,
        date,
        time: time.replace(/-/g, ':'),
        files: {},
      })
    }

    const group = groups.get(timestamp)!
    group.files[camera as keyof ClipGroup['files']] = join(folderPath, file)
  }

  return Array.from(groups.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
})

ipcMain.handle('select-export-path', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '내보내기 경로 선택',
    defaultPath: 'teslacam_export.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  })
  if (result.canceled) return null
  return result.filePath
})

interface ExportFiles {
  front?: string; back?: string; left?: string; right?: string
  left_pillar?: string; right_pillar?: string
}

ipcMain.handle('export-video', async (_event, options: {
  files: ExportFiles
  outputPath: string
  clipTimestamp?: string
  telemetryDir?: string
  fps?: number
  startTime?: number
  duration?: number
}) => {
  return exportVideo(options)
})

async function exportVideo(options: {
  files: ExportFiles
  outputPath: string
  clipTimestamp?: string
  telemetryDir?: string
  fps?: number
  startTime?: number
  duration?: number
}): Promise<{ success: boolean; error?: string }> {
  let ffmpegPath: string
  try {
    let p = require('@ffmpeg-installer/ffmpeg').path as string
    if (p.includes('app.asar')) {
      p = p.replace('app.asar', 'app.asar.unpacked')
    }
    ffmpegPath = p
  } catch {
    ffmpegPath = 'ffmpeg'
  }

  const { files, outputPath, clipTimestamp, telemetryDir, fps, startTime, duration } = options

  const available = Object.entries(files).filter(([, path]) => path) as [string, string][]
  if (available.length === 0) {
    return { success: false, error: '내보낼 영상 파일이 없습니다.' }
  }

  // Detect if HW4 (6-channel) by checking for pillar cameras
  const hasPillar = available.some(([key]) => key.includes('pillar'))
  const cols = hasPillar ? 3 : 2
  const rows = 2

  // Cell size: HW4 native uses larger resolution, HW3 uses 640x480
  const cellW = hasPillar ? 724 : 640
  const cellH = hasPillar ? 469 : 480
  const gridW = cellW * cols
  const gridH = cellH * rows
  const panelW = telemetryDir ? 260 : 0
  const outW = gridW + panelW
  const outH = gridH

  // Position map: 4ch = 2x2, 6ch = 3x2
  // 6ch layout:  우측B필러 | 전면 | 좌측B필러
  //              우측      | 후면 | 좌측
  const posMap: Record<string, [number, number]> = hasPillar ? {
    right_pillar: [0, 0],
    front: [cellW, 0],
    left_pillar: [cellW * 2, 0],
    right: [0, cellH],
    back: [cellW, cellH],
    left: [cellW * 2, cellH],
  } : {
    front: [0, 0],
    back: [cellW, 0],
    right: [0, cellH],
    left: [cellW, cellH],
  }

  const args: string[] = []

  if (startTime && startTime > 0) args.push('-ss', startTime.toString())

  for (const [, path] of available) {
    args.push('-i', path)
  }

  const telIdx = available.length
  if (telemetryDir) {
    args.push('-framerate', String(fps || 36), '-i', join(telemetryDir, 'frame_%06d.png'))
  }

  if (duration && duration > 0) args.push('-t', duration.toString())

  const fontPath = getSystemFont().replace(/\\/g, '/').replace(/:/g, '\\\\:')

  let epoch = 0
  if (clipTimestamp) {
    const [datePart, timePart] = clipTimestamp.split('_')
    const timeStr = timePart.replace(/-/g, ':')
    epoch = Math.floor(new Date(`${datePart}T${timeStr}`).getTime() / 1000)
    if (startTime && startTime > 0) epoch += Math.floor(startTime)
  }

  if (available.length === 1 && !telemetryDir) {
    if (epoch) {
      args.push('-vf',
        `drawtext=fontfile=${fontPath}:text='%{pts\\:localtime\\:${epoch}}':fontsize=24:fontcolor=white:borderw=2:bordercolor=black:x=w-tw-10:y=10`
      )
    }
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-y', outputPath)
  } else {
    const filterParts: string[] = []
    const labelMap: Record<string, string> = {
      front: '전면', back: '후면', left: '좌측', right: '우측',
      left_pillar: '좌측B필러', right_pillar: '우측B필러',
    }

    for (let i = 0; i < available.length; i++) {
      const label = labelMap[available[i][0]] || available[i][0]
      filterParts.push(
        `[${i}:v]scale=${cellW}:${cellH},` +
        `drawtext=fontfile=${fontPath}:text='${label}':fontsize=20:fontcolor=white:borderw=2:bordercolor=black:x=8:y=8[v${i}]`
      )
    }

    filterParts.push(`color=black:s=${outW}x${outH}:d=3600[base]`)

    let currentBase = 'base'
    for (let i = 0; i < available.length; i++) {
      const pos = posMap[available[i][0]] || [0, 0]
      const nextLabel = `tmp${i}`
      filterParts.push(`[${currentBase}][v${i}]overlay=${pos[0]}:${pos[1]}:shortest=1[${nextLabel}]`)
      currentBase = nextLabel
    }

    if (telemetryDir) {
      filterParts.push(`[${telIdx}:v]scale=${panelW}:${outH}[tpanel]`)
      filterParts.push(`[${currentBase}][tpanel]overlay=${gridW}:0:shortest=1[withtel]`)
      currentBase = 'withtel'
    }

    if (epoch) {
      filterParts.push(
        `[${currentBase}]drawtext=fontfile=${fontPath}:text='%{pts\\:localtime\\:${epoch}}':fontsize=28:fontcolor=white:borderw=2:bordercolor=black:x=${gridW}-tw-12:y=10[out]`
      )
    } else {
      filterParts.push(`[${currentBase}]null[out]`)
    }

    args.push('-filter_complex', filterParts.join(';'))
    args.push('-map', '[out]', '-map', '0:a?')
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-shortest', '-y', outputPath)
  }

  console.log('[export] ffmpeg args:', JSON.stringify(args))

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args)
    let stderrAll = ''

    proc.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderrAll += chunk
      // Parse progress from the latest chunk
      const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.?\d*)/)
      if (timeMatch && mainWindow) {
        const seconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3])
        mainWindow.webContents.send('export-progress', { seconds: Math.round(seconds) })
      }
    })

    proc.on('close', (code) => {
      console.log('[export] ffmpeg exit code:', code)
      if (code !== 0) console.log('[export] stderr:', stderrAll.slice(-1000))
      resolve(code === 0
        ? { success: true }
        : { success: false, error: `ffmpeg 오류 (code ${code}): ${stderrAll.slice(-500)}` })
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: `ffmpeg 실행 실패: ${err.message}` })
    })
  })
}
