import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import DcrPage from "./dcr-page/DcrPage";
import type { ModelerOption } from "./components/ModelerState";

// Hidden and disabled, as in the chatbot; remove one to bring it back.
const HIDDEN_OPTIONS: ModelerOption[] = ["newDiagram", "open", "examples", "simulation"];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DcrPage embedded={false} hiddenOptions={HIDDEN_OPTIONS} />
  </StrictMode>
);
