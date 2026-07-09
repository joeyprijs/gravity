import { CSS } from "../core/config.js";
import { createElement, buildOptionButton } from "../core/utils.js";

// Pre-boot game chooser, shown when games.json registers more than one game
// and the URL doesn't pick one. It renders before any game — and therefore
// any locale — is loaded, so all of its text comes from games.json itself.
export function renderGameSelect(registry, games) {
  const overlay = createElement('div', 'char-creation-overlay');
  const panel = createElement('div', CSS.CC_PANEL);
  panel.appendChild(createElement('h2', CSS.CC_TITLE, registry.prompt || 'Choose a game'));

  games.forEach(game => {
    const btn = buildOptionButton(game.name || game.id, game.description || null);
    // A full navigation (not an in-page boot) so the chosen game is a clean,
    // bookmarkable URL and every module re-evaluates against its data.
    btn.addEventListener('click', () => {
      location.search = `?game=${encodeURIComponent(game.id)}`;
    });
    panel.appendChild(btn);
  });

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}
