<template>
  <div class="right-panel">
    <CollapsiblePanel side="right" panel-key="weather">
      <template #title>
        <el-icon><Sunny /></el-icon>
        <span>天气监控</span>
      </template>
      <WeatherPanel :active="panelStates.right.weather" hide-header />
    </CollapsiblePanel>

    <CollapsiblePanel side="right" panel-key="route">
      <template #title>
        <el-icon><Guide /></el-icon>
        <span>航线与空域管控</span>
      </template>
      <RouteControlPanel />
    </CollapsiblePanel>

    <CollapsiblePanel side="right" panel-key="viewshed">
      <template #title>
        <el-icon><View /></el-icon>
        <span>航点可视域分析</span>
      </template>
      <div class="viewshed-body">
        <div class="viewshed-stats">
          <div class="stat-card stat-card--visible">
            <div class="stat-label">
              有效监控面积
              <span v-if="viewshed.currentWaypointIndex != null" class="stat-waypoint">#{{ viewshed.currentWaypointIndex + 1 }}</span>
            </div>
            <div class="stat-value">{{ formatArea(viewshed.visibleAreaM2) }}</div>
          </div>
          <div class="stat-card stat-card--blind">
            <div class="stat-label">
              盲区面积
              <span v-if="viewshed.currentWaypointIndex != null" class="stat-waypoint">#{{ viewshed.currentWaypointIndex + 1 }}</span>
            </div>
            <div class="stat-value">{{ formatArea(viewshed.blindAreaM2) }}</div>
          </div>
        </div>

        <div v-if="viewshed.savedWaypointCount > 1 && (viewshed.cumulativeVisibleM2 > 0 || viewshed.cumulativeBlindM2 > 0)" class="viewshed-cumulative">
          <span>累计有效 {{ formatArea(viewshed.cumulativeVisibleM2) }}</span>
          <span>累计盲区 {{ formatArea(viewshed.cumulativeBlindM2) }}</span>
        </div>

        <div v-if="viewshed.scanning" class="scan-progress">
          <div class="scan-bar">
            <div class="scan-bar-fill scan-bar-fill--scan" :style="{ width: `${viewshed.scanProgress * 100}%` }" />
          </div>
          <span class="scan-text">航点环视扫描 {{ Math.round(viewshed.scanProgress * 100) }}%</span>
        </div>

        <div v-else-if="viewshed.analysing" class="scan-progress">
          <div class="scan-bar">
            <div class="scan-bar-fill scan-bar-fill--build" :style="{ width: `${(viewshed.buildProgress || 0) * 100}%` }" />
          </div>
          <span class="scan-text">立体可视域构建 {{ Math.round((viewshed.buildProgress || 0) * 100) }}%</span>
        </div>

        <label class="param-field param-field--readonly">
          <span>俯仰角 (°)</span>
          <input :value="pitchInput" type="number" readonly disabled title="环视分析使用固定俯仰角" />
          <span class="field-hint">环视固定 -28°（不可调）</span>
        </label>

        <label class="param-field">
          <span>立体模型精度</span>
          <select v-model="precisionInput" class="precision-select" @change="applyPrecision">
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </label>

        <div class="viewshed-actions">
          <el-button type="primary" size="small" :disabled="!canManualStep" @click="stepGimbal">云台步进旋转</el-button>
          <el-button type="warning" size="small" @click="toggleBoundsDebug">
            {{ viewshed.boundsDebugVisible ? '隐藏视锥边界' : '视锥边界调试' }}
          </el-button>
          <el-button type="success" size="small" :disabled="!viewshed.canExport" @click="exportBlindJson">导出盲区 JSON</el-button>
        </div>

        <p v-if="viewshed.areaValidation && !viewshed.areaValidation.ok" class="viewshed-warn">{{ viewshed.areaValidation.warning }}</p>
        <p v-else-if="viewshed.areaValidation?.info" class="viewshed-bbox-hint">{{ viewshed.areaValidation.info }}</p>
        <p v-else-if="viewshed.bboxFilterStats?.raySkipRatio > 0" class="viewshed-bbox-hint">
          包围盒过滤：跳过 {{ (viewshed.bboxFilterStats.raySkipRatio * 100).toFixed(0) }}% 射线，
          丢弃 {{ (viewshed.bboxFilterStats.facetDiscardRatio * 100).toFixed(0) }}% 面片
        </p>
        <p class="viewshed-hint">
          <template v-if="viewshed.scanning">航点悬停：360° 霓虹环视扫描中…</template>
          <template v-else-if="viewshed.analysing">环视完成：立体可视域展开构建中…</template>
          <template v-else-if="viewshed.savedWaypointCount > 0">
            已保留 {{ viewshed.savedWaypointCount }} 个航点立体可视域，图层控制可统一显隐
          </template>
          <template v-else-if="viewshed.canExport">本航点分析完成，继续巡航将保留并累积可视域</template>
          <template v-else>无人机抵达每个航点后自动启动立体可视域分析</template>
        </p>
      </div>
    </CollapsiblePanel>

    <CollapsiblePanel side="right" panel-key="ai">
      <template #title>
        <el-icon><ChatDotRound /></el-icon>
        <span>AI巡检专家</span>
      </template>
      <div v-if="panelStates.right.ai" class="ai-content">
        <div class="ai-description">
          <p>智能问答助手</p>
          <p class="ai-subtitle">专业解答 • 技术指导 • 安全咨询</p>
        </div>
        <el-button type="success" size="large" class="ai-button" @click="openAIAssistant">
          <el-icon><ChatDotRound /></el-icon>
          开始咨询
        </el-button>
      </div>
    </CollapsiblePanel>

    <el-dialog
      v-model="showAIDialog"
      title="AI巡检专家"
      width="780px"
      top="5vh"
      append-to-body
      align-center
      :z-index="10050"
      class="ai-chat-dialog"
      modal-class="ai-chat-dialog-modal"
      @opened="onDialogOpened"
    >
      <div class="ai-dialog-body" @wheel.stop>
        <div class="chat-messages" ref="chatMessagesContainer">
          <div v-for="message in chatMessages" :key="message.id" class="message" :class="message.type">
            <div class="message-avatar">
              <span v-if="message.type === 'user'">👤</span>
              <span v-else>🤖</span>
            </div>
            <div class="message-content">
              <div class="message-text">{{ message.text }}</div>
              <div class="message-time">{{ message.time }}</div>
            </div>
          </div>
          <div v-if="isAIThinking" class="message ai">
            <div class="message-avatar">🤖</div>
            <div class="message-content">
              <div class="thinking-indicator"><span /><span /><span /></div>
            </div>
          </div>
        </div>
        <div class="chat-input">
          <el-input
            v-model="userInput"
            placeholder="请输入您关于地铁巡检的问题..."
            type="textarea"
            :rows="3"
            @keydown.enter.ctrl="sendMessage"
            :disabled="isAIThinking"
          />
          <el-button type="primary" @click="sendMessage" :loading="isAIThinking" :disabled="!userInput.trim()" class="send-button">
            发送
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { ChatDotRound, View, Sunny, Guide } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import WeatherPanel from './WeatherPanel.vue'
import RouteControlPanel from './RouteControlPanel.vue'
import CollapsiblePanel from './CollapsiblePanel.vue'
import datashare from '@/stores/index.js'
import { storeToRefs } from 'pinia'
import { API_BASE } from '@/config'

const API = API_BASE
const getdata = datashare()
const { viewshed, panelStates } = storeToRefs(getdata)

const pitchInput = ref(-28)
const precisionInput = ref('high')

watch(() => viewshed.value.gimbalPitch, (v) => { pitchInput.value = v }, { immediate: true })
watch(() => viewshed.value.meshPrecision, (v) => { if (v) precisionInput.value = v }, { immediate: true })

const canManualStep = computed(() => viewshed.value.scanning && !!getdata.viewshedActions?.stepGimbal)

const formatArea = (m2) => {
  if (m2 == null || m2 <= 0) return '—'
  const v = Number(m2)
  if (!Number.isFinite(v)) return '—'
  if (v >= 10000) return `${(v / 10000).toFixed(2)} 万㎡`
  if (v >= 1000) return `${v.toFixed(1)} ㎡`
  return `${v.toFixed(2)} ㎡`
}

const applyPrecision = () => {
  getdata.viewshedActions?.setMeshPrecision?.(precisionInput.value)
  getdata.patchViewshed({ meshPrecision: precisionInput.value })
}

const stepGimbal = () => getdata.viewshedActions?.stepGimbal?.()

const toggleBoundsDebug = () => {
  const visible = getdata.viewshedActions?.toggleFrustumBoundsDebug?.()
  getdata.patchViewshed({ boundsDebugVisible: !!visible })
}

const exportBlindJson = async () => {
  try {
    const jsonStr = await getdata.viewshedActions?.exportJson?.()
    if (!jsonStr) {
      ElMessage.warning('暂无可导出数据')
      return
    }
    const record = JSON.parse(jsonStr)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `viewshed_wp${record.waypointIndex ?? 0}_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    await fetch(`${API}/api/fleet/viewshed/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    })
    getdata.addViewshedRecord(record)
    ElMessage.success('盲区 JSON 已下载并同步存档')
  } catch (err) {
    ElMessage.error(err.message || '导出失败')
  }
}

const showAIDialog = ref(false)
const userInput = ref('')
const isAIThinking = ref(false)
const chatMessagesContainer = ref(null)
const chatMessages = ref([
  {
    id: 1,
    type: 'ai',
    text: '您好！我是AI地铁巡检专家，专门为您解答地铁沿线施工安全检测相关的问题。我可以帮助您了解检测标准、安全规范、设备操作等技术问题。请问有什么可以帮助您的吗？',
    time: new Date().toLocaleTimeString(),
  },
])

const openAIAssistant = () => { showAIDialog.value = true }
const onDialogOpened = async () => { await nextTick(); scrollChatToBottom() }
const scrollChatToBottom = () => {
  setTimeout(() => {
    const container = chatMessagesContainer.value
    if (container) container.scrollTop = container.scrollHeight
  }, 80)
}

const sendMessage = async () => {
  if (!userInput.value.trim() || isAIThinking.value) return
  chatMessages.value.push({
    id: Date.now(),
    type: 'user',
    text: userInput.value,
    time: new Date().toLocaleTimeString(),
  })
  const messageText = userInput.value
  userInput.value = ''
  isAIThinking.value = true
  scrollChatToBottom()
  try {
    const response = await fetch(`${API}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: messageText, context: '地铁巡检专家' }),
    })
    if (response.ok) {
      const data = await response.json()
      chatMessages.value.push({
        id: Date.now() + 1,
        type: 'ai',
        text: data.response,
        time: new Date().toLocaleTimeString(),
      })
    } else {
      throw new Error('API请求失败')
    }
  } catch {
    chatMessages.value.push({
      id: Date.now() + 1,
      type: 'ai',
      text: '抱歉，我现在无法连接到AI服务。请检查网络连接或稍后再试。',
      time: new Date().toLocaleTimeString(),
    })
  } finally {
    isAIThinking.value = false
    scrollChatToBottom()
  }
}
</script>

<style scoped>
.right-panel {
  width: 100%;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  background: rgba(6, 14, 32, 0.16);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 212, 255, 0.4) transparent;
}

.viewshed-body {
  display: flex;
  flex-direction: column;
}

.viewshed-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}

.stat-card {
  padding: 10px;
  border-radius: 6px;
  text-align: center;
}

.stat-card--visible {
  background: rgba(0, 255, 136, 0.12);
  border: 1px solid rgba(0, 255, 136, 0.35);
}

.stat-card--blind {
  background: rgba(255, 68, 68, 0.12);
  border: 1px solid rgba(255, 68, 68, 0.35);
}

.stat-label {
  font-size: 11px;
  color: #aaa;
  margin-bottom: 4px;
}

.stat-waypoint {
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 8px;
  font-size: 10px;
  color: #00d4ff;
  background: rgba(0, 212, 255, 0.12);
}

.viewshed-cumulative {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: -4px 0 10px;
  font-size: 10px;
  color: #8ab4c4;
}

.stat-value {
  font-size: 15px;
  font-weight: bold;
  color: #fff;
}

.scan-progress { margin-bottom: 10px; }
.scan-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}
.scan-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #00d4ff, #00ff88);
  transition: width 0.2s;
}
.scan-bar-fill--build {
  background: linear-gradient(90deg, #ffb347, #00ff88);
}
.scan-text {
  font-size: 11px;
  color: #888;
  margin-top: 4px;
  display: block;
}

.param-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #aaa;
}

.param-field input,
.precision-select {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 4px;
  color: #fff;
  padding: 6px 8px;
}

.field-hint { font-size: 10px; color: #666; }

.viewshed-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.viewshed-actions .el-button { flex: 1; }

.viewshed-warn {
  font-size: 11px;
  color: #ff6b6b;
  line-height: 1.45;
  margin: 0 0 8px;
}

.viewshed-bbox-hint {
  font-size: 10px;
  color: #8ab4c4;
  margin: 0 0 8px;
}

.viewshed-hint {
  font-size: 11px;
  color: #888;
  margin: 0;
  line-height: 1.4;
}

.ai-content {
  text-align: center;
  padding: 8px 0;
}

.ai-description { margin-bottom: 15px; }
.ai-description p {
  margin: 0;
  color: #e0e0e0;
  font-size: 14px;
}
.ai-description p:first-child {
  font-weight: bold;
  color: #fff;
  margin-bottom: 5px;
}
.ai-subtitle {
  font-size: 12px !important;
  color: #a0a0a0 !important;
}

.ai-button {
  width: 100%;
  height: 45px;
  background: linear-gradient(45deg, #00ff88, #00cc6a);
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: bold;
  color: #fff;
}
</style>

<!-- 保留 AI 弹窗全局样式 -->
<style>
.ai-chat-dialog-modal { background-color: rgba(0, 0, 0, 0.65) !important; }
.ai-chat-dialog.el-dialog {
  background: linear-gradient(160deg, rgba(8, 18, 40, 0.98) 0%, rgba(4, 10, 24, 0.98) 100%);
  border: 1px solid rgba(0, 255, 136, 0.35);
  border-radius: 14px;
  max-height: 88vh;
}
.ai-chat-dialog .el-dialog__title { color: #00ff88; font-weight: bold; }
.ai-chat-dialog .ai-dialog-body {
  height: 68vh;
  min-height: 480px;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 136, 0.15);
  overflow: hidden;
}
.ai-chat-dialog .chat-messages {
  flex: 1;
  min-height: 0;
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ai-chat-dialog .message { display: flex; gap: 12px; align-items: flex-start; }
.ai-chat-dialog .message.user { flex-direction: row-reverse; }
.ai-chat-dialog .message-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}
.ai-chat-dialog .message.user .message-avatar { background: linear-gradient(45deg, #00d4ff, #0099cc); }
.ai-chat-dialog .message.ai .message-avatar { background: linear-gradient(45deg, #00ff88, #00cc6a); }
.ai-chat-dialog .message-content { max-width: 72%; padding: 12px 16px; border-radius: 14px; }
.ai-chat-dialog .message.user .message-content {
  background: linear-gradient(135deg, rgba(0, 212, 255, 0.2), rgba(0, 212, 255, 0.08));
  border: 1px solid rgba(0, 212, 255, 0.3);
}
.ai-chat-dialog .message.ai .message-content {
  background: linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 255, 136, 0.08));
  border: 1px solid rgba(0, 255, 136, 0.3);
}
.ai-chat-dialog .message-text { color: #fff; font-size: 15px; line-height: 1.6; margin-bottom: 6px; }
.ai-chat-dialog .message-time { color: #888; font-size: 11px; }
.ai-chat-dialog .chat-input {
  padding: 16px 20px;
  border-top: 1px solid rgba(0, 255, 136, 0.2);
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-chat-dialog .chat-input .el-textarea__inner {
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(0, 255, 136, 0.35);
  border-radius: 8px;
  color: #fff;
}
.ai-chat-dialog .send-button {
  align-self: flex-end;
  min-width: 120px;
  background: linear-gradient(45deg, #00ff88, #00cc6a) !important;
  border: none !important;
}
.ai-chat-dialog .thinking-indicator { display: flex; gap: 5px; }
.ai-chat-dialog .thinking-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #00ff88;
  animation: ai-thinking 1.4s infinite ease-in-out;
}
@keyframes ai-thinking {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}
</style>
