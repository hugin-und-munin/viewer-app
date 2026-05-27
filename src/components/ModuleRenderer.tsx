import { useEffect, useState } from "react";
import type { Module } from "../core/moduleDisplayManager";
import { onModuleChange, offModuleChange } from "../core/moduleDisplayManager";
import logo from "../assets/logo.png";
import "./ModuleRenderer.css";

function IdleScreen() {
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    window.electronAPI?.appVersion().then(setVersion);
  }, []);

  return (
    <div className="idle-screen">
      <img src={logo} alt="Hugin und Munin" />
      {version && (
        <span style={{
          position: "absolute",
          bottom: 8,
          right: 12,
          fontSize: 11,
          color: "rgba(255,255,255,0.35)",
          fontFamily: "monospace",
          pointerEvents: "none",
          userSelect: "none",
        }}>
          v{version}
        </span>
      )}
    </div>
  );
}

function ModuleRenderer() {
  const [moduleData, setModuleData] = useState<Module | null>(null);

  useEffect(() => {
    onModuleChange(setModuleData);
    return () => offModuleChange(setModuleData);
  }, []);

  if (!moduleData) return <IdleScreen />;

  const { component: Module, props } = moduleData;
  return <Module {...props} />;
}

export default ModuleRenderer;
