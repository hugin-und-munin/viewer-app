import { logEvent } from './deviceLogger'

// Reports local disk-write failures (failing SD card, full disk, permission
// issues) — distinct from network/module/lifecycle problems since the fix is
// "check the hardware/storage", not "check the network". Logged once per
// distinct failure context per session (not on every retry) so a persistently
// broken write path doesn't flood the log.
const loggedContexts = new Set<string>()

export function reportStorageFailure(context: string, message: string): void {
  if (loggedContexts.has(context)) return
  loggedContexts.add(context)
  logEvent({ level: 'error', source: 'storage', message })
}
