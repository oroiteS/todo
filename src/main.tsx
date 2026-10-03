import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  // StrictMode 会在 dev 下双调用 effect，init() 内部有幂等保护
  <App />,
);
