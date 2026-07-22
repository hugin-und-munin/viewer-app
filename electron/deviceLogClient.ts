import log from "electron-log/main";

// Minimal device-log client for the Electron main process. Runs in a
// separate bundle from the renderer (can't reuse src/logging/deviceLogger.ts),
// covers low-volume lifecycle events only (startup, shutdown, crashes, update
// errors) — best-effort, fire-and-forget, never blocks app start/quit, and
// has no offline queue (the renderer's deviceLogger already covers that for
// the high-value network-problem case).

const REQUEST_TIMEOUT_MS = 3000;

interface TokenResponse {
  access_token: string;
  device_id: string;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchToken(): Promise<{ accessToken: string; deviceId: string; apiUrl: string }> {
  const apiUrl = process.env.VITE_API_URL;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!apiUrl || !clientId || !clientSecret) {
    throw new Error("missing CLIENT_ID/CLIENT_SECRET/VITE_API_URL");
  }

  const res = await fetchWithTimeout(`${apiUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
  const data = (await res.json()) as TokenResponse;
  return { accessToken: data.access_token, deviceId: data.device_id, apiUrl };
}

export async function logDeviceEvent(
  level: "info" | "warn" | "error",
  source: "app" | "module" | "lifecycle",
  message: string,
): Promise<void> {
  try {
    const { accessToken, deviceId, apiUrl } = await fetchToken();
    const res = await fetchWithTimeout(`${apiUrl}/devices/${deviceId}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ level, source, message, occurred_at: new Date().toISOString() }),
    });
    if (!res.ok) log.warn(`[devicelog] report failed: ${res.status}`);
  } catch (err) {
    log.warn("[devicelog] failed to report event:", err);
  }
}
