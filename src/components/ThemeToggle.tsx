"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("workout_theme");
    const isLight = saved === "light";
    setLight(isLight);
    document.documentElement.classList.toggle("light", isLight);
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("workout_theme", next ? "light" : "dark");
  };

  return (
    <button
      onClick={toggle}
      className="rounded-xl glass px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      title="切換深淺主題"
    >
      {light ? "🌙" : "☀️"}
    </button>
  );
}
