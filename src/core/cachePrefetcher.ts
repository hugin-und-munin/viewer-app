import { getApi } from "../api/api";
import { loadConfig } from "../api/deviceConfig";

interface ModuleDataEntry {
  data: Record<string, unknown>;
}

interface UserProfile {
  media_id?: string | null;
}

interface AppSettingsSummary {
  id: string;
  valid_from: string;
  valid_to: string | null;
}

interface AppSettingsDetail {
  id: string;
  modules: unknown[];
}

interface ApiModule {
  id: string;
}

const PREFETCH_DATE_FILE = "prefetch-date.json";

async function prefetchModule(moduleId: string): Promise<void> {
  let entries: ModuleDataEntry[];
  try {
    entries = await getApi().get<ModuleDataEntry[]>(`/modules/${moduleId}/data`);
  } catch {
    return;
  }

  const mediaIds = new Set<string>();
  const userIds = new Set<string>();

  for (const entry of entries) {
    if (typeof entry.data.media_id === "string") mediaIds.add(entry.data.media_id);
    if (typeof entry.data.user_id === "string") userIds.add(entry.data.user_id);
  }

  await Promise.allSettled(
    [...userIds].map((id) =>
      getApi()
        .get<UserProfile>(`/users/${id}`)
        .then((user) => { if (user.media_id) mediaIds.add(user.media_id); })
        .catch(() => {}),
    ),
  );

  // Blob URLs are discarded — disk cache is the goal
  await Promise.allSettled([...mediaIds].map((id) => getApi().getBlob(`/media/${id}`)));
}

async function prefetchAppSettings(deviceId: string): Promise<void> {
  const { appsettingsLookaheadDays } = await loadConfig();
  let summaries: AppSettingsSummary[];
  try {
    summaries = await getApi().get<AppSettingsSummary[]>(`/devices/${deviceId}/appsettings`);
  } catch {
    return;
  }

  const cutoff = new Date(Date.now() + appsettingsLookaheadDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  const relevant = summaries.filter(
    (s) =>
      new Date(s.valid_from) <= cutoff &&
      (s.valid_to === null || new Date(s.valid_to) >= now),
  );

  await Promise.allSettled(
    relevant.map((s) =>
      getApi().get<AppSettingsDetail>(`/devices/${deviceId}/appsettings/${s.id}`).catch(() => {}),
    ),
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ranToday(): Promise<boolean> {
  if (!window.electronAPI) return false;
  try {
    const raw = await window.electronAPI.cacheRead(PREFETCH_DATE_FILE);
    return !!raw && JSON.parse(raw).date === today();
  } catch {
    return false;
  }
}

async function markDone(): Promise<void> {
  if (!window.electronAPI) return;
  await window.electronAPI.cacheWrite(PREFETCH_DATE_FILE, JSON.stringify({ date: today() }));
}

export async function prefetchAll(): Promise<void> {
  const { disablePrefetch, deviceId, token } = await loadConfig();
  if (disablePrefetch) return;
  if (await ranToday()) return;

  getApi().setAuthToken(token);

  let modules: ApiModule[];
  try {
    modules = await getApi().get<ApiModule[]>("/modules");
  } catch {
    console.warn("[Prefetch] Server not reachable — skipping, will retry on next interval");
    return;
  }

  await Promise.allSettled([
    ...modules.map((m) => prefetchModule(m.id)),
    prefetchAppSettings(deviceId),
  ]).then(() => markDone());
}
