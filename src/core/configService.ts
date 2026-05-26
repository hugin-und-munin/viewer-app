import { EventEmitter } from "events";
import type { ModuleProps } from "../types/modules";
import { getCurrentModules } from "../api/appconfig.api";
import isEqual from "lodash.isequal";

export class ConfigService extends EventEmitter {
  private modules: ModuleProps[] = [];
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private pollInterval: number;

  constructor(pollInterval?: number) {
    super();
    this.pollInterval = pollInterval ?? 20000; // default to 20s
  }

  start() {
    this.fetchAndUpdate();
    this.intervalId = setInterval(() => this.fetchAndUpdate(), this.pollInterval);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.modules = [];
  }

  private async fetchAndUpdate() {
    try {
      const modules = await getCurrentModules();
      if (!isEqual(modules, this.modules)) {
        this.modules = modules;
        this.emit("configChanged", modules);
      }
    } catch (err) {
      console.error("Failed to fetch config:", err);
    }
  }
}
