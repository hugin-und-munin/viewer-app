export async function loadDeviceConfig(): Promise<{ deviceId: string; token: string }> {
  if (window.electronAPI) {
    return window.electronAPI.configGet();
  }
  return { deviceId: "", token: "" };
}
