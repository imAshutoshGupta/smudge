// Theme picker. Self-contained on purpose: it only ever touches
// <html data-theme> and its own panel, so the blur logic in popup.js never
// has to know a theme exists.
//
// "system" is stored as the absence of a theme — the stylesheet's
// prefers-color-scheme block then decides, and keeps deciding if the OS
// switches while the popup is open.

const THEMES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "mono", label: "Mono" },
  { id: "frost", label: "Frost" },
  { id: "aurora", label: "Aurora" },
  { id: "nebula", label: "Nebula" },
  { id: "ember", label: "Ember" },
];

const KEY = "smudge.theme";

// localStorage rather than chrome.storage: it needs no extra permission, and
// an extension that blurs personal data shouldn't ask for one it can avoid.
// It can still throw if the user has blocked site data, hence the guards.
function readTheme() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function saveTheme(id) {
  try {
    if (id === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    // Not fatal — the theme just won't survive the popup closing.
  }
}

function applyTheme(id) {
  if (!id || id === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
}

// Runs while <head> is parsing, before anything paints, so the popup never
// flashes the default theme on its way to the chosen one.
const known = THEMES.some((t) => t.id === readTheme());
applyTheme(known ? readTheme() : "system");

document.addEventListener("DOMContentLoaded", () => {
  const settings = document.getElementById("settings");
  const panel = document.getElementById("themes");
  const grid = document.getElementById("swatches");
  const current = known ? readTheme() : "system";

  for (const theme of THEMES) {
    const swatch = document.createElement("button");
    swatch.className = "swatch";
    swatch.type = "button";
    swatch.dataset.theme = theme.id;
    swatch.setAttribute("aria-pressed", String(theme.id === current));
    swatch.setAttribute("aria-label", `${theme.label} theme`);

    const chip = document.createElement("span");
    chip.className = "chip";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = theme.label;
    swatch.append(chip, name);

    swatch.addEventListener("click", () => {
      applyTheme(theme.id);
      saveTheme(theme.id);
      for (const other of grid.children) {
        other.setAttribute("aria-pressed", String(other === swatch));
      }
    });

    grid.appendChild(swatch);
  }

  function setOpen(open) {
    panel.classList.toggle("hidden", !open);
    settings.setAttribute("aria-expanded", String(open));
  }

  settings.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.classList.contains("hidden"));
  });

  // Clicking the page behind it, or Esc, puts the panel away.
  document.addEventListener("click", (event) => {
    if (!panel.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
});
