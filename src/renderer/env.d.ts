/// <reference types="vite/client" />

interface ClipGroup {
  timestamp: string
  date: string
  time: string
  files: {
    front?: string
    back?: string
    left_repeater?: string
    right_repeater?: string
  }
}

interface TelemetryFrame {
  frameSeq: number
  speed: number
  accelPedal: number
  steeringAngle: number
  blinkerLeft: boolean
  blinkerRight: boolean
  brakeApplied: boolean
  gear: number
  autopilot: number
  lat: number
  lon: number
  heading: number
  accelX: number
  accelY: number
  accelZ: number
}

interface ElectronAPI {
  selectFolder: () => Promise<string | null>
  scanFolder: (path: string) => Promise<ClipGroup[]>
  extractTelemetry: (filePath: string) => Promise<TelemetryFrame[]>
  selectExportPath: () => Promise<string | null>
  saveTelemetryFrames: (frames: Uint8Array[]) => Promise<string>
  cleanupTemp: (dir: string) => Promise<void>
  exportVideo: (options: {
    files: { front?: string; back?: string; left?: string; right?: string }
    outputPath: string
    clipTimestamp?: string
    telemetryDir?: string
    fps?: number
    startTime?: number
    duration?: number
  }) => Promise<{ success: boolean; error?: string }>
  onExportProgress: (callback: (data: { seconds: number }) => void) => void
  removeExportProgressListener: () => void
  getAppVersion: () => Promise<string>
  checkUpdate: () => Promise<{ hasUpdate: boolean; latest: string; url: string } | null>
  getAutoUpdate: () => Promise<boolean>
  setAutoUpdate: (enabled: boolean) => Promise<void>
  openUrl: (url: string) => Promise<void>
  onUpdateAvailable: (callback: (data: { hasUpdate: boolean; latest: string; url: string }) => void) => void
}

interface Window {
  api: ElectronAPI
}
