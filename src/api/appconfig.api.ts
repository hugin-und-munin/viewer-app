import { getApi } from './api'
import { loadDeviceConfig } from './deviceConfig'
import type { ModuleProps } from '../types/modules'

interface AppSettingsSummary {
  id: string
  valid_from: string
  valid_to: string | null
}

interface ModuleEntry {
  module_id: string
  settings: Record<string, unknown>
}

interface AppSettingsDetail {
  id: string
  modules: ModuleEntry[]
}

interface ApiModule {
  id: string
  type: string
}

function findActive(settings: AppSettingsSummary[]): AppSettingsSummary | undefined {
  const now = new Date()
  const terminated = settings.find((s) => {
    if (!s.valid_to) return false
    return new Date(s.valid_from) <= now && now <= new Date(s.valid_to)
  })
  if (terminated) return terminated
  // returns newest default config
  return settings
    .filter((s) => !s.valid_to && new Date(s.valid_from) <= now)
    .sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime())[0]
}

export async function getCurrentModules(): Promise<ModuleProps[]> {
  const { deviceId } = await loadDeviceConfig()

  const settings = await getApi().get<AppSettingsSummary[]>(`/devices/${deviceId}/appsettings`)
  console.log('[appconfig] appsettings summaries:', settings)
  const active = findActive(settings)
  console.log('[appconfig] active appsetting:', active)
  if (!active) return []

  const [detail, modules] = await Promise.all([
    getApi().get<AppSettingsDetail>(`/devices/${deviceId}/appsettings/${active.id}`),
    getApi().get<ApiModule[]>(`/modules`),
  ])
  console.log('[appconfig] appsetting detail:', detail)
  console.log('[appconfig] available modules:', modules)

  const typeById = new Map(modules.map((m) => [m.id, m.type]))

  const result = detail.modules.map((entry) => {
    const type = typeById.get(entry.module_id)
    if (!type) throw new Error(`No module definition found for ID: ${entry.module_id}`)
    const durationMs =
      typeof entry.settings.duration === 'number'
        ? entry.settings.duration * 60 * 1000 // duration in minutes → ms
        : 30 * 60 * 1000
    return {
      type,
      module_id: entry.module_id,
      ...entry.settings,
      duration: durationMs,
    } as ModuleProps
  })
  console.log(
    '[appconfig] resolved modules for scheduler:',
    result.map((m) => ({
      type: m.type,
      module_id: m.module_id,
      duration: m.duration,
      interval: m.interval,
    })),
  )
  return result
}
