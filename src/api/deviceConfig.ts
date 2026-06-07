let _config: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (_config) return _config
  _config = await window.electronAPI!.configGet()
  return _config
}

export async function loadDeviceConfig(): Promise<{ deviceId: string; token: string }> {
  const { deviceId, token } = await loadConfig()
  return { deviceId, token }
}
