let _config: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (_config) return _config
  _config = await window.electronAPI!.configGet()
  return _config
}

export async function loadDeviceConfig(): Promise<{ deviceId: string }> {
  // Import here to avoid circular dependency (tokenManager → loadConfig → tokenManager)
  const { getTokenManager } = await import('./tokenManager')
  const { deviceId } = await getTokenManager().getToken()
  return { deviceId }
}
