import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PageBoundary } from "./components/page-boundary";
import "./styles.css";
import "./components/film-layouts.css";
import "./components/player-layouts.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PageBoundary>
      <App />
    </PageBoundary>
  </StrictMode>,
);
