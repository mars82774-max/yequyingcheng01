const PLAYER_NATIVE_WIDTH = 670;
const PLAYER_VISIBLE_HEIGHT = 420;

export function syncPlayerFrames(root = document) {
  const shells = [...root.querySelectorAll("[data-player-shell]")];
  if (!shells.length) return;

  const update = () => {
    shells.forEach((shell) => {
      const width = shell.getBoundingClientRect().width || PLAYER_NATIVE_WIDTH;
      const scale = Math.max(0.1, width / PLAYER_NATIVE_WIDTH);
      shell.style.setProperty("--player-scale", String(scale));
      shell.style.setProperty("--player-native-width", String(PLAYER_NATIVE_WIDTH));
      shell.style.setProperty("--player-visible-height", String(PLAYER_VISIBLE_HEIGHT));
    });
  };

  update();

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(update);
    shells.forEach((shell) => observer.observe(shell));
    return;
  }

  window.addEventListener("resize", update, { passive: true });
}
