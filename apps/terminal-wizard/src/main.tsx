import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@wterm/react/css";
import "@/app/globals.css";
import { TerminalWizard } from "@/app/components/TerminalWizard";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Terminal Tutor could not find its root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <TerminalWizard />
  </StrictMode>,
);
