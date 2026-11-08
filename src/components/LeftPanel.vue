<template>
  <div class="left-panel">
    <CollapsiblePanel side="left" panel-key="stats">
      <template #title>
        <el-icon><DataAnalysis /></el-icon>
        <span>检测统计</span>
      </template>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon excavator">
            <img style="width: 22px; height: 22px;" src="/tubiao/推土车.svg">
          </div>
          <div class="stat-content">
            <div class="stat-number">{{ vehicleStats.bulldozer }}</div>
            <div class="stat-label">推土车</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon excavator">
            <img style="width: 22px; height: 22px;" src="/tubiao/自卸车.svg">
          </div>
          <div class="stat-content">
            <div class="stat-number">{{ vehicleStats.dumptruck }}</div>
            <div class="stat-label">自卸车</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon excavator">
            <img style="width: 22px; height: 22px;" src="/tubiao/挖掘机.svg">
          </div>
          <div class="stat-content">
            <div class="stat-number">{{ vehicleStats.excavator }}</div>
            <div class="stat-label">挖掘机</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon excavator">
            <img style="width: 22px; height: 22px;" src="/tubiao/平地机.svg">
          </div>
          <div class="stat-content">
            <div class="stat-number">{{ vehicleStats.grader }}</div>
            <div class="stat-label">平地机</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon excavator">
            <img style="width: 22px; height: 22px;" src="/tubiao/装卸机.svg">
          </div>
          <div class="stat-content">
            <div class="stat-number">{{ vehicleStats.loader }}</div>
            <div class="stat-label">装载机</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon excavator">
            <img style="width: 22px; height: 22px;" src="/tubiao/起重机.svg">
          </div>
          <div class="stat-content">
            <div class="stat-number">{{ vehicleStats.crane }}</div>
            <div class="stat-label">起重机</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon excavator">
            <img style="width: 22px; height: 22px;" src="/tubiao/压路机.svg">
          </div>
          <div class="stat-content">
            <div class="stat-number">{{ vehicleStats.roller }}</div>
            <div class="stat-label">压路机</div>
          </div>
        </div>
      </div>
    </CollapsiblePanel>

    <CollapsiblePanel side="left" panel-key="devices">
      <template #title>
        <el-icon><Monitor /></el-icon>
        <span>设备状态监控</span>
      </template>
      <div class="device-monitor">
        <div v-for="device in deviceStatus" :key="device.id" class="device-card">
          <div class="device-header">
            <span class="device-name">{{ device.name }}</span>
            <span class="device-badge" :class="device.online ? 'online' : 'offline'">
              {{ device.online ? '在线' : '离线' }}
            </span>
          </div>
          <div class="metric-row">
            <span class="metric-label">电量</span>
            <div class="battery-bar">
              <div
                class="battery-fill"
                :style="{ width: device.battery + '%', background: getBatteryGradient(device.battery) }"
              />
            </div>
            <span class="metric-value">{{ device.battery }}%</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">任务执行</span>
            <div class="task-bar">
              <div class="task-fill" :style="{ width: device.taskProgress + '%' }" />
            </div>
            <span class="metric-value highlight">{{ device.taskElapsed }}</span>
          </div>
        </div>
      </div>
    </CollapsiblePanel>

    <CollapsiblePanel side="left" panel-key="personnel">
      <template #title>
        <el-icon><User /></el-icon>
        <span>巡查人员</span>
        <el-badge :value="personnelStats.online" class="personnel-badge" />
      </template>
      <div class="personnel-list">
        <div
          v-for="person in personnel"
          :key="person.id"
          class="personnel-item"
          :class="person.status"
          @click="selectPersonnel(person)"
        >
          <div class="personnel-avatar">
            <span class="avatar-text">{{ person.name.charAt(0) }}</span>
            <div class="status-indicator" :class="person.status" />
          </div>
          <div class="personnel-info">
            <div class="personnel-name">{{ person.name }}</div>
            <div class="personnel-details">
              <span class="employee-id">{{ person.phone }}</span>
            </div>
          </div>
          <div class="personnel-status">
            <span class="status-text">{{ getPersonnelStatusText(person.status) }}</span>
          </div>
        </div>
      </div>
      <div class="personnel-stats">
        <div class="stat-row">
          <span>在线: {{ personnelStats.online }}人</span>
          <span>离线: {{ personnelStats.offline }}人</span>
        </div>
      </div>
    </CollapsiblePanel>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { DataAnalysis, Monitor, User } from '@element-plus/icons-vue'
import CollapsiblePanel from './CollapsiblePanel.vue'
import datashare from '@/stores/index.js'
import { storeToRefs } from 'pinia'

const getdata = datashare()
const { fleetPersonnel, fleetDrones, activePatrols } = storeToRefs(getdata)

defineProps({
  vehicleStats: {
    type: Object,
    default: () => ({
      bulldozer: 0,
      dumptruck: 0,
      excavator: 0,
      grader: 0,
      loader: 0,
      crane: 0,
      roller: 0,
    }),
  },
})

const deviceStatus = computed(() =>
  fleetDrones.value.map((d) => {
    const isPatrolling = !!activePatrols.value?.[d.id]
    return {
      id: d.id,
      name: d.name,
      battery: d.battery ?? 0,
      taskElapsed: isPatrolling ? '执行中' : '--:--:--',
      taskProgress: isPatrolling ? Math.min(100, Math.max(10, d.battery ?? 0)) : 0,
      online: !!d.online,
    }
  }),
)

const getBatteryGradient = (pct) => {
  if (pct >= 60) return 'linear-gradient(90deg, #00ff88, #00d4ff)'
  if (pct >= 30) return 'linear-gradient(90deg, #ffc107, #ff9800)'
  return 'linear-gradient(90deg, #ff6b6b, #ff4444)'
}

const personnel = computed(() =>
  fleetPersonnel.value.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone || '—',
    status: p.online ? 'online' : 'offline',
  })),
)

const personnelStats = computed(() => ({
  online: personnel.value.filter((p) => p.status === 'online').length,
  offline: personnel.value.filter((p) => p.status === 'offline').length,
}))

const getPersonnelStatusText = (status) => (status === 'online' ? '在岗' : '离线')

const selectPersonnel = (person) => {
  console.log('选择人员:', person.name)
}
</script>

<style scoped>
.left-panel {
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
  scrollbar-width: none;
}

.left-panel::-webkit-scrollbar {
  display: none;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.stat-card {
  background: rgba(0, 0, 0, 0.14);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(0, 212, 255, 0.12);
}

.stat-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon.excavator {
  background: linear-gradient(45deg, #ff6b6b, #ff8e8e);
}

.stat-number {
  font-size: 22px;
  font-weight: bold;
  color: #fff;
}

.stat-label {
  font-size: 12px;
  color: #a0a0a0;
}

.device-monitor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.device-card {
  padding: 10px;
  background: rgba(0, 212, 255, 0.05);
  border: 1px solid rgba(0, 212, 255, 0.15);
  border-radius: 8px;
}

.device-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.device-name {
  font-size: 13px;
  color: #fff;
  font-weight: 500;
}

.device-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}

.device-badge.online {
  color: #00ff88;
  background: rgba(0, 255, 136, 0.15);
}

.device-badge.offline {
  color: #a0a0a0;
  background: rgba(160, 160, 160, 0.15);
}

.metric-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
}

.metric-label {
  color: #a0a0a0;
  min-width: 56px;
}

.metric-value {
  color: #e0e0e0;
  margin-left: auto;
  font-weight: 500;
}

.metric-value.highlight {
  color: #00d4ff;
}

.battery-bar,
.task-bar {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.battery-fill,
.task-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.task-fill {
  background: linear-gradient(90deg, #00d4ff, #00ff88);
}

.personnel-badge {
  margin-left: 8px;
}

.personnel-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.personnel-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  border: 1px solid rgba(0, 212, 255, 0.1);
  cursor: pointer;
}

.personnel-item.online {
  border-left: 3px solid #00ff88;
}

.personnel-item.offline {
  border-left: 3px solid #666;
  opacity: 0.65;
}

.personnel-avatar {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(45deg, #00d4ff, #0099cc);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-text {
  color: #fff;
  font-weight: bold;
}

.status-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.6);
}

.status-indicator.online {
  background: #00ff88;
}

.status-indicator.offline {
  background: #666;
}

.personnel-name {
  font-size: 13px;
  font-weight: bold;
  color: #fff;
}

.personnel-details {
  font-size: 11px;
  color: #a0a0a0;
}

.employee-id {
  color: #00d4ff;
}

.status-text {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 10px;
  background: rgba(0, 212, 255, 0.1);
  color: #00d4ff;
}

.personnel-stats .stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #a0a0a0;
}
</style>
