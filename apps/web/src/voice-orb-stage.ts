const STAGE_ID = "jazz-voice-stage";

function stageMarkup() {
  return `
    <div class="jazz-voice-stage" id="${STAGE_ID}" aria-hidden="true">
      <svg class="jazz-voice-wave" viewBox="0 0 620 240" preserveAspectRatio="none">
        <defs>
          <linearGradient id="jazzWaveGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#38e8ff" stop-opacity="0"/>
            <stop offset="18%" stop-color="#38e8ff"/>
            <stop offset="48%" stop-color="#8d73ff"/>
            <stop offset="82%" stop-color="#ff4be3"/>
            <stop offset="100%" stop-color="#ff4be3" stop-opacity="0"/>
          </linearGradient>
          <filter id="jazzGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <g class="jazz-wave-lines" fill="none" stroke="url(#jazzWaveGradient)" stroke-linecap="round" filter="url(#jazzGlow)">
          <path d="M0 120 C45 30 92 30 138 120 S230 210 276 120 S368 30 414 120 S506 210 620 120" stroke-width="2.6"/>
          <path d="M0 120 C52 72 104 72 156 120 S260 168 312 120 S416 72 468 120 S572 168 620 120" stroke-width="1.9" opacity=".92"/>
          <path d="M0 120 C34 92 68 92 102 120 S170 148 204 120 S272 92 306 120 S374 148 408 120 S476 92 510 120 S578 148 620 120" stroke-width="1.25" opacity=".66"/>
        </g>
      </svg>

      <div class="jazz-orb-shell">
        <div class="jazz-frequency-ring jazz-frequency-ring-a"></div>
        <div class="jazz-frequency-ring jazz-frequency-ring-b"></div>
        <div class="jazz-frequency-ring jazz-frequency-ring-c"></div>
        <div class="jazz-glass-orb">
          <div class="jazz-glass-shine"></div>
          <svg class="jazz-crystal-heart" viewBox="0 0 100 92" aria-hidden="true">
            <defs>
              <linearGradient id="jazzHeartFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="40%" stop-color="#f7b7ff"/>
                <stop offset="72%" stop-color="#d571ff"/>
                <stop offset="100%" stop-color="#72eaff"/>
              </linearGradient>
            </defs>
            <path d="M50 88 10 49C-8 30 1 4 23 2c13-1 22 6 27 15C55 8 64 1 77 2c22 2 31 28 13 47L50 88Z" fill="url(#jazzHeartFill)"/>
            <path d="M50 17 27 5 39 45 10 49M50 17 73 5 61 45 90 49M39 45 50 88 61 45M39 45 50 17 61 45M10 49 50 88 90 49" fill="none" stroke="rgba(255,255,255,.72)" stroke-width="1.5"/>
          </svg>
        </div>
      </div>
    </div>`;
}

function ensureStage() {
  const panel = document.querySelector<HTMLElement>(".chat-panel");
  if (!panel) return;
  if (document.getElementById(STAGE_ID)) return;
  panel.insertAdjacentHTML("beforeend", stageMarkup());
}

function syncStage() {
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
  if (!document.getElementById(STAGE_ID)) syncStage();
});
appObserver.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("DOMContentLoaded", syncStage);
queueMicrotask(syncStage);
window.setTimeout(syncStage, 250);
