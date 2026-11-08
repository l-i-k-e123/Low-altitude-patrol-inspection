<template>
  <div class="loading-container">
    <div class="bg-aurora" aria-hidden="true" />
    <div class="bg-grid" aria-hidden="true" />
    <div class="bg-vignette" aria-hidden="true" />
    <div class="scan-line" aria-hidden="true" />

    <div class="hud-corner hud-corner--tl" aria-hidden="true" />
    <div class="hud-corner hud-corner--tr" aria-hidden="true" />
    <div class="hud-corner hud-corner--bl" aria-hidden="true" />
    <div class="hud-corner hud-corner--br" aria-hidden="true" />

    <div class="particles" aria-hidden="true">
      <span
        v-for="i in 24"
        :key="i"
        class="particle"
        :style="particleStyle(i)"
      />
    </div>

    <div class="loading-content">
      <div class="orbit-wrap">
        <div class="orbit-ring orbit-ring--outer" />
        <div class="orbit-ring orbit-ring--mid" />
        <div class="orbit-ring orbit-ring--inner" />
        <div class="orbit-core">
          <svg viewBox="0 0 64 64" class="core-icon" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35" />
            <path
              d="M32 14 L38 28 L52 32 L38 36 L32 50 L26 36 L12 32 L26 28 Z"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
            <circle cx="32" cy="32" r="4" fill="currentColor" />
          </svg>
        </div>
        <div class="radar-sweep" />
      </div>

      <div class="title-section">
        <p class="eyebrow">SMART SUBWAY · AERIAL SUPERVISION</p>
        <h1 class="main-title">
          <span class="title-accent">三维空巡</span>
          <span class="title-sep">-</span>
          <span>智慧地铁</span>
        </h1>
        <p class="subtitle">全域可视化监管平台</p>
      </div>

      <div class="progress-section">
        <div class="progress-track">
          <div class="progress-fill" />
          <div class="progress-shimmer" />
        </div>
        <p class="status-text">
          <span class="status-dot" />
          {{ statusText }}
        </p>
      </div>

      <div class="tag-row">
        <span v-for="tag in tags" :key="tag" class="tag-chip">{{ tag }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const tags = ['三维地图', '空域管控', '可视域分析', '智能巡检']

const steps = [
  '正在初始化三维引擎…',
  '加载天地图影像底图…',
  '读取地铁线路与保护区…',
  '构建城市立体白膜模型…',
  '同步机队与巡航状态…',
  '即将进入监管平台…',
]

const statusText = ref(steps[0])
let stepIndex = 0
let stepTimer = null

const particleStyle = (i) => {
  const left = ((i * 37) % 100)
  const delay = (i * 0.35) % 6
  const duration = 4 + (i % 5)
  const size = 2 + (i % 3)
  return {
    left: `${left}%`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    width: `${size}px`,
    height: `${size}px`,
  }
}

onMounted(() => {
  stepTimer = setInterval(() => {
    stepIndex = (stepIndex + 1) % steps.length
    statusText.value = steps[stepIndex]
  }, 1800)
})

onUnmounted(() => {
  if (stepTimer) clearInterval(stepTimer)
})
</script>

<style scoped>
.loading-container {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #040814;
}

.bg-aurora {
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(ellipse 55% 45% at 20% 30%, rgba(0, 212, 255, 0.18) 0%, transparent 55%),
    radial-gradient(ellipse 50% 40% at 80% 70%, rgba(124, 77, 255, 0.14) 0%, transparent 55%),
    radial-gradient(ellipse 40% 35% at 50% 50%, rgba(0, 255, 136, 0.06) 0%, transparent 60%);
  animation: aurora-drift 12s ease-in-out infinite alternate;
}

.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(0, 212, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 212, 255, 0.06) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 70% 65% at 50% 45%, black 20%, transparent 75%);
  animation: grid-pulse 4s ease-in-out infinite;
}

.bg-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 35%, rgba(4, 8, 20, 0.85) 100%);
}

.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(0, 212, 255, 0.5), transparent);
  box-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
  animation: scan-down 3.5s linear infinite;
  opacity: 0.6;
}

.hud-corner {
  position: absolute;
  width: 48px;
  height: 48px;
  border-color: rgba(0, 212, 255, 0.45);
  border-style: solid;
  opacity: 0.7;
}

.hud-corner--tl { top: 28px; left: 28px; border-width: 2px 0 0 2px; }
.hud-corner--tr { top: 28px; right: 28px; border-width: 2px 2px 0 0; }
.hud-corner--bl { bottom: 28px; left: 28px; border-width: 0 0 2px 2px; }
.hud-corner--br { bottom: 28px; right: 28px; border-width: 0 2px 2px 0; }

.particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.particle {
  position: absolute;
  bottom: -8px;
  border-radius: 50%;
  background: rgba(0, 212, 255, 0.75);
  box-shadow: 0 0 8px rgba(0, 212, 255, 0.6);
  animation: particle-rise linear infinite;
}

.loading-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 24px;
  animation: content-in 0.9s ease-out both;
}

.orbit-wrap {
  position: relative;
  width: 120px;
  height: 120px;
  margin-bottom: 36px;
}

.orbit-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid transparent;
}

.orbit-ring--outer {
  border-top-color: rgba(0, 212, 255, 0.85);
  border-right-color: rgba(0, 212, 255, 0.15);
  animation: spin 2.4s linear infinite;
  box-shadow: 0 0 24px rgba(0, 212, 255, 0.2);
}

.orbit-ring--mid {
  inset: 14px;
  border-bottom-color: rgba(124, 77, 255, 0.75);
  border-left-color: rgba(124, 77, 255, 0.12);
  animation: spin 1.8s linear infinite reverse;
}

.orbit-ring--inner {
  inset: 28px;
  border-top-color: rgba(0, 255, 136, 0.65);
  animation: spin 1.2s linear infinite;
}

.orbit-core {
  position: absolute;
  inset: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(6, 14, 32, 0.75);
  border: 1px solid rgba(0, 212, 255, 0.35);
  box-shadow:
    inset 0 0 20px rgba(0, 212, 255, 0.12),
    0 0 24px rgba(0, 212, 255, 0.25);
}

.core-icon {
  width: 44px;
  height: 44px;
  color: #00d4ff;
  filter: drop-shadow(0 0 6px rgba(0, 212, 255, 0.8));
  animation: core-pulse 2s ease-in-out infinite;
}

.radar-sweep {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(0, 212, 255, 0.18) 40deg, transparent 80deg);
  animation: spin 3s linear infinite;
  mask: radial-gradient(circle, transparent 55%, black 56%);
}

.title-section {
  margin-bottom: 32px;
}

.eyebrow {
  margin: 0 0 12px;
  font-size: 11px;
  letter-spacing: 3px;
  color: rgba(0, 212, 255, 0.55);
  text-transform: uppercase;
}

.main-title {
  margin: 0 0 10px;
  font-size: clamp(22px, 2.8vw, 34px);
  font-weight: 700;
  letter-spacing: 2px;
  color: #e8f4ff;
  line-height: 1.3;
}

.title-accent {
  color: #00d4ff;
  text-shadow:
    0 0 12px rgba(0, 212, 255, 0.85),
    0 0 28px rgba(0, 212, 255, 0.4);
}

.title-sep {
  margin: 0 8px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 400;
}

.subtitle {
  margin: 0;
  font-size: clamp(13px, 1.4vw, 16px);
  color: rgba(224, 240, 255, 0.72);
  letter-spacing: 4px;
}

.progress-section {
  width: min(420px, 86vw);
  margin-bottom: 24px;
}

.progress-track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: rgba(0, 212, 255, 0.12);
  overflow: hidden;
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.4);
}

.progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 45%;
  border-radius: inherit;
  background: linear-gradient(90deg, #00d4ff, #7c4dff, #00ff88);
  animation: progress-slide 2.2s ease-in-out infinite;
}

.progress-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  animation: shimmer 1.6s linear infinite;
}

.status-text {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 14px 0 0;
  font-size: 13px;
  color: rgba(200, 230, 255, 0.78);
  letter-spacing: 0.5px;
  min-height: 20px;
  transition: opacity 0.3s ease;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00ff88;
  box-shadow: 0 0 8px rgba(0, 255, 136, 0.8);
  animation: dot-blink 1.2s ease-in-out infinite;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.tag-chip {
  padding: 4px 12px;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(0, 212, 255, 0.85);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 999px;
  background: rgba(0, 212, 255, 0.06);
  backdrop-filter: blur(4px);
}

@keyframes aurora-drift {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(2%, -2%) scale(1.05); }
}

@keyframes grid-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.9; }
}

@keyframes scan-down {
  0% { top: -2px; opacity: 0; }
  10% { opacity: 0.6; }
  90% { opacity: 0.6; }
  100% { top: 100%; opacity: 0; }
}

@keyframes particle-rise {
  0% { transform: translateY(0) scale(1); opacity: 0; }
  10% { opacity: 0.8; }
  90% { opacity: 0.4; }
  100% { transform: translateY(-100vh) scale(0.4); opacity: 0; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes core-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.06); opacity: 0.85; }
}

@keyframes content-in {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes progress-slide {
  0% { transform: translateX(-100%); width: 35%; }
  50% { width: 65%; }
  100% { transform: translateX(220%); width: 35%; }
}

@keyframes shimmer {
  from { transform: translateX(-100%); }
  to { transform: translateX(200%); }
}

@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (max-width: 768px) {
  .hud-corner { width: 32px; height: 32px; }
  .hud-corner--tl, .hud-corner--tr { top: 16px; }
  .hud-corner--bl, .hud-corner--br { bottom: 16px; }
  .hud-corner--tl, .hud-corner--bl { left: 16px; }
  .hud-corner--tr, .hud-corner--br { right: 16px; }
  .orbit-wrap { width: 96px; height: 96px; margin-bottom: 28px; }
  .subtitle { letter-spacing: 2px; }
  .tag-row { gap: 8px; }
}
</style>
