<template>
  <nav ref="toolbarRef" class="top-toolbar">
    <button
      type="button"
      class="tool-menu-btn tool-menu-btn--demo"
      :class="{ active: simulationActive }"
      @click="act('startSimulationDemo')"
    >
      模拟演示
    </button>
    <div
      v-for="menu in menus"
      :key="menu.id"
      class="tool-menu"
    >
      <button
        type="button"
        class="tool-menu-btn"
        :class="{ active: openMenu === menu.id }"
        @click.stop="toggleMenu(menu.id)"
      >
        {{ menu.label }}
      </button>
      <div v-if="openMenu === menu.id" class="tool-dropdown" @click.stop>
        <template v-if="menu.id === 'layers'">
          <button type="button" class="dropdown-item" :class="{ checked: layers.wind }" @click="act('toggleWindLayer')">
            {{ layers.wind ? '✓ ' : '' }}{{ layers.wind ? '隐藏风场' : '显示风场' }}
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.rain }" @click="act('toggleRainLayer')">
            {{ layers.rain ? '✓ ' : '' }}{{ layers.rain ? '隐藏下雨' : '显示下雨' }}
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.cloud }" @click="act('toggleCloudLayer')">
            {{ layers.cloud ? '✓ ' : '' }}{{ layers.cloud ? '隐藏体积云' : '显示体积云' }}
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.heatmap }" @click="act('toggleHeatmapLayer')">
            {{ layers.heatmap ? '✓ ' : '' }}危险热力图
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.route }" @click="act('toggleRouteLayer')">
            {{ layers.route ? '✓ ' : '' }}{{ layers.route ? '隐藏航线' : '显示航线' }}
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.building }" @click="act('toggleBuildingLayer')">
            {{ layers.building ? '✓ ' : '' }}{{ layers.building ? '隐藏建筑' : '显示建筑' }}
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.terrain }" @click="act('toggleTerrainLayer')">
            {{ layers.terrain ? '✓ ' : '' }}{{ layers.terrain ? '隐藏地形' : '显示地形' }}
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.blindZone }" @click="act('toggleBlindZoneLayer')">
            {{ layers.blindZone ? '✓ ' : '' }}{{ layers.blindZone ? '隐藏航点可视域' : '显示航点可视域' }}
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: layers.orbit }" @click="act('toggleOrbitRotation')">
            {{ layers.orbit ? '✓ ' : '' }}环绕旋转
          </button>
          <div v-if="!layers.orbit" class="orbit-params">
            <label class="param-field">
              <span>环绕高度 (m)</span>
              <input
                :value="orbit.heightM"
                type="number"
                min="500"
                max="50000"
                step="100"
                @change="onOrbitParamChange('setOrbitHeight', $event)"
              />
            </label>
            <label class="param-field">
              <span>环绕俯仰 (°)</span>
              <input
                :value="orbit.pitchDeg"
                type="number"
                min="-89"
                max="-5"
                step="1"
                @change="onOrbitParamChange('setOrbitPitch', $event)"
              />
            </label>
          </div>
        </template>

        <template v-else-if="menu.id === 'survey'">
          <button type="button" class="dropdown-item" :class="{ checked: survey.activeTool === 'distance' }" @click="act('toggleSurveyTool', 'distance')">
            {{ survey.activeTool === 'distance' ? '✓ ' : '' }}长度测量
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: survey.activeTool === 'area' }" @click="act('toggleSurveyTool', 'area')">
            {{ survey.activeTool === 'area' ? '✓ ' : '' }}面积测量
          </button>
          <button type="button" class="dropdown-item" :class="{ checked: survey.activeTool === 'elevation' }" @click="act('toggleSurveyTool', 'elevation')">
            {{ survey.activeTool === 'elevation' ? '✓ ' : '' }}单点经纬度查询
          </button>
          <button type="button" class="dropdown-item dropdown-item--warn" @click="act('clearAllSurveyMeasure')">一键清除全部测量图形</button>
        </template>

        <template v-else-if="menu.id === 'nofly'">
          <button type="button" class="dropdown-item" :class="{ checked: nofly.drawing }" @click="act('startDrawNoFly')">开始绘制禁飞区</button>
          <button type="button" class="dropdown-item" @click="act('stopDrawNoFly')">完成绘制</button>
          <button type="button" class="dropdown-item dropdown-item--warn" @click="act('clearNoFlyZones')">清空禁飞区</button>
        </template>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import datashare from '@/stores/index.js'

const store = datashare()
const { mapUi } = storeToRefs(store)

const menus = [
  { id: 'layers', label: '图层控制' },
  { id: 'survey', label: '测绘测量' },
  { id: 'nofly', label: '禁飞区绘制' },
]

/** 各绘制/测量功能操作说明（点击后弹出） */
const TOOL_HINTS = {
  'toggleSurveyTool:distance': {
    title: '长度测量',
    text: '左键点击地图依次添加测点；右键结束当前线段。可连续测量多段，线段长度会自动标注。',
  },
  'toggleSurveyTool:area': {
    title: '面积测量',
    text: '左键点击添加多边形顶点（至少 3 点）；右键闭合并完成面积计算，显示投影面积与曲面面积。',
  },
  'toggleSurveyTool:elevation': {
    title: '单点经纬度查询',
    text: '左键点击地图任意位置，即可在该点显示经度、纬度标注。',
  },
  clearAllSurveyMeasure: {
    title: '清除测量',
    text: '将清除地图上全部测量图形（距离、面积、标注点），此操作不可撤销。',
  },
  startDrawNoFly: {
    title: '绘制禁飞区',
    text: '左键在地图上依次点击添加顶点（至少 3 点）。达到 3 点后会自动提交；也可点「完成绘制」手动结束。',
  },
  stopDrawNoFly: {
    title: '完成绘制',
    text: '结束当前绘制并提交禁飞区（需至少 3 个顶点）。提交后会参与航线风险校验。',
  },
  clearNoFlyZones: {
    title: '清空禁飞区',
    text: '清除所有手绘禁飞区，并重新校验已有航线。',
  },
  startSimulationDemo: {
    title: '模拟演示',
    text: '在地图中心生成可拖动的挖掘机模型，将其拖放到巡检航线上；当无人机巡航扫描到该车辆时将触发全屏告警、光柱标记，并同步派单至微信小程序。',
  },
}

const openMenu = ref('')
const toolbarRef = ref(null)

const simulationActive = computed(() => mapUi.value.simulation?.active ?? false)

const layers = computed(() => mapUi.value.layers)
const orbit = computed(() => mapUi.value.orbit ?? { heightM: 50000, pitchDeg: -30 })
const survey = computed(() => mapUi.value.survey)
const nofly = computed(() => mapUi.value.nofly)

const toggleMenu = (id) => {
  openMenu.value = openMenu.value === id ? '' : id
}

const closeMenu = () => {
  openMenu.value = ''
}

const showToolHint = (name, arg) => {
  const key = arg != null && arg !== '' ? `${name}:${arg}` : name
  const hint = TOOL_HINTS[key]
  if (!hint) return
  ElMessage({
    message: `${hint.title}：${hint.text}`,
    type: 'info',
    duration: 7000,
    showClose: true,
    grouping: true,
  })
}

const act = (name, arg) => {
  const isSurveyToggleOff = name === 'toggleSurveyTool' && survey.value.activeTool === arg
  if (!isSurveyToggleOff) {
    showToolHint(name, arg)
  }
  const fn = store.mapActions?.[name]
  if (fn) fn(arg)
  if (name !== 'toggleSurveyTool') closeMenu()
}

const onOrbitParamChange = (action, event) => {
  store.mapActions?.[action]?.(event.target.value)
}

const onDocumentClick = (e) => {
  if (!toolbarRef.value?.contains(e.target)) closeMenu()
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<style scoped>
.top-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tool-menu {
  position: relative;
}

.tool-menu-btn {
  padding: 7px 14px;
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 6px;
  background: rgba(12, 22, 48, 0.35);
  color: #b8dce8;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.22s ease;
  white-space: nowrap;
}

.tool-menu-btn:hover,
.tool-menu-btn.active {
  background: rgba(0, 212, 255, 0.12);
  border-color: rgba(0, 212, 255, 0.55);
  color: #00d4ff;
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.15);
}

.tool-menu-btn--demo {
  border-color: rgba(255, 140, 60, 0.35);
  color: #ffb870;
}

.tool-menu-btn--demo:hover,
.tool-menu-btn--demo.active {
  background: rgba(255, 120, 40, 0.15);
  border-color: rgba(255, 150, 60, 0.65);
  color: #ffaa44;
  box-shadow: 0 0 12px rgba(255, 120, 40, 0.2);
}

.tool-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 188px;
  padding: 8px;
  background: rgba(6, 14, 32, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dropdown-item {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #b8dce8;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dropdown-item:hover:not(:disabled) {
  background: rgba(0, 212, 255, 0.1);
  border-color: rgba(0, 212, 255, 0.2);
  color: #e8f8ff;
}

.dropdown-item.checked {
  color: #00ff88;
  border-color: rgba(0, 255, 136, 0.25);
  background: rgba(0, 255, 136, 0.08);
}

.dropdown-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dropdown-item--warn {
  color: #ffb4b4;
}

.dropdown-item--warn:hover:not(:disabled) {
  background: rgba(255, 68, 68, 0.12);
  border-color: rgba(255, 90, 90, 0.35);
}

.orbit-params {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding: 8px 6px 4px;
  border-top: 1px solid rgba(0, 212, 255, 0.12);
}

.param-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #8eb8c8;
}

.param-field span {
  flex-shrink: 0;
}

.param-field input {
  width: 72px;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 4px;
  color: #00d4ff;
  font-size: 11px;
  text-align: right;
  outline: none;
}

.param-field input:focus {
  border-color: rgba(0, 212, 255, 0.65);
}
</style>
