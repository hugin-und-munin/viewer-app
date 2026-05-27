import { getApi } from "./api";
import { loadConfig } from "./deviceConfig";
import type { ModuleProps } from "../types/modules";

interface AppSettingsSummary {
  id: string;
  valid_from: string;
  valid_to: string | null;
}

interface ModuleEntry {
  module_id: string;
  settings: Record<string, unknown>;
}

interface AppSettingsDetail {
  id: string;
  modules: ModuleEntry[];
}

interface ApiModule {
  id: string;
  type: string;
}

function findActive(settings: AppSettingsSummary[]): AppSettingsSummary | undefined {
  const now = new Date();
  const terminated = settings.find((s) => {
    if (!s.valid_to) return false;
    return new Date(s.valid_from) <= now && now <= new Date(s.valid_to);
  });
  if (terminated) return terminated;
 // returns newest default config
  return settings
    .filter((s) => !s.valid_to && new Date(s.valid_from) <= now)
    .sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime())[0];
}

export async function getCurrentModules(): Promise<ModuleProps[]> {
  const { deviceId, token } = await loadConfig();
  getApi().setAuthToken(token);

  const settings = await getApi().get<AppSettingsSummary[]>(`/devices/${deviceId}/appsettings`);
  const active = findActive(settings);
  if (!active) return [];

  const [detail, modules] = await Promise.all([
    getApi().get<AppSettingsDetail>(`/devices/${deviceId}/appsettings/${active.id}`),
    getApi().get<ApiModule[]>(`/modules`),
  ]);

  const typeById = new Map(modules.map((m) => [m.id, m.type]));

  return detail.modules.map((entry) => {
    const type = typeById.get(entry.module_id);
    if (!type) throw new Error(`No module definition found for ID: ${entry.module_id}`);
    const durationMs =
      typeof entry.settings.duration === "number"
        ? entry.settings.duration * 60 * 1000 // duration in minutes → ms
        : 30 * 60 * 1000;
    return { type, module_id: entry.module_id, ...entry.settings, duration: durationMs } as ModuleProps;
  });
}
