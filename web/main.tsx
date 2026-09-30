import React from "react";
import ReactDOM from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./vendor/lovable-tokens.css";
import "./vendor/lovable-components.css";
import "./styles.css";
import "./portfolio.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </React.StrictMode>,
);
