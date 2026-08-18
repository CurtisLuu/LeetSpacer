import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../assets/tailwind.css";
import { ConsentGate } from "../../components/ui";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("problems root element missing");

createRoot(container).render(
  <StrictMode>
    <ConsentGate>
      <App />
    </ConsentGate>
  </StrictMode>,
);
