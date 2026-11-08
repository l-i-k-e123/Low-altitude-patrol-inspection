<template>
  <div class="route-control">
    <label class="param-field">
      <span>线路</span>
      <select
        class="route-select"
        :value="route.lineIndex"
        @change="onLineChange"
      >
        <option v-for="(line, i) in route.lines" :key="line" :value="i">{{ line }}</option>
      </select>
    </label>
    <label class="param-field">
      <span>航点间隔 (m)</span>
      <input
        :value="route.intervalM"
        type="number"
        min="20"
        step="5"
        @change="onIntervalChange"
      />
    </label>
    <label class="param-field">
      <span>巡检高度 (m)</span>
      <input
        :value="route.patrolHeight"
        type="number"
        min="50"
        max="2000"
        step="10"
        @change="onHeightChange"
      />
    </label>
    <p class="toolbar-hint">俯仰垂直向下 · 高度 {{ route.patrolHeight }}m</p>
    <button
      type="button"
      class="map-tool-btn map-tool-btn--accent"
      :disabled="route.generating"
      @click="actions?.generatePatrolRoute?.()"
    >
      {{ route.generating ? '计算中…' : '生成航线' }}
    </button>
    <button
      type="button"
      class="map-tool-btn"
      :class="{ active: route.editMode }"
      @click="actions?.toggleRouteEditMode?.()"
    >
      {{ route.editMode ? '退出编辑' : '编辑航点' }}
    </button>
    <button type="button" class="map-tool-btn" @click="actions?.clearPatrolRoute?.()">
      一键清空
    </button>
    <button
      type="button"
      class="map-tool-btn"
      :disabled="!route.stats.total"
      @click="actions?.exportPatrolRoute?.()"
    >
      导出 JSON
    </button>
    <p v-if="route.stats.total" class="route-stats">
      航点 {{ route.stats.total }} · 风险 {{ route.stats.risk }}
      <span v-if="route.stats.risk" class="route-risk-tag">禁止起飞</span>
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import datashare from '@/stores/index.js'

const store = datashare()
const route = computed(() => store.mapUi.route)
const actions = computed(() => store.mapActions)

const onLineChange = (e) => {
  actions.value?.setRouteLineIndex?.(Number(e.target.value))
}

const onIntervalChange = (e) => {
  actions.value?.setRouteIntervalM?.(Number(e.target.value))
}

const onHeightChange = (e) => {
  actions.value?.setRoutePatrolHeight?.(Number(e.target.value))
}
</script>

<style scoped>
.route-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #8eb8c8;
}

.param-field input,
.route-select {
  width: 88px;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 4px;
  color: #00d4ff;
  font-size: 11px;
  outline: none;
}

.toolbar-hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(142, 184, 200, 0.75);
  text-align: center;
}

.map-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 6px;
  background: rgba(12, 22, 48, 0.22);
  color: #b8dce8;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.22s ease;
}

.map-tool-btn:hover {
  background: rgba(0, 212, 255, 0.08);
  border-color: rgba(0, 212, 255, 0.35);
  color: #e8f8ff;
}

.map-tool-btn.active {
  background: rgba(0, 255, 136, 0.12);
  border-color: rgba(0, 255, 136, 0.35);
  color: #00ff88;
}

.map-tool-btn--accent {
  color: #ffb4b4;
  border-color: rgba(255, 90, 90, 0.35);
  background: rgba(255, 68, 68, 0.08);
}

.map-tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.route-stats {
  font-size: 11px;
  color: #8eb8c8;
  line-height: 1.4;
  margin: 0;
}

.route-risk-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 68, 68, 0.25);
  color: #ff6666;
  font-size: 10px;
}
</style>
