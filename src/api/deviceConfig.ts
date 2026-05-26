export function loadDeviceConfig(): { deviceId: string; token: string } {
  return {
    deviceId: import.meta.env.VITE_DEVICE_ID ?? "",
    token:    import.meta.env.VITE_API_TOKEN  ?? "",
  };
}
