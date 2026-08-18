import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../assets/tailwind.css";
import { ConsentGate, ErrorBoundary } from "../../components/ui";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("popup root element missing");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary surface="popup">
      <ConsentGate>
        <App />
      </ConsentGate>
    </ErrorBoundary>
  </StrictMode>,
);
