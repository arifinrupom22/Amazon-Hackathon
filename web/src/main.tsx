import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { AppStateProvider } from "./state/store";

const container = document.getElementById("root");
if (!container) throw new Error("Root element missing from index.html");

createRoot(container).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </StrictMode>,
);
