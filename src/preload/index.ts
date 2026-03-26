import { contextBridge, ipcRenderer } from 'electron'

const api = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (path: string) => ipcRenderer.invoke('scan-folder', path),
  extractTelemetry: (filePath: string) => ipcRenderer.invoke('extract-telemetry', filePath),
  selectExportPath: () => ipcRenderer.invoke('select-export-path'),
  saveTelemetryFrames: (frames: Uint8Array[]) => ipcRenderer.invoke('save-telemetry-frames', frames),
  cleanupTemp: (dir: string) => ipcRenderer.invoke('cleanup-temp', dir),
  exportVideo: (options: {
    files: { front?: string; back?: string; left?: string; right?: string }
    outputPath: string
    clipTimestamp?: string
    telemetryDir?: string
    fps?: number
    startTime?: number
    duration?: number
  }) => ipcRenderer.invoke('export-video', options),
  onExportProgress: (callback: (data: { seconds: number }) => void) => {
    ipcRenderer.on('export-progress', (_event, data) => callback(data))
  },
  removeExportProgressListener: () => {
    ipcRenderer.removeAllListeners('export-progress')
  },
  // Update
  getAppVersion: () => ipcRenderer.invoke('get-app-version') as Promise<string>,
  checkUpdate: () => ipcRenderer.invoke('check-update') as Promise<{ hasUpdate: boolean; latest: string; url: string } | null>,
  getAutoUpdate: () => ipcRenderer.invoke('get-auto-update') as Promise<boolean>,
  setAutoUpdate: (enabled: boolean) => ipcRenderer.invoke('set-auto-update', enabled),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  onUpdateAvailable: (callback: (data: { hasUpdate: boolean; latest: string; url: string }) => void) => {
    ipcRenderer.on('update-available', (_event, data) => callback(data))
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
