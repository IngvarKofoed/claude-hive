import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { ForYouProvider } from "./components/forYou";
import { Board } from "./pages/Board";
import { Card } from "./pages/Card";
import { ForYou } from "./pages/ForYou";
import { RolePrompts } from "./pages/RolePrompts";
import "./styles/tokens.css";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ForYouProvider>
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/cards/:id" element={<Card />} />
          <Route path="/for-you" element={<ForYou />} />
          <Route path="/roles" element={<RolePrompts />} />
          <Route path="/roles/:name" element={<RolePrompts />} />
        </Routes>
      </ForYouProvider>
    </BrowserRouter>
  </StrictMode>,
);
