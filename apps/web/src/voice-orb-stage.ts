const STAGE_ID = "jazz-voice-stage";
const VISUALIZER_VERSION = "crystal-v3";

function stageMarkup() {
  return `
    <div class="jazz-voice-stage" id="${STAGE_ID}" data-version="${VISUALIZER_VERSION}" aria-hidden="true">
      <svg class="jazz-voice-wave" viewBox="0 0 620 240" preserveAspectRatio="none">
        <defs>
          <linearGradient id="jazzWaveGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#38e8ff" stop-opacity="0"/>
            <stop offset="16%" stop-color="#38e8ff"/>
            <stop offset="42%" stop-color="#6ad8ff"/>
            <stop offset="56%" stop-color="#9a73ff"/>
            <stop offset="84%" stop-color="#ff4be3"/>
            <stop offset="100%" stop-color="#ff4be3" stop-opacity="0"/>
          </linearGradient>
          <filter id="jazzGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <g class="jazz-wave-lines" fill="none" stroke="url(#jazzWaveGradient)" stroke-linecap="round" filter="url(#jazzGlow)">
          <path d="M0 120 C34 38 70 38 106 120 S178 202 214 120 S286 38 322 120 S394 202 430 120 S502 38 538 120 S592 188 620 120" stroke-width="2.5"/>
          <path d="M0 120 C42 68 84 68 126 120 S210 172 252 120 S336 68 378 120 S462 172 504 120 S588 68 620 120" stroke-width="2" opacity=".92"/>
          <path d="M0 120 C26 94 52 94 78 120 S130 146 156 120 S208 94 234 120 S286 146 312 120 S364 94 390 120 S442 146 468 120 S520 94 546 120 S598 146 620 120" stroke-width="1.2" opacity=".68"/>
          <path d="M0 120 C55 105 90 92 128 120 S205 148 244 120 S321 92 360 120 S437 148 476 120 S554 92 620 120" stroke-width=".9" opacity=".48"/>
        </g>
      </svg>

      <div class="jazz-orb-shell">
        <div class="jazz-frequency-ring jazz-frequency-ring-a"></div>
        <div class="jazz-frequency-ring jazz-frequency-ring-b"></div>
        <div class="jazz-frequency-ring jazz-frequency-ring-c"></div>
        <div class="jazz-frequency-ring jazz-frequency-ring-d"></div>
        <div class="jazz-glass-orb">
          <div class="jazz-glass-shine"></div>
          <div class="jazz-glass-refraction"></div>
          <svg class="jazz-crystal-heart" viewBox="0 0 100 92" aria-hidden="true">
            <defs>
              <linearGradient id="jazzHeartFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="32%" stop-color="#ffe8ff"/>
                <stop offset="58%" stop-color="#f19bff"/>
                <stop offset="78%" stop-color="#d46aff"/>
                <stop offset="100%" stop-color="#75eaff"/>
              </linearGradient>
            </defs>
            <path d="M50 88 10 49C-8 30 1 4 23 2c13-1 22 6 27 15C55 8 64 1 77 2c22 2 31 28 13 47L50 88Z" fill="url(#jazzHeartFill)"/>
            <path d="M50 17 27 5 39 45 10 49M50 17 73 5 61 45 90 49M39 45 50 88 61 45M39 45 50 17 61 45M10 49 50 88 90 49" fill="none" stroke="rgba(255,255,255,.76)" stroke-width="1.45"/>
          </svg>
        </div>
      </div>
    </div>`;
}

function removeLegacyVoiceUi() {
  document.querySelectorAll<HTMLElement>(".voice-listening-layer,.chat-panel-glow").forEach(node => node.remove());
}

function ensureStage() {
  removeLegacyVoiceUi();
  const panel = document.querySelector<HTMLElement>(".chat-panel");
  if (!panel) return;
  if (document.getElementById(STAGE_ID)) return;
  panel.insertAdjacentHTML("beforeend", stageMarkup());
}

function syncStage() {
  document.documentElement.dataset.jazzVisualizer = VISUALIZER_VERSION;
  ensureStage();
  const stage = document.getElementById(STAGE_ID);
  if (!stage) return;
  const state = document.documentElement.dataset.jazzVoiceState || "idle";
  stage.dataset.state = state;
  stage.classList.toggle("is-active", state === "listening" || state === "speaking");
  stage.classList.toggle("is-speaking", state === "speaking");
  stage.classList.toggle("is-listening", state === "listening");
}

const rootObserver = new MutationObserver(syncStage);
rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-jazz-voice-state"] });

const appObserver = new MutationObserver(() => {
  removeLegacyVoiceUi();
  if (!document.getElementById(STAGE_ID)) syncStage();
});
appObserver.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("DOMContentLoaded", syncStage);
queueMicrotask(syncStage);
window.setTimeout(syncStage, 100);
window.setTimeout(syncStage, 500);
