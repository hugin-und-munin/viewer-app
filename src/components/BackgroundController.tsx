import { useEffect } from "react";
import { ConfigService } from "../core/configService";
import { ControlService } from "../core/controlService";
import type { PauseCommand, LoadModuleCommand } from "../core/controlService";
import ModuleScheduler from "../core/moduleScheduler";
import { clearModule, showModule } from "../core/moduleDisplayManager";
import { prefetchAll } from "../core/cachePrefetcher";
import { loadConfig } from "../api/deviceConfig";
import type { ModuleProps } from "../types/modules";

function BackgroundController() {
  useEffect(() => {
    const configService = new ConfigService();
    const controlService = new ControlService();
    let scheduler: ModuleScheduler | null = null;
    let overrideTimer: ReturnType<typeof setTimeout> | null = null;

    const stopScheduler = () => {
      scheduler?.forceStop();
      scheduler = null;
    };

    const endOverride = () => {
      if (overrideTimer) { clearTimeout(overrideTimer); overrideTimer = null; }
      clearModule();
      configService.start(); // fetches fresh config immediately, resumes normal scheduling
    };

    const onConfigChanged = (modules: ModuleProps[]) => {
      if (modules.length === 0) {
        stopScheduler();
        clearModule();
        return;
      }
      if (!scheduler) {
        scheduler = new ModuleScheduler(modules);
        scheduler.start();
      } else {
        scheduler.updateConfig(modules);
      }
    };

    const onPause = ({ duration }: PauseCommand) => {
      configService.stop();
      stopScheduler();
      clearModule();
      if (overrideTimer) clearTimeout(overrideTimer);
      overrideTimer = setTimeout(endOverride, duration * 60 * 1000);
    };

    const onLoadModule = (module: LoadModuleCommand) => {
      configService.stop();
      stopScheduler();
      if (overrideTimer) clearTimeout(overrideTimer);
      showModule({
        ...module,
        onModuleDone: endOverride,
      });
      overrideTimer = setTimeout(endOverride, module.duration);
    };

    // controlEnabled is read async from runtime config; the variable is
    // captured by reference in the closure so the cleanup sees the final value.
    let controlEnabled = false;

    configService.on("configChanged", onConfigChanged);
    configService.start();

    prefetchAll().catch(() => {});
    const prefetchIntervalId = setInterval(() => prefetchAll().catch(() => {}), 1 * 60 * 60 * 1000);

    loadConfig().then(({ controlEnabled: enabled }) => {
      controlEnabled = enabled;
      if (controlEnabled) {
        controlService.on("pause", onPause);
        controlService.on("loadModule", onLoadModule);
        controlService.start();
      }
    });

    return () => {
      clearInterval(prefetchIntervalId);
      if (overrideTimer) clearTimeout(overrideTimer);
      stopScheduler();
      configService.stop();
      if (controlEnabled) controlService.stop();
      configService.off("configChanged", onConfigChanged);
      controlService.off("pause", onPause);
      controlService.off("loadModule", onLoadModule);
    };
  }, []);

  return null;
}

export default BackgroundController;
