import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initApi } from "./api/api.ts";

async function bootstrap() {
  const { apiUrl } = await window.electronAPI!.configGet();
  initApi(apiUrl);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();
