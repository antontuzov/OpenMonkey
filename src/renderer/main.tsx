import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { QuickAsk } from "./QuickAsk";
import { ToastHost } from "./components/Toast";
import "./styles/global.css";

const quick = new URLSearchParams(window.location.search).get("quick") === "1";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {quick ? (
      <QuickAsk />
    ) : (
      <>
        <App />
        <ToastHost />
      </>
    )}
  </React.StrictMode>
);
