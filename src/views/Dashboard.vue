<template>
  <div class="dashboard">
    <!-- 模拟演示弹窗预警 -->
    <ViolationAlertOverlay
      :visible="showViolationAlert"
      :violation="violationAlertData?.violation"
      :task="violationAlertData?.task"
      @dismiss="showViolationAlert = false"
    />
    <div class="workspace">
      <!-- 加载页面（测试阶段暂时停用，后续恢复） -->
      <!-- <Transition name="loading-exit">
        <Loading v-if="isLoading" />
      </Transition> -->
      <!-- 中间地图 -->
      <div class="map-underlay">
        <MapArea />
      </div>
      <!-- 顶部 -->
      <HeaderBar />
      <!-- 侧栏直接叠在 workspace 上，避免 main-content 全屏层挡住 WebGL canvas -->
      <div class="side-panel-anchor side-panel-anchor--left">
        <LeftPanel :vehicle-stats="vehicleStats" />
      </div>
      <div class="side-panel-anchor side-panel-anchor--right">
        <RightPanel />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import HeaderBar from '@/components/HeaderBar.vue'
import LeftPanel from '@/components/LeftPanel.vue'
import MapArea from '@/components/MapArea.vue'
import RightPanel from '@/components/RightPanel.vue'
// import Loading from '@/components/loading.vue'
import ViolationAlertOverlay from '@/components/ViolationAlertOverlay.vue'
import { ElMessage } from 'element-plus'
import { io } from 'socket.io-client'
import datashare from '@/stores/index.js'
// import { storeToRefs } from 'pinia'
import { startDetectionApi, stopDetectionApi, buildDetectionPayloadFromStore } from '@/api/detection'
import { API_BASE } from '@/config'

const API = API_BASE
let socket = null
let fleetPollTimer = null
let fleetBackendDown = false
/**
 * 实时推送（Socket.IO）默认关闭。
 * 本开源仓库不包含 Flask 后端，开启会不断重连报错；
 * 若你自建了后端，把 .env 里的 VITE_ENABLE_REALTIME 设为 true 即可。
 */
const REALTIME_ENABLED = import.meta.env.VITE_ENABLE_REALTIME === 'true'
let socketErrorLogged = false
const detectionData = ref([])
const showViolationAlert = ref(false)
const violationAlertData = ref(null)

const getdata = datashare()
// const { isLoading } = storeToRefs(getdata)

const fetchFleet = async () => {
  if (fleetBackendDown) return
  try {
    const res = await fetch(`${API}/api/fleet/operational`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json.success && json.data) {
      getdata.setFleet(json.data)
    }
  } catch {
    if (!fleetBackendDown) {
      fleetBackendDown = true
      console.warn('[fleet] 后端 API (:5000) 未启动，已停止机队轮询（不影响地图加载）')
      if (fleetPollTimer) {
        clearInterval(fleetPollTimer)
        fleetPollTimer = null
      }
    }
  }
}

const pushExcavatorDetection = (violation) => {
  if (!violation?.id) return
  const current = [...(detectionData.value?.detections || [])]
  if (current.some((d) => d.id === violation.id)) return
  current.push({
    type: 'excavator',
    label: 'Excavator',
    id: violation.id,
    position: { lng: violation.lng, lat: violation.lat },
  })
  detectionData.value = { detections: current }
  getdata.setDetections({ detections: current })
}

const applyViolationAlert = (data) => {
  if (!data?.violation) return
  getdata.triggerViolationAlert(data)
}

watch(
  () => getdata.violationAlertTick,
  () => {
    const data = getdata.lastViolationAlert
    if (!data?.violation) return
    violationAlertData.value = data
    showViolationAlert.value = true
    pushExcavatorDetection(data.violation)
    fetchFleet()
    if (data.task?.type === 'inspection') {
      ElMessage.warning(`已派发核查任务：${data.task.title}`)
    }
    console.warn('[违规告警]', data.violation.plate, data.violation.type)
  },
)

const connectSocket = () => {
  if (!REALTIME_ENABLED) {
    console.info(
      '[realtime] Socket.IO 未启用（VITE_ENABLE_REALTIME 未设为 true），'
      + '实时检测/机队推送不可用，地图与三维功能不受影响',
    )
    return
  }
  socket = io(API, {
    // 先 polling 再升级 websocket，避免本地代理/ws 转发抖动导致首连超时
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 12000,
  })
  socket.on('detection_update', (data) => {
    detectionData.value = data || []
    getdata.setDetections(data)
  })
  socket.on('clear_detections', () => {
    detectionData.value = []
    getdata.setDetections({ detections: [] })
  })
  socket.on('fleet_update', (data) => {
    getdata.setFleet(data)
  })
  socket.on('violation_alert', (data) => {
    applyViolationAlert(data)
  })
  socket.on('alert_notification', (alert) => {
    getdata.addAlert(alert)
  })
  socket.on('task_update', (task) => {
    fetchFleet()
    if (task?.type === 'inspection' && !getdata.lastViolationAlert?.task) {
      ElMessage.warning(`已派发核查任务：${task.title}`)
    }
  })
  socket.on('viewshed_update', (data) => {
    if (data?.records) getdata.setViewshedRecords(data.records)
    if (data?.record) getdata.addViewshedRecord(data.record)
  })
  socket.on('connect', () => {
    console.log('连接成功')
    fetchFleet()
  })
  socket.on('connect_error', (err) => {
    // 后端未启动时会持续重连，这里只提示一次，避免刷屏
    if (socketErrorLogged) return
    socketErrorLogged = true
    console.warn('[realtime] Socket.IO 连接失败（后端未启动？）:', err?.message || err)
  })
  socket.on('disconnect', () => {
    console.log('断开连接')
  })
}

const startDetection = async () => {
  try {
    const payload = buildDetectionPayloadFromStore(getdata)
    await startDetectionApi(payload)
  } catch (err) {
    console.warn('[detection] 启动失败:', err)
    ElMessage.warning(`检测服务未启动：${err.message}`)
  }
}

const vehicleStats = computed(() => {
  const counts = {
    bulldozer: 1,
    dumptruck: 1,
    excavator: 1,
    grader: 1,
    loader: 1,
    crane: 1,
    roller: 1,
  }
  detectionData.value?.detections?.forEach((item) => {
    if (counts[item.type] !== undefined) counts[item.type]++
  })
  return counts
})

onMounted(() => {
  fetchFleet()
  connectSocket()
  fleetPollTimer = setInterval(fetchFleet, 10000)
})

onUnmounted(() => {
  if (fleetPollTimer) clearInterval(fleetPollTimer)
  stopDetectionApi()
  socket?.disconnect()
})
</script>

<style scoped>
.dashboard {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0a0a0a;
  overflow: hidden;
}

.workspace {
  --header-height: 80px;
  --left-panel-width: 320px;
  --right-panel-width: 350px;
  --left-panel-occupy: calc(var(--left-panel-width) + 24px);
  --right-panel-occupy: calc(var(--right-panel-width) + 24px);
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.map-underlay {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.map-underlay :deep(.cesium-widget),
.map-underlay :deep(.cesium-widget canvas) {
  width: 100% !important;
  height: 100% !important;
  display: block;
  position: relative;
  z-index: 0;
}

.map-underlay :deep(.map-area),
.map-underlay :deep(.enhanced-3d-map),
.map-underlay :deep(.cesium-container) {
  width: 100%;
  height: 100%;
  border-radius: 0;
}

/* 锚点本身不拦截地图拖动；仅子面板接收鼠标 */
.side-panel-anchor {
  position: absolute;
  z-index: 10;
  top: var(--header-height, 80px);
  bottom: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  pointer-events: none;
}

.side-panel-anchor > * {
  pointer-events: auto;
}

.side-panel-anchor--left {
  left: 0;
  width: var(--left-panel-width);
  padding-left: 12px;
}

.side-panel-anchor--right {
  right: 0;
  width: var(--right-panel-width);
  padding-right: 12px;
}

/* 加载页退出动画（与 Loading 组件一并停用） */
/*
.loading-exit-leave-active {
  transition: opacity 0.65s ease, transform 0.65s ease;
}

.loading-exit-leave-to {
  opacity: 0;
  transform: scale(1.015);
}
*/
</style>
