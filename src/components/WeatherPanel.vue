<template>
  <div class="weather-section">
    <div v-if="!hideHeader" class="section-title">
      <el-icon><Sunny /></el-icon>
      <span>天气监控</span>
      <span v-if="lastUpdate" class="update-time">{{ lastUpdate }}</span>
    </div>

    <!-- 成都全域 -->
    <div class="weather-block">
      <div class="block-header">
        <span class="block-label">成都全域</span>
        <span v-if="cityWeather" class="flight-badge" :class="cityWeather.flight_level">
          {{ cityWeather.flight_label }}
        </span>
      </div>

      <div v-if="loadingCity && !cityWeather" class="hint-text">正在获取...</div>
      <div v-else-if="cityWeather" class="metric-grid">
        <div class="metric-card highlight">
          <span class="metric-label">当前温度 · {{ cityWeather.real_time.weather_text }}</span>
          <span class="metric-value">{{ cityWeather.real_time.temperature }}<small>℃</small></span>
        </div>
        <div class="metric-card">
          <span class="metric-label">湿度</span>
          <span class="metric-value">{{ cityWeather.real_time.humidity }}<small>%</small></span>
        </div>
        <div class="metric-card">
          <span class="metric-label">风力风向</span>
          <span class="metric-value">{{ cityWeather.real_time.wind.scale }}级 {{ cityWeather.real_time.wind.direction }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">能见度</span>
          <span class="metric-value">{{ cityWeather.real_time.visibility }}<small>km</small></span>
        </div>
        <div class="metric-card">
          <span class="metric-label">降水量（市中心）</span>
          <span class="metric-value">{{ formatPrecipitation(cityWeather.real_time) }}<small v-if="showPrecipUnit(cityWeather.real_time)">mm</small></span>
        </div>
      </div>
    </div>

    <!-- 当前巡航线路 -->
    <div class="weather-block">
      <div class="block-header">
        <span class="block-label">当前巡航线路</span>
        <span v-if="patrolWeather?.has_patrol" class="flight-badge" :class="patrolWeather.flight_level">
          {{ patrolWeather.flight_label }}
        </span>
      </div>

      <div v-if="loadingPatrol && !patrolWeather" class="hint-text">正在获取线路天气...</div>
      <div v-else-if="!patrolWeather?.has_patrol" class="empty-card">
        <span class="empty-icon">✈</span>
        <span>暂无巡航任务，线路天气未启用</span>
      </div>
      <template v-else>
        <div class="patrol-info">
          <span class="patrol-drone">{{ patrolWeather.drone_name }}</span>
          <span class="patrol-line">{{ formatLineName(patrolWeather.line, patrolWeather.line_name) }}</span>
        </div>

        <div class="metric-grid compact">
          <div class="metric-card highlight">
            <span class="metric-label">实时温度 · {{ patrolWeather.real_time.weather_text }}</span>
            <span class="metric-value">{{ patrolWeather.real_time.temperature }}<small>℃</small></span>
          </div>
          <div class="metric-card">
            <span class="metric-label">湿度</span>
            <span class="metric-value">{{ patrolWeather.real_time.humidity }}<small>%</small></span>
          </div>
          <div class="metric-card">
            <span class="metric-label">风力风向</span>
            <span class="metric-value">{{ patrolWeather.real_time.wind.scale }}级 {{ patrolWeather.real_time.wind.direction }}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">能见度</span>
            <span class="metric-value">{{ patrolWeather.real_time.visibility }}<small>km</small></span>
          </div>
          <div class="metric-card">
            <span class="metric-label">降水量（机位点）</span>
            <span class="metric-value">{{ formatPrecipitation(patrolWeather.real_time) }}<small v-if="showPrecipUnit(patrolWeather.real_time)">mm</small></span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Sunny } from '@element-plus/icons-vue'
import { storeToRefs } from 'pinia'
import datashare from '@/stores/index.js'
import { fetchCityWeather, fetchPatrolWeather } from '@/api/weather'

const props = defineProps({
  active: { type: Boolean, default: true },
  hideHeader: { type: Boolean, default: false },
})

const store = datashare()
const { activePatrols } = storeToRefs(store)

const cityWeather = ref(null)
const patrolWeather = ref(null)
const loadingCity = ref(false)
const loadingPatrol = ref(false)
const lastUpdate = ref('')

let pollTimer = null
let lastPatrolKey = ''

const formatPrecipitation = (realTime) => {
  if (!realTime) return '0'
  const precip = Number.parseFloat(realTime.precipitation)
  if (Number.isFinite(precip) && precip > 0) return precip
  const text = String(realTime.weather_text || '')
  if (text.includes('雨')) return '微量'
  return Number.isFinite(precip) ? precip : '0'
}

const showPrecipUnit = (realTime) => formatPrecipitation(realTime) !== '微量'

const formatLineName = (line, lineName) => {
  const src = line || lineName
  if (!src) return '未知线路'
  const m = String(src).match(/(\d+)\s*号线/)
  if (m) return `${m[1]}号线`
  return String(src).replace('成都地铁', '') || src
}

const getPatrolKey = () => Object.keys(activePatrols.value || {}).sort().join(',')

const hasActivePatrol = () => getPatrolKey().length > 0

const loadCityWeather = async (silent = false) => {
  if (!silent) loadingCity.value = true
  try {
    const data = await fetchCityWeather()
    cityWeather.value = data
    store.setWeatherCity(data)
    lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch (err) {
    console.error('城市天气加载失败:', err)
  } finally {
    if (!silent) loadingCity.value = false
  }
}

const loadPatrolWeather = async (silent = false) => {
  if (!hasActivePatrol()) {
    patrolWeather.value = { has_patrol: false }
    store.clearWeatherPatrol()
    return
  }

  if (!silent) loadingPatrol.value = true
  try {
    const data = await fetchPatrolWeather()
    patrolWeather.value = data
    if (data.has_patrol) {
      store.setWeatherPatrol(data)
    } else {
      store.clearWeatherPatrol()
    }
  } catch (err) {
    console.error('巡航线路天气加载失败:', err)
  } finally {
    if (!silent) loadingPatrol.value = false
  }
}

watch(activePatrols, () => {
  const key = getPatrolKey()
  if (key === lastPatrolKey) return
  lastPatrolKey = key
  loadPatrolWeather(true)
}, { deep: true })

const startPoll = () => {
  if (pollTimer || !props.active) return
  pollTimer = setInterval(() => {
    if (!props.active) return
    loadCityWeather(true)
    if (hasActivePatrol()) loadPatrolWeather(true)
  }, 5 * 60 * 1000)
}

const stopPoll = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(() => props.active, (v) => {
  if (v) {
    loadCityWeather(true)
    loadPatrolWeather(true)
    startPoll()
  } else {
    stopPoll()
  }
})

onMounted(async () => {
  if (!props.active) return
  lastPatrolKey = getPatrolKey()
  await loadCityWeather()
  await loadPatrolWeather()
  startPoll()
})

onUnmounted(() => {
  stopPoll()
})
</script>

<style scoped>
.weather-section {
  background: rgba(12, 22, 48, 0.22);
  border: 1px solid rgba(0, 212, 255, 0.18);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: bold;
  color: #00d4ff;
  margin-bottom: 12px;
  text-shadow: 0 0 5px rgba(0, 212, 255, 0.5);
}

.update-time {
  margin-left: auto;
  font-size: 11px;
  color: #a0a0a0;
  font-weight: normal;
}

.weather-block {
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.1);
}

.weather-block:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.block-label {
  font-size: 13px;
  color: #e0e0e0;
  font-weight: 600;
}

.flight-badge {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: bold;
}

.flight-badge.safe {
  background: rgba(0, 255, 136, 0.15);
  color: #00ff88;
  border: 1px solid rgba(0, 255, 136, 0.35);
}

.flight-badge.caution {
  background: rgba(255, 170, 0, 0.15);
  color: #ffaa00;
  border: 1px solid rgba(255, 170, 0, 0.35);
}

.flight-badge.danger {
  background: rgba(255, 68, 68, 0.15);
  color: #ff4444;
  border: 1px solid rgba(255, 68, 68, 0.35);
}

.metric-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.metric-grid.compact {
  gap: 6px;
}

.metric-card {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 212, 255, 0.12);
}

.metric-card.highlight {
  grid-column: 1 / -1;
  border-color: rgba(0, 212, 255, 0.25);
}

.metric-label {
  display: block;
  font-size: 11px;
  color: #a0a0a0;
  margin-bottom: 4px;
}

.metric-value {
  font-size: 15px;
  color: #fff;
  font-weight: 600;
}

.metric-card.highlight .metric-value {
  font-size: 22px;
}

.metric-value small {
  font-size: 12px;
  color: #00d4ff;
  font-weight: normal;
  margin-left: 2px;
}

.hint-text {
  font-size: 12px;
  color: #a0a0a0;
  text-align: center;
  padding: 10px 0;
}

.empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 10px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 6px;
  border: 1px dashed rgba(0, 212, 255, 0.15);
  font-size: 12px;
  color: #a0a0a0;
}

.empty-icon {
  font-size: 20px;
  opacity: 0.5;
}

.patrol-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.patrol-drone {
  font-size: 13px;
  color: #fff;
  font-weight: 600;
}

.patrol-line {
  font-size: 11px;
  color: #00d4ff;
  padding: 1px 8px;
  background: rgba(0, 212, 255, 0.1);
  border-radius: 4px;
}
</style>
