(() => {
  const C = {
    title: "INKWAVE",
    author: "Jayden Davis",
    license: "MIT License, Copyright (c) 2026 Jayden Davis. Fonts: Titan One and Rubik, SIL OFL 1.1. three.js r186: MIT.",
    source: "https://github.com/DevFrancois/inkwave (mirror of the deleted github.com/jaydendavisnc/inkwave)",
    note: "Added to Patch by Patch. The author can claim it."
  };
  const css = "position:fixed;z-index:2147483647;pointer-events:auto;font:13px/1.45 system-ui,sans-serif;color:#fff;";
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "i";
  b.setAttribute("aria-label", "Credits");
  b.style.cssText = css + "left:10px;bottom:10px;width:26px;height:26px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.5);background:rgba(0,0,0,.35);opacity:.55;cursor:pointer;font:italic 700 15px/24px Georgia,serif;";
  const p = document.createElement("div");
  p.style.cssText = css + "left:10px;bottom:44px;max-width:340px;padding:12px 14px;border-radius:8px;background:rgba(10,12,24,.88);box-shadow:0 4px 18px rgba(0,0,0,.4);display:none;user-select:text;";
  const row = (t, bold) => { const d = document.createElement("div"); d.textContent = t; if (bold) d.style.cssText = "font-weight:700;font-size:15px;margin-bottom:4px"; p.appendChild(d); return d; };
  row(C.title, true);
  row("By " + C.author);
  row("License: " + C.license);
  const s = row("Source: " + C.source); s.style.wordBreak = "break-all";
  row(C.note).style.cssText = "margin-top:6px;opacity:.75";
  b.addEventListener("click", () => { p.style.display = p.style.display === "none" ? "block" : "none"; b.style.opacity = p.style.display === "none" ? ".55" : ".9"; });
  const stop = (e) => e.stopPropagation();
  for (const el of [b, p]) for (const t of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "pointermove", "wheel", "contextmenu", "touchstart", "touchend"]) el.addEventListener(t, stop);
  b.addEventListener("mousedown", (e) => e.preventDefault());
  document.body.append(p, b);
})();
