<template>
  <Transition name="violation-alert">
    <div v-if="visible" class="violation-alert-overlay" @click.self="dismiss">
      <div class="violation-alert-panel">
        <div class="alert-icon-ring">
          <span class="alert-icon">!</span>
        </div>
        <h2 class="alert-title">违规车辆告警</h2>
        <p class="alert-subtitle">无人机巡航扫描发现保护区违规占用</p>

        <div v-if="violation" class="alert-details">
          <div class="detail-row">
            <span class="detail-label">车辆类型</span>
            <span class="detail-value">{{ violation.type || '挖掘机' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">车牌/标识</span>
            <span class="detail-value">{{ violation.plate || '未知' }}</span>
          </div>
          <div class="detail-row" v-if="violation.line">
            <span class="detail-label">所属线路</span>
            <span class="detail-value">{{ violation.line }}</span>
          </div>
          <div class="detail-row" v-if="violation.droneName">
            <span class="detail-label">发现设备</span>
            <span class="detail-value">{{ violation.droneName }}</span>
          </div>
          <div class="detail-row" v-if="task">
            <span class="detail-label">派单任务</span>
            <span class="detail-value task-value">{{ task.title }}</span>
          </div>
        </div>

        <button type="button" class="alert-dismiss-btn" @click="dismiss">
          确认并关闭
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  violation: { type: Object, default: null },
  task: { type: Object, default: null },
})

const emit = defineEmits(['dismiss'])

const dismiss = () => emit('dismiss')
</script>

<style scoped>
.violation-alert-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(120, 0, 0, 0.55);
  animation: alert-bg-pulse 1.2s ease-in-out infinite alternate;
  backdrop-filter: blur(4px);
}

@keyframes alert-bg-pulse {
  from { background: rgba(100, 0, 0, 0.45); }
  to { background: rgba(180, 0, 0, 0.65); }
}

.violation-alert-panel {
  position: relative;
  width: min(480px, 92vw);
  padding: 36px 32px 28px;
  background: linear-gradient(160deg, rgba(40, 4, 4, 0.97) 0%, rgba(20, 2, 2, 0.98) 100%);
  border: 2px solid rgba(255, 68, 68, 0.7);
  border-radius: 16px;
  box-shadow:
    0 0 40px rgba(255, 50, 50, 0.45),
    0 0 80px rgba(255, 0, 0, 0.2),
    inset 0 0 30px rgba(255, 80, 80, 0.08);
  text-align: center;
  animation: alert-panel-shake 0.5s ease-out;
}

@keyframes alert-panel-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-6px); }
  30% { transform: translateX(6px); }
  45% { transform: translateX(-4px); }
  60% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
}

.alert-icon-ring {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  border-radius: 50%;
  border: 3px solid #ff4444;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: alert-icon-pulse 0.8s ease-in-out infinite alternate;
  box-shadow: 0 0 24px rgba(255, 68, 68, 0.6);
}

@keyframes alert-icon-pulse {
  from { transform: scale(1); box-shadow: 0 0 16px rgba(255, 68, 68, 0.5); }
  to { transform: scale(1.08); box-shadow: 0 0 32px rgba(255, 68, 68, 0.85); }
}

.alert-icon {
  font-size: 36px;
  font-weight: bold;
  color: #ff4444;
  line-height: 1;
}

.alert-title {
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: bold;
  color: #ff5555;
  text-shadow: 0 0 12px rgba(255, 80, 80, 0.6);
  letter-spacing: 2px;
}

.alert-subtitle {
  margin: 0 0 24px;
  font-size: 14px;
  color: rgba(255, 180, 180, 0.85);
}

.alert-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
  padding: 16px;
  background: rgba(255, 50, 50, 0.08);
  border: 1px solid rgba(255, 80, 80, 0.25);
  border-radius: 10px;
  text-align: left;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.detail-label {
  color: rgba(255, 180, 180, 0.7);
  flex-shrink: 0;
}

.detail-value {
  color: #ffe0e0;
  font-weight: 500;
  text-align: right;
}

.task-value {
  color: #ffaa44;
}

.alert-dismiss-btn {
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(255, 100, 100, 0.5);
  border-radius: 8px;
  background: rgba(255, 60, 60, 0.2);
  color: #ffb4b4;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.alert-dismiss-btn:hover {
  background: rgba(255, 60, 60, 0.35);
  border-color: rgba(255, 120, 120, 0.7);
  color: #fff;
}

.violation-alert-enter-active,
.violation-alert-leave-active {
  transition: opacity 0.35s ease;
}

.violation-alert-enter-from,
.violation-alert-leave-to {
  opacity: 0;
}
</style>
