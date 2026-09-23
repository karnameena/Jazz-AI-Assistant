const STAGE_ID = "jazz-voice-stage";
const VISUALIZER_VERSION = "crystal-v8-responsive";

let stage: HTMLElement | null = null;
let shell: HTMLElement | null = null;
let animationFrame: number | null = null;
let speakingStartedAt = 0;
let lastState = "";
let mountObserver: MutationObserver | null = null;

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

function voiceLevel() {
  const raw = document.documentElement.style.getPropertyValue("--jazz-voice-level").trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function ensureStage() {
  if (stage?.isConnected) return stage;
  stage = document.getElementById(STAGE_ID) as HTMLElement | null;
  if (stage) {
    shell = stage.querySelector<HTMLElement>(".jazz-orb-shell");
    return stage;
  }

  const panel = document.querySelector<HTMLElement>(".chat-panel");
  if (!panel) return null;
  panel.insertAdjacentHTML("beforeend", stageMarkup());
  stage = document.getElementById(STAGE_ID) as HTMLElement | null;
  shell = stage?.querySelector<HTMLElement>(".jazz-orb-shell") || null;
  return stage;
}

function stopSpeakingLoop(reset = true) {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  speakingStartedAt = 0;
  if (reset && stage && shell) {
    stage.style.setProperty("--jazz-bounce-energy", "0");
    shell.style.top = "50%";
    shell.style.transform = "translate(-50%,-50%) scale(1)";
  }
}

function animateSpeaking(now: number) {
  if (document.hidden || document.documentElement.dataset.jazzVoiceState !== "speaking") {
    stopSpeakingLoop(false);
    return;
  }

  const currentStage = ensureStage();
  if (!currentStage || !shell) {
    animationFrame = requestAnimationFrame(animateSpeaking);
    return;
  }

  if (!speakingStartedAt) speakingStartedAt = now;
  const elapsed = now - speakingStartedAt;
  const liveLevel = voiceLevel();
  const phase = (elapsed % 1000) / 1000;
  const primary = Math.sin(phase * Math.PI * 2);
  const accent = Math.sin(phase * Math.PI) ** 2;
  const amplitude = 22 + liveLevel * 20;
  const y = primary * amplitude;
  const energy = Math.min(1, 0.34 + accent * 0.46 + liveLevel * 0.38);
  const scale = 1 + energy * 0.072;

  shell.style.transform = `translate(-50%, calc(-50% + ${y.toFixed(2)}px)) scale(${scale.toFixed(3)})`;
  currentStage.style.setProperty("--jazz-bounce-energy", energy.toFixed(3));
  animationFrame = requestAnimationFrame(animateSpeaking);
}

function startSpeakingLoop() {
  if (animationFrame !== null || document.hidden) return;
  speakingStartedAt = 0;
  animationFrame = requestAnimationFrame(animateSpeaking);
}

function syncStageState() {
  const currentStage = ensureStage();
  if (!currentStage) return;

  const state = document.documentElement.dataset.jazzVoiceState || "idle";
  if (state === lastState && currentStage.dataset.state === state) return;
  lastState = state;
  currentStage.dataset.state = state;
  currentStage.classList.toggle("is-active", state === "listening" || state === "speaking");
  currentStage.classList.toggle("is-speaking", state === "speaking");
  currentStage.classList.toggle("is-listening", state === "listening");

  if (state === "speaking") startSpeakingLoop();
  else stopSpeakingLoop(true);
}

function mountWhenReady() {
  document.documentElement.dataset.jazzVisualizer = VISUALIZER_VERSION;
  if (ensureStage()) {
    syncStageState();
    mountObserver?.disconnect();
    mountObserver = null;
    return;
  }

  if (mountObserver) return;
  const root = document.getElementById("root") || document.body;
  mountObserver = new MutationObserver(() => {
    if (ensureStage()) {
      syncStageState();
      mountObserver?.disconnect();
      mountObserver = null;
    }
  });
  mountObserver.observe(root, { childList: true, subtree: true });
}

const stateObserver = new MutationObserver(syncStageState);
stateObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-jazz-voice-state"] });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSpeakingLoop(false);
  else syncStageState();
});

document.addEventListener("DOMContentLoaded", mountWhenReady, { once: true });
queueMicrotask(mountWhenReady);
