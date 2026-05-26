import { useEffect, useState } from "react";
import type { Module } from "../core/moduleDisplayManager";
import { onModuleChange, offModuleChange } from "../core/moduleDisplayManager";
import logo from "../assets/logo.png";
import "./ModuleRenderer.css";

function IdleScreen() {
  return (
    <div className="idle-screen">
      <img src={logo} alt="Hugin und Munin" />
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
