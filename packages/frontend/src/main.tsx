import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Board } from "./pages/Board";
import { Card } from "./pages/Card";
import "./styles/tokens.css";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Board />} />
        <Route path="/cards/:id" element={<Card />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
