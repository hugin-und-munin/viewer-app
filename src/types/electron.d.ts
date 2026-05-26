interface ElectronAPI {
  cacheRead: (filename: string) => Promise<string | null>;
  cacheWrite: (filename: string, data: string) => Promise<void>;
  onControl: (callback: (data: unknown) => void) => void;
  offControl: (callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
