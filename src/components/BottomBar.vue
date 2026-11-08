<template>
  <div class="bottom-bar">
    <div class="status-info">
      <div class="status-item">
        <el-icon><Connection /></el-icon>
        <span class="status-text">
          <span class="label">系统状态:</span>
          <span class="value">在线</span>
        </span>
        <div class="status-indicator online"></div>
      </div>
      
      <div class="status-item">
        <el-icon><Monitor /></el-icon>
        <span class="status-text">
          <span class="label">无人机:</span>
          <span class="value">{{ droneStatus.count }}台</span>
        </span>
        <div class="status-indicator" :class="droneStatus.status"></div>
      </div>
      
      <div class="status-item">
        <el-icon><DataAnalysis /></el-icon>
        <span class="status-text">
          <span class="label">检测频率:</span>
          <span class="value">{{ detectionFrequency }}</span>
          <span class="unit">次/分</span>
        </span>
        <div class="status-indicator processing"></div>
      </div>
      
      <div class="status-item">
        <el-icon><Warning /></el-icon>
        <span class="status-text">
          <span class="label">告警数量:</span>
          <span class="value">{{ alertCount }}</span>
        </span>
        <div class="status-indicator" :class="alertCount > 0 ? 'warning' : 'normal'"></div>
      </div>
    </div>
    
    <div class="data-stream">
      <div class="stream-title">实时数据流</div>
      <div class="stream-content">
        <div 
          v-for="(item, index) in dataStream" 
          :key="index"
          class="stream-item"
        >
          <span class="stream-time">{{ item.time }}</span>
          <span class="stream-data">{{ item.data }}</span>
        </div>
      </div>
    </div>
    
    <div class="system-info">
      <div class="info-item">
        <span>CPU使用率: {{ systemInfo.cpu }}%</span>
      </div>
      <div class="info-item">
        <span>内存使用: {{ systemInfo.memory }}%</span>
      </div>
      <div class="info-item">
        <span>网络延迟: {{ systemInfo.network }}ms</span>
      </div>
      <div class="info-item">
        <span>存储空间: {{ systemInfo.storage }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { Connection, Monitor, DataAnalysis, Warning } from '@element-plus/icons-vue'

const droneStatus = reactive({
  count: 3,
  status: 'online'
})

const detectionFrequency = ref(12)
const alertCount = ref(3)

const systemInfo = reactive({
  cpu: 45,
  memory: 62,
  network: 15,
  storage: 38
})

const dataStream = ref([
  { time: '14:35:42', data: '检测到挖掘机 - 置信度: 96.8%' },
  { time: '14:35:38', data: '铲车违规作业 - 位置: 1号线东单站' },
  { time: '14:35:35', data: '装卸车正常作业 - 位置: 1号线王府井站' },
  { time: '14:35:32', data: '无人机航拍完成 - 区域: 1.2km²' },
  { time: '14:35:28', data: '检测到挖掘机 - 置信度: 89.2%' }
])

// 模拟数据更新
let updateInterval = null

const updateData = () => {
  // 更新检测频率
  detectionFrequency.value = Math.floor(Math.random() * 10) + 8
  
  // 更新系统信息
  systemInfo.cpu = Math.floor(Math.random() * 30) + 30
  systemInfo.memory = Math.floor(Math.random() * 20) + 50
  systemInfo.network = Math.floor(Math.random() * 20) + 10
  systemInfo.storage = Math.floor(Math.random() * 20) + 30
  
  // 更新告警数量
  alertCount.value = Math.floor(Math.random() * 8)
  
  // 添加新的数据流
  const now = new Date()
  const timeStr = now.toLocaleTimeString('zh-CN')
  const newData = {
    time: timeStr,
    data: `检测数据更新 - 时间: ${timeStr}`
  }
  
  dataStream.value.unshift(newData)
  if (dataStream.value.length > 5) {
    dataStream.value.pop()
  }
}

onMounted(() => {
  updateInterval = setInterval(updateData, 3000)
})

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval)
  }
})
</script>

<style scoped>
.bottom-bar {
  height: 60px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.9) 0%, rgba(26, 26, 46, 0.9) 50%, rgba(0, 0, 0, 0.9) 100%);
  border-top: 1px solid rgba(0, 212, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.status-info {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-shrink: 0;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #e0e0e0;
  position: relative;
  min-width: 0;
  flex-shrink: 0;
}

.status-item .el-icon {
  color: #00d4ff;
  font-size: 16px;
  flex-shrink: 0;
}

.status-text {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.status-text .label {
  color: #a0a0a0;
  font-size: 12px;
  white-space: nowrap;
}

.status-text .value {
  color: #e0e0e0;
  font-weight: bold;
  font-size: 13px;
  white-space: nowrap;
}

.status-text .unit {
  color: #666;
  font-size: 11px;
  white-space: nowrap;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 8px;
  animation: pulse 2s infinite;
}

.status-indicator.online {
  background: #00ff88;
}

.status-indicator.processing {
  background: #00d4ff;
}

.status-indicator.warning {
  background: #f9ca24;
}

.status-indicator.normal {
  background: #00ff88;
}

.data-stream {
  flex: 1;
  margin: 0 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.stream-title {
  font-size: 14px;
  color: #00d4ff;
  font-weight: bold;
  white-space: nowrap;
}

.stream-content {
  flex: 1;
  display: flex;
  gap: 20px;
  overflow: hidden;
}

.stream-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  border: 1px solid rgba(0, 212, 255, 0.2);
  min-width: 160px;
  max-width: 200px;
  animation: slideIn 0.5s ease-out;
  flex-shrink: 0;
}

.stream-time {
  font-size: 11px;
  color: #666;
}

.stream-data {
  font-size: 12px;
  color: #e0e0e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.system-info {
  display: flex;
  gap: 15px;
  align-items: center;
  flex-shrink: 0;
}

.info-item {
  font-size: 12px;
  color: #a0a0a0;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  border: 1px solid rgba(0, 212, 255, 0.1);
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .status-info {
    gap: 15px;
  }
  
  .status-item {
    font-size: 12px;
  }
  
  .data-stream {
    margin: 0 15px;
  }
  
  .stream-item {
    min-width: 140px;
    max-width: 180px;
  }
  
  .system-info {
    gap: 10px;
  }
}

@media (max-width: 900px) {
  .bottom-bar {
    padding: 0 15px;
  }
  
  .status-info {
    gap: 10px;
  }
  
  .status-text .label {
    font-size: 11px;
  }
  
  .status-text .value {
    font-size: 12px;
  }
  
  .data-stream {
    margin: 0 10px;
  }
  
  .stream-item {
    min-width: 120px;
    max-width: 160px;
  }
  
  .system-info {
    gap: 8px;
  }
  
  .info-item {
    font-size: 11px;
    padding: 3px 6px;
  }
}
</style>


