<!--
  Enhanced3DMap.vue — 增强版 3D 地图主组件
  基于 Cesium 渲染成都地铁保护区场景，集成风场/降雨/热力图、无人机巡航、禁飞区绘制等功能
-->
<template>
  <div class="enhanced-3d-map">
    <!-- Cesium 三维地球渲染容器 -->
    <div id="cesiumContainer" ref="cesiumContainer" class="cesium-container"></div>

    <!-- 地图浮层控件（按钮、信息面板等，叠在 Cesium 画布上方） -->
    <div class="map-overlays">
      <!-- 左下角信息面板 -->
      <div class="map-info-panel">
        <div class="info-card">
          <div class="info-title">当前视角</div>
          <div class="info-content">
            <div>经度: {{ currentView.longitude.toFixed(6) }}°</div>
            <div>纬度: {{ currentView.latitude.toFixed(6) }}°</div>
            <div>高度: {{ currentView.height.toFixed(2) }}m</div>
            <div>缩放: {{ currentView.zoom.toFixed(1) }}级</div>
          </div>
        </div>
      </div>

      <div v-if="routeGenerating" class="route-loading-overlay">
        <div class="route-loading-spinner"></div>
        <span>航线计算中，请稍候…</span>
      </div>
    </div>

  </div>
</template>

<script setup>
/**
 * 文件结构速查
 * ─────────────────────────────────────────────────────────
 * [Template]  Cesium 容器 + 浮层工具按钮 + 信息面板
 * [Script]
 *   1. 依赖导入
 *   2. Pinia 状态
 *   3. 风场 / 降雨 / 热力图 图层
 *   4. Cesium 核心实例 & 配置
 *   5. 环绕旋转
 *   6. 地铁线路 & 安全缓冲区
 *   7. 禁飞区绘制 & 机场禁飞区
 *   8. 无人机巡航 & 相机跟随 & 视觉特效
 *   9. 机队同步 & 违规上报
 *  10. 生命周期
 * [Style]  布局 + 工具按钮 + 信息面板样式
 * ─────────────────────────────────────────────────────────
 */
// =============================================================================
// 依赖导入
// =============================================================================
import { ref, reactive, onMounted, onUnmounted, watch, computed, nextTick } from "vue";
import Cesium from "@/utils/cesiumCompat";
import { ensureCesiumIonAccessToken } from "@/utils/cesiumBasemap";
// Cesium widgets.css 由 index.html 全局引入
// 【图层管理】场景初始化与图层管理
import {
  createCesiumViewer,
  destroyCesiumViewer,
  loadCityBuildingLayer,
  addSubwayVectorLayer,
  setLayerVisible,
  registerAnalysisLayer,
  removeLayer,
  finalizeSceneView,
  focusChengduView,
  isCameraNearChengdu,
  recoverSceneHealth,
  syncViewerCanvasSize,
  tuneBuildingTilesetForOverlay,
  ensureBuildingGlobeDepthSettings,
} from "@/utils/cesium";
// 地铁保护区缓冲、禁飞区、车辆风险研判
import {
  filterTargetLines,
  buildBuffer,
  evaluateVehicleRisk,
  noflyzone
} from "@/utils/safetBuffer";
// 人员/无人机/违规标记、在线脉冲环
import {
  initMarkerLayers,
  syncFleetMarkers,
  syncViolationMarkers,
  clearFleetMarkers,
  clearViolationMarkers,
  createViolationLightBeam,
  clearViolationLightBeams,
  setDronePulseVisible,
  MARKER_STATUS,
  ensureDroneOnlinePulseRings,
  getPersonnelRegistry,
  preloadDroneGltf,
} from "@/utils/mapMarkerEffects";
import {
  createMapLabelManager,
  syncFleetLabels,
  syncAirportNoFlyLabels,
} from "@/utils/mapLabelPopups";
// 无人机锥形雷达扫描特效
import {
  createDroneConeScan,
  clearDroneConeScan,
  clearAllDroneConeScans,
} from "@/utils/radarScanEffect";
import { startDetectionApi, buildDetectionPayloadFromStore } from "@/api/detection";
// Pinia 全局状态：机队、巡航、检测结果等
import datashare from '@/stores/index.js'
import { storeToRefs } from "pinia";
import { fetchWindField, fetchRainRegions } from "@/api/weather";
import { API_BASE } from "@/config";

const API = API_BASE;
// 风场 / 降雨 / 热力图 图层封装
import {
  initWindLayer,
  updateWindLayer,
  removeWindLayer,
  setWindLayerVisible,
  isWindLayerActive,
} from "@/utils/cesiumWindLayer";
import {
  updateRainEffect,
  clearRainEffect,
  isRainEffectActive,
} from "@/utils/rainEffect";
import {
  enableVolumetricCloudLayer,
  disableVolumetricCloudLayer,
  destroyVolumetricCloudLayer,
  syncCloudWindFromField,
  isVolumetricCloudActive,
} from "@/utils/cesiumVolumetricCloudLayer";
import {
  renderVehicleHeatmap,
  clearVehicleHeatmap,
  loadDangerousVehiclesJson,
  isVehicleHeatmapActive,
} from "@/utils/vehicleHeatmapLayer";
import { getSubwayLinePath } from "@/utils/subwayPathUtils";
import { createDronePatrolManager } from "@/utils/dronePatrolEngine";
import { createRoutePlannerManager, buildWindSpeedGrid } from "@/utils/cesium/routePlannerManager";
import { createViewshedManager } from "@/utils/cesium/viewshedController";
import { createSurveyMeasureManager } from "@/utils/surveyMeasureManager";
import { ROUTE_DEFAULTS, listSubwayLinesFromGeojson, normalizeNoFlyRing, AIRPORT_NO_FLY_ELLIPSES, registerHandDrawnNoFlyPolygon, getHandDrawnNoFlyPolygons, clearHandDrawnNoFlyPolygons, loadChengduSubwayRouteGeojson } from "@/utils/routeGeometry";
import EllipsoidFadeMaterialProperty from "@/utils/EllipsoidFadeMaterial";
import { ElMessage, ElMessageBox } from "element-plus";


// =============================================================================
// Pinia 状态 & 全局常量
// =============================================================================
const getdata = datashare();
const { isLoading, fleetPersonnel, fleetDrones, fleetViolations, fleetUpdatedAt, activePatrols, detections } = storeToRefs(getdata)

const reportedViolationKeys = new Set(); // 已上报违规去重，避免重复 POST

// =============================================================================
// 风场图层
// =============================================================================
const windLayerVisible = ref(true);
const windAvailable = ref(false);
const windMinKmh = ref(5);
const windMaxKmh = ref(0);
let windPollTimer = null;
let rainPollTimer = null;

// =============================================================================
// 降雨特效
// =============================================================================
const rainLayerVisible = ref(true);
const rainRegionCount = ref(0);
const rainWeatherAvailable = ref(false);
const cloudLayerVisible = ref(true);
const cloudLayerLoading = ref(false);
let cachedRainRegions = [];

const rainToggleLabel = computed(() =>
  rainLayerVisible.value ? '隐藏下雨' : '显示下雨'
);

const rainTip = computed(() => {
  if (!rainLayerVisible.value) {
    if (rainWeatherAvailable.value) {
      return `实况 ${rainRegionCount.value} 个区域有雨，点击显示`;
    }
    return '当前无实况降雨区域';
  }
  return `实况降雨 ${rainRegionCount.value} 个区域，点击关闭`;
});

/** 拉取天气降雨范围；仅按 API 实况区域渲染 */
const fetchRainWeatherRegions = async (force = false) => {
  const data = await fetchRainRegions(force);
  cachedRainRegions = data.regions || [];
  rainWeatherAvailable.value = data.display === true && cachedRainRegions.length > 0;
  if (cachedRainRegions.length) {
    rainRegionCount.value = cachedRainRegions.length;
  }
  return cachedRainRegions;
};

const applyRainRegions = async (regions) => {
  if (!viewer || !rainLayerVisible.value) return;
  rainRegionCount.value = regions.length;
  await updateRainEffect(viewer, regions);
};

const loadRainEffect = async (force = false) => {
  if (!viewer) return;
  try {
    const regions = await fetchRainWeatherRegions(force);

    if (regions.length) {
      rainLayerVisible.value = true;
      await applyRainRegions(regions);
      return;
    }

    rainRegionCount.value = 0;
    clearRainEffect(viewer);
    rainLayerVisible.value = false;
  } catch (err) {
    console.warn('降雨特效加载失败:', err);
    clearRainEffect(viewer);
    rainLayerVisible.value = false;
  }
};

/** 地图加载后拉取实况降雨范围；有雨则自动在对应区域渲染 */
const syncRainFromWeather = async (force = false) => {
  if (routeGenerating.value) return;
  try {
    const regions = await fetchRainWeatherRegions(force);
    if (!viewer) return;

    if (regions.length) {
      if (!rainLayerVisible.value) {
        rainLayerVisible.value = true;
        startRainPoll();
      }
      await applyRainRegions(regions);
      syncMapUi();
      return;
    }

    if (rainLayerVisible.value) {
      clearRainEffect(viewer);
      rainLayerVisible.value = false;
      syncMapUi();
    }
  } catch (err) {
    console.warn('降雨范围同步失败:', err);
  }
};

const toggleRainLayer = async () => {
  rainLayerVisible.value = !rainLayerVisible.value;
  syncMapUi();
  if (rainLayerVisible.value) {
    startRainPoll();
    if (isRainEffectActive()) {
      return;
    }
    if (cachedRainRegions.length) {
      await applyRainRegions(cachedRainRegions);
      return;
    }
    await loadRainEffect(true);
  } else {
    stopRainPoll();
    clearRainEffect(viewer);
  }
};

const startRainPoll = () => {
  if (rainPollTimer) return;
  rainPollTimer = setInterval(() => syncRainFromWeather(false), 5 * 60 * 1000);
};

const stopRainPoll = () => {
  if (rainPollTimer) {
    clearInterval(rainPollTimer);
    rainPollTimer = null;
  }
};

// =============================================================================
// 危险车辆 3D 热力图
// =============================================================================
const heatmapLayerVisible = ref(true);
const heatmapVehicleCount = ref(0);
const heatmapCellCount = ref(0);
 
const heatmapToggleLabel = computed(() =>
  heatmapLayerVisible.value ? '隐藏热力图' : '危险热力图'
);

const heatmapTip = computed(() => {
  if (!heatmapLayerVisible.value) {
    return '点击显示危险车辆 3D 热力图（canvas 抬升渲染）';
  }
  return `3D 热力图 · ${heatmapVehicleCount.value} 辆危险车辆`;
});

const loadVehicleHeatmap = async ({ skipFlyTo = false } = {}) => {
  if (!viewer || !heatmapLayerVisible.value) return;
  try {
    const data = await loadDangerousVehiclesJson();
    const result = await renderVehicleHeatmap(viewer, data);
    if (result) {
      heatmapVehicleCount.value = result.vehicleCount;
      heatmapCellCount.value = result.cellCount;
      if (!skipFlyTo) {
        const positions = (data.vehicles || []).map((v) =>
          Cesium.Cartesian3.fromDegrees(v.position.lng, v.position.lat)
        );
        if (positions.length) {
          const bs = Cesium.BoundingSphere.fromPoints(positions);
          viewer.camera.flyToBoundingSphere(bs, {
            duration: 1.2,
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), bs.radius * 3.5),
          });
        }
      }
    } else {
      heatmapLayerVisible.value = false;
    }
  } catch (err) {
    console.warn('危险车辆热力图加载失败:', err);
    clearVehicleHeatmap(viewer);
    heatmapLayerVisible.value = false;
  }
};

const toggleHeatmapLayer = async () => {
  heatmapLayerVisible.value = !heatmapLayerVisible.value;
  syncMapUi();
  if (heatmapLayerVisible.value) {
    if (isVehicleHeatmapActive()) return;
    await loadVehicleHeatmap();
  } else {
    clearVehicleHeatmap(viewer);
    heatmapVehicleCount.value = 0;
    heatmapCellCount.value = 0;
  }
};

// 风场轮询 & 切换逻辑
const startWindPoll = () => {
  if (windPollTimer) return;
  windPollTimer = setInterval(() => loadWindField(false), 5 * 60 * 1000);
};

const stopWindPoll = () => {
  if (windPollTimer) {
    clearInterval(windPollTimer);
    windPollTimer = null;
  }
};

const windToggleLabel = computed(() =>
  windLayerVisible.value ? '隐藏风场' : '显示风场'
);

const windTip = computed(() => {
  if (windAvailable.value) {
    return `当前最大风速 ${windMaxKmh.value} km/h，点击切换风场动画`;
  }
  return `风速低于 ${windMinKmh.value} km/h 时无风场数据，请稍后重试`;
});

/** 从天气 API 拉取风场格点数据并初始化/更新 cesium-wind 图层 */
const loadWindField = async (force = false) => {
  if (routeGenerating.value) return;
  try {
    const data = await fetchWindField(force);
    windMinKmh.value = data.min_wind_kmh ?? 5;
    windMaxKmh.value = data.max_wind_kmh ?? 0;
    windAvailable.value = data.display === true && data.field?.length > 0;
    cachedWindFieldRaw = data;

    if (isVolumetricCloudActive()) {
      syncCloudWindFromField(data);
    }

    if (!windAvailable.value || !viewer) {
      removeWindLayer();
      if (!windLayerVisible.value) return;
      windLayerVisible.value = false;
      return;
    }

    if (isWindLayerActive()) {
      updateWindLayer(data.field);
      setWindLayerVisible(windLayerVisible.value);
    } else if (windLayerVisible.value) {
      await initWindLayer(viewer, data.field);
    }
  } catch (err) {
    console.warn('风场加载失败:', err);
    windAvailable.value = false;
    removeWindLayer();
  }
};

const toggleWindLayer = () => {
  windLayerVisible.value = !windLayerVisible.value;
  syncMapUi();
  if (windLayerVisible.value) {
    startWindPoll();
    if (!windAvailable.value) {
      loadWindField(true);
      return;
    }
    if (isWindLayerActive()) {
      setWindLayerVisible(true);
    } else {
      loadWindField(true);
    }
  } else {
    stopWindPoll();
    setWindLayerVisible(false);
  }
};

const toggleCloudLayer = async () => {
  if (cloudLayerLoading.value) return;
  if (!viewer || viewer.isDestroyed?.()) {
    ElMessage.warning('地图未就绪，请稍候再试');
    return;
  }

  cloudLayerVisible.value = !cloudLayerVisible.value;
  syncMapUi();

  if (cloudLayerVisible.value) {
    cloudLayerLoading.value = true;
    try {
      await enableVolumetricCloudLayer(viewer);
      if (cachedWindFieldRaw) syncCloudWindFromField(cachedWindFieldRaw);
      ElMessage.success('成都区域体积云已开启');
    } catch (err) {
      cloudLayerVisible.value = false;
      syncMapUi();
      destroyVolumetricCloudLayer(viewer);
      console.warn('[cloud] 体积云加载失败:', err);
      ElMessage.error(`体积云加载失败：${err?.message || err}`);
    } finally {
      cloudLayerLoading.value = false;
    }
    return;
  }

  disableVolumetricCloudLayer(viewer);
};

// =============================================================================
// Cesium 核心实例 & 地图基础状态
// =============================================================================
const cesiumContainer = ref();
const minCesium = ref()
const detectionTargets = ref([]);

// Cesium Ion Token（Cesium / npm cesium 共用，见 .env VITE_CESIUM_ION_TOKEN）
ensureCesiumIonAccessToken();
// window.CESIUM_BASE_URL 由 index.html 设置为 /cesium/
const MOVEMENT_CONFIG = {
  MANUAL_SPEED: 0.6,
  RAD_PER_METER: Cesium.Math.RADIANS_PER_DEGREE / 111319,
};
let viewer = null;           // 主 Cesium Viewer 实例
let minviewer = null;        // 小地图 Viewer（已注释未启用）
let markerLayers = null;     // 人员/无人机/违规/禁飞区 等 Entity 图层集合
let mapLabelManager = null;  // HTML 浮层标签（无人机/人员/禁飞区）
let mapBridgeRegistered = false;
let markerTickListener = null;
let allDrones = [];          // 当前地图上所有无人机标记对象
let followingDrone = null;   // 相机正在跟随的无人机
let dronePickHandler = null; // 点击无人机切换跟随的鼠标事件
let patrolManager = null;    // 无人机沿地铁线路巡航引擎
/** @type {Map<string, { destroy: Function }>} */
const droneConeScans = new Map(); // 飞行中无人机的锥形雷达扫描特效
let cityTileset = null;         // 城市建筑 3D Tiles
let viewshedManager = null;     // 航点可视域分析管理器
let viewshedScanDroneId = null; // 当前环视中的无人机 ID
const buildingLayerVisible = ref(true);
const terrainLayerVisible = ref(true);
const blindZoneLayerVisible = ref(true);
const viewshedSkipDroneIds = new Set(); // 风险返航后跳过环视

// =============================================================================
// 可视域 / 建筑图层控制
// =============================================================================
const toggleBuildingLayer = () => {
  buildingLayerVisible.value = !buildingLayerVisible.value;
  syncMapUi();
  setLayerVisible('city-building', buildingLayerVisible.value);
  viewshedManager?.setBuildingsEnabled(buildingLayerVisible.value);
  getdata.patchViewshed({ buildingsEnabled: buildingLayerVisible.value });
  viewer?.scene.requestRender();
};

const toggleTerrainLayer = () => {
  terrainLayerVisible.value = !terrainLayerVisible.value;
  syncMapUi();
  if (viewer?.scene?.globe) {
    viewer.scene.globe.show = terrainLayerVisible.value;
    ensureBuildingGlobeDepthSettings(viewer);
  }
  viewshedManager?.setTerrainEnabled(terrainLayerVisible.value);
  getdata.patchViewshed({ terrainEnabled: terrainLayerVisible.value });
  viewer?.scene.requestRender();
};

const toggleBlindZoneLayer = () => {
  blindZoneLayerVisible.value = !blindZoneLayerVisible.value;
  syncMapUi();
  viewshedManager?.setBlindZoneVisible(blindZoneLayerVisible.value);
  getdata.patchViewshed({ blindZoneVisible: blindZoneLayerVisible.value });
  viewer?.scene.requestRender();
};

const handleWaypointHover = async (droneId, point, pathIndex) => {
  if (viewshedSkipDroneIds.has(droneId) || riskReturnTriggered.has(droneId)) {
    patrolManager?.resumeFromHover(droneId);
    return;
  }
  viewshedScanDroneId = droneId;
  const route = routePlanner?.getRoute();
  const wpMeta = {
    index: pathIndex,
    id: `wp-${pathIndex}`,
    lng: point.lng,
    lat: point.lat,
    height: point.height ?? route?.fixedHeight ?? routePatrolHeight.value,
  };
  getdata.patchViewshed({
    mode: 'hover_scan',
    scanning: true,
    scanProgress: 0,
    currentWaypointIndex: pathIndex,
    visibleAreaM2: 0,
    blindAreaM2: 0,
    canExport: false,
  });

  try {
    await viewshedManager?.startHoverScan(
      { lng: point.lng, lat: point.lat, height: wpMeta.height },
      wpMeta,
    );
  } catch (err) {
    console.warn('环视分析失败:', err);
  } finally {
    if (!viewshedSkipDroneIds.has(droneId)) {
      patrolManager?.resumeFromHover(droneId);
    }
    viewshedScanDroneId = null;
  }
};

const registerViewshedBridge = () => {
  getdata.registerViewshedActions({
    setPitch: (pitch) => viewshedManager?.setGimbalPitch(pitch),
    stepGimbal: () => viewshedManager?.stepGimbalManual(10),
    exportJson: () => viewshedManager?.exportBlindZoneJson(),
    setMeshPrecision: (p) => viewshedManager?.setMeshPrecision(p),
    toggleFrustumBoundsDebug: (force) => viewshedManager?.toggleFrustumBoundsDebug(force),
  });
};

/** 根据巡航位移估算飞行朝向（度） */
const flightHeadingCache = new Map();
const computeFlightHeading = (droneId) => {
  const pos = patrolManager?.getPosition(droneId);
  if (!pos) return 0;
  const prev = flightHeadingCache.get(droneId);
  if (prev) {
    const dLng = pos.lng - prev.lng;
    const dLat = pos.lat - prev.lat;
    if (Math.hypot(dLng, dLat) > 1e-7) {
      const heading = (Math.atan2(dLng, dLat) * 180) / Math.PI;
      flightHeadingCache.set(droneId, { ...pos, heading });
      return (heading + 360) % 360;
    }
    return prev.heading ?? 0;
  }
  flightHeadingCache.set(droneId, { ...pos, heading: 0 });
  return 0;
};

const DRONE_CAMERA_CONFIG = {
  FOLLOW_DISTANCE: 820,
  FOLLOW_PITCH: -62,
  FOLLOW_HEADING_OFFSET: Math.PI,
  HEADING_SMOOTH: 0.12,
};

// =============================================================================
// 环绕旋转（绕成都中心自动旋转，用户交互后停止）
// =============================================================================
/** 绕成都市中心环绕旋转 */
const CHENGDU_CENTER = { lng: 104.0667, lat: 30.6667 };
const ORBIT_CONFIG = {
  SPEED_DEG_PER_SEC: 18,
  HEIGHT_M: 50000,
  PITCH_DEG: -30,
};
const orbitActive = ref(false);
const orbitHeight = ref(ORBIT_CONFIG.HEIGHT_M);
const orbitPitch = ref(ORBIT_CONFIG.PITCH_DEG);
let orbitHeading = 0;
let orbitTransform = null;
let orbitTickListener = null;
let orbitInputHandler = null;
let orbitStartupTimer = null;
let mapResizeObserver = null;
let mapResizeDebounce = null;

/** 可拖动违规挖掘机 */
const VIOLATION_EXCAVATOR_URI =
  "/models/wajueji/053468d48d7b435d8a726385a49f111d.gltf";
let violationVehicleLayer = null;
let violationVehicleSeq = 0;
let draggingViolationEntity = null;
let violationDragHandler = null;
const simulationDemoActive = ref(false);
const SIM_SCAN_RADIUS_M = 130;
const SIM_ROUTE_PROXIMITY_M = 120;

const orbitToggleLabel = computed(() =>
  orbitActive.value ? "停止环绕" : "环绕旋转"
);

const orbitTip = computed(() => {
  if (orbitActive.value) {
    return "绕成都市中心旋转中，拖动或缩放地图将自动停止";
  }
  return `绕成都中心(${CHENGDU_CENTER.lng}, ${CHENGDU_CENTER.lat})旋转，高度 ${orbitHeight.value}m，俯仰 ${orbitPitch.value}°`;
});
// Cesium 场景时钟由 Viewer 内置，orbit/巡航等使用 viewer.clock
// =============================================================================
// 地铁线路配色 & 向父组件上报检测结果
// =============================================================================
  const SUBWAY_LINE_COLORS = {
    成都地铁1号线: { color: "#0f0f96", name: "1号线" },
    成都地铁2号线: { color: "#fe633d", name: "2号线" },
    成都地铁3号线: { color: "#d60f6b", name: "3号线" },
    成都地铁4号线: { color: "#1cad64", name: "4号线" },
    成都地铁5号线: { color: "#a03f92", name: "5号线" },
    成都地铁6号线: { color: "#be7331", name: "6号线" },
    成都地铁7号线: { color: "#65d0de", name: "7号线" },
    成都地铁8号线: { color: "#a6c215", name: "8号线" },
    成都地铁9号线: { color: "#f1ad17", name: "9号线" },
    成都地铁10号线: { color: "#0054bb", name: "10号线" },
    成都地铁17号线: { color: "#87e0aa", name: "17号线" },
    成都地铁18号线: { color: "#1a686e", name: "18号线" },
    成都地铁19号线: { color: "#94a2dc", name: "19号线" },
    };

const emit = defineEmits([
  "update-detection-result",
]);

// =============================================================================
// AI 检测结果格式化（英文车型 → 中文摘要，供右侧面板展示）
// =============================================================================
const generateDetectionSummary = (detections) => {
  if (!detections || detections.length === 0) {
    return "未检测到车辆";
  }
  const vehicleCounts = {};
  detections.forEach((detection) => {
    const vehicleType = detection.label || detection.class_name || "未知车辆";
    vehicleCounts[vehicleType] = (vehicleCounts[vehicleType] || 0) + 1;
  });

  const summaryParts = [];
  Object.entries(vehicleCounts).forEach(([type, count]) => {
    const chineseName = getVehicleChineseName(type);
    if (count === 1) {
      summaryParts.push(`${chineseName}一辆`);
    } else {
      summaryParts.push(`${chineseName}${count}辆`);
    }
  });

  return summaryParts.join("、");
};
const getVehicleChineseName = (englishName) => {
  const nameMap = {
    Excavator: "挖掘机",
    Loader: "装载机",
    Dumb_truck: "自卸车",
    Bull_dozer: "推土机",
    Grader: "平地机",
    Mobile_crane: "移动起重机",
    Roller: "压路机",
    Truck: "卡车",
    Car: "汽车",
  };
  return nameMap[englishName] || englishName;
};


/** 启动检测服务（默认仅在生成航线后调用；silent 时不弹 Toast） */
const tryStartDetection = async ({ silent = false } = {}) => {
  try {
    const payload = buildDetectionPayloadFromStore(getdata);
    await startDetectionApi(payload);
  } catch (err) {
    console.warn('[detection] 启动失败:', err.message);
    if (!silent) {
      ElMessage.warning(`检测服务未启动：${err.message}`);
    }
  }
};

// =============================================================================
// Cesium 场景初始化 & 底图加载
// =============================================================================
/** 等待地图容器获得有效尺寸后再初始化 Viewer */
async function waitForMapContainerSize(el, minWidth = 200, minHeight = 120, timeoutMs = 5000) {
  if (!el) return false
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const w = el.clientWidth || el.parentElement?.clientWidth || 0
    const h = el.clientHeight || el.parentElement?.clientHeight || 0
    if (w >= minWidth && h >= minHeight) return true
    await new Promise((r) => requestAnimationFrame(r))
  }
  const w = el.clientWidth || el.parentElement?.clientWidth || 0
  const h = el.clientHeight || el.parentElement?.clientHeight || 0
  console.warn('[map] 容器尺寸偏小:', w, 'x', h, '— 仍将尝试初始化')
  return w > 0 && h > 0
}

const forceViewerResize = () => {
  if (!viewer || viewer.isDestroyed?.()) return;
  syncViewerCanvasSize(viewer);
};

/** 修复 Cesium 下 resolutionScale / 高 DPI 导致的 canvas/输入错位 */
const fixCanvasForInteraction = () => {
  if (!viewer || viewer.isDestroyed?.()) return;
  syncViewerCanvasSize(viewer);
  requestAnimationFrame(() => syncViewerCanvasSize(viewer));
  setTimeout(() => syncViewerCanvasSize(viewer), 120);
};

/** 【三维场景】创建 Cesium.Viewer、加载影像、设置初始相机视角 */
const initCesium = async () => {
  if (!cesiumContainer.value) {
    throw new Error('[map] cesiumContainer 未就绪，无法初始化 Viewer')
  }
  const sized = await waitForMapContainerSize(cesiumContainer.value)
  if (!sized) {
    throw new Error('[map] 地图容器尺寸为 0，请检查 Dashboard 布局')
  }
  const result = await createCesiumViewer(cesiumContainer.value)
  viewer = result.viewer
  ensureBuildingGlobeDepthSettings(viewer)
  forceViewerResize()
  updateCameraInfo()
  viewer.camera.moveEnd.addEventListener(updateCameraInfo)
  console.log('Cesium 地图初始化成功, canvas:',
    viewer.scene.canvas.width, 'x', viewer.scene.canvas.height,
    'container:', cesiumContainer.value.clientWidth, 'x', cesiumContainer.value.clientHeight)
};

/** 【三维场景】加载城市白膜（3D Tiles / S3M） */
let buildingLoadPromise = null;
const loadcitymode = async () => {
  if (!viewer || viewer.isDestroyed?.()) return null;
  if (buildingLoadPromise) return buildingLoadPromise;
  buildingLoadPromise = (async () => {
    try {
      const result = await loadCityBuildingLayer(viewer);
      const { tileset, layers } = result || {};
      if (tileset || layers?.length) {
        console.log('城市白膜加载成功', tileset ? '(3D Tiles)' : '(S3M)');
        cityTileset = tileset || null;
        setLayerVisible('city-building', buildingLayerVisible.value);
        if (tileset) {
          tileset.show = buildingLayerVisible.value;
          tuneBuildingTilesetForOverlay(viewer, tileset);
          viewshedManager?.setCityTileset(tileset);
        }
        recoverSceneHealth(viewer);
        return tileset || layers?.[0] || null;
      }
      console.warn('城市白膜未加载（无 tileset / S3M layer）');
      buildingLoadPromise = null;
      return null;
    } catch (err) {
      buildingLoadPromise = null;
      console.warn('城市白膜加载失败，跳过:', err);
      return null;
    }
  })();
  return buildingLoadPromise;
};

// =============================================================================
// 地铁线路 GeoJSON 加载 & 着色
// =============================================================================
const getEntityLineName = (entity) => {
  if (typeof entity.name === "string" && entity.name) return entity.name;
  if (entity.name?.getValue) {
    const n = entity.name.getValue(Cesium.JulianDate.now());
    if (n) return String(n);
  }
  const props = entity.properties;
  const propName = props?.name?.getValue?.() ?? props?.name;
  return propName ? String(propName) : "";
};

const SUBWAY_CLAMP_GROUND = import.meta.env.VITE_SUBWAY_CLAMP_GROUND === 'true';
const MAP_AUTO_ORBIT = import.meta.env.VITE_MAP_AUTO_ORBIT !== 'false';

const applySubwayLineColors = (entities) => {
  let colored = 0;
  const terrainClass = Cesium.ClassificationType?.TERRAIN;
  for (const entity of entities) {
    if (!entity.polyline) continue;
    const name = getEntityLineName(entity);
    if (!name) continue;
    const lineKey = Object.keys(SUBWAY_LINE_COLORS).find((key) => name.includes(key));
    if (!lineKey) continue;
    const colorStr = SUBWAY_LINE_COLORS[lineKey].color;
    entity.polyline.material = Cesium.Color.fromCssColorString(colorStr);
    entity.polyline.width = 5;
    entity.polyline.clampToGround = SUBWAY_CLAMP_GROUND;
    if (SUBWAY_CLAMP_GROUND && terrainClass != null) {
      entity.polyline.classificationType = terrainClass;
    }
    colored += 1;
  }
  console.log(`地铁线路着色完成: ${colored} 条${SUBWAY_CLAMP_GROUND ? '' : '（非贴地，性能模式）'}`);
};

/** 【三维场景】加载地铁线路（矢量层优先，缓冲区延后） */
const loadSubwayLines = async () => {
  try {
    const { entities } = await addSubwayVectorLayer(viewer, {
      geojsonUrl: '/geodata/subway.geojson',
      onLoaded: ({ entities: ents }) => {
        if (ents?.length) applySubwayLineColors(ents);
      },
    });
    subwayLineEntities.value = [...(entities || [])];
    if (entities?.length) applySubwayLineColors(entities);

    for (let drone of drones.value) {
      for (let entity of entities) {
        if (entity.name && entity.name.includes(drone.subwayLine)) {
          const positions = entity.polyline.positions.getValue();
          drone.cruisePath = positions.slice();
          break;
        }
      }
    }
    console.log("地铁线路加载成功");
  } catch (error) {
    console.error("地铁线路加载失败:", error);
  }
};

/** 按需加载地铁元数据 / 显示层 / 保护区缓冲（不在启动时自动执行） */
let subwayMetaPromise = null;
let airportNoFlyLoaded = false;
let airportNoFlyScheduleTimer = null;

const scheduleAirportNoFlyZones = () => {
  if (airportNoFlyLoaded || airportNoFlyScheduleTimer) return;
  const deferMs = Number(import.meta.env.VITE_AIRPORT_NOFLY_DEFER_MS) || 2500;
  airportNoFlyScheduleTimer = setTimeout(() => {
    airportNoFlyScheduleTimer = null;
    if (!viewer || viewer.isDestroyed?.() || airportNoFlyLoaded) return;
    try {
      addAirportNoFlyZone();
      airportNoFlyLoaded = true;
      console.info('[map] 机场禁飞区已加载');
    } catch (err) {
      console.warn('[map] 机场禁飞区加载失败:', err);
    }
  }, deferMs);
};

const ensureSubwayDataForRoute = async ({
  withDisplay = true,
  withBuffers = true,
  withAirportNoFly = true,
} = {}) => {
  if (!viewer) return false;

  if (!rawSubwayGeojson) {
    if (!subwayMetaPromise) {
      subwayMetaPromise = loadChengduSubwayRouteGeojson("/geodata/subway1.geojson")
        .then((geo) => {
          rawSubwayGeojson = geo;
          const lines = listSubwayLinesFromGeojson(rawSubwayGeojson);
          if (lines.length) {
            routeLines.value = lines;
            if (routeLineIndex.value >= lines.length) routeLineIndex.value = 0;
            syncMapUi();
          }
          return geo;
        })
        .catch((err) => {
          subwayMetaPromise = null;
          throw err;
        });
    }
    await subwayMetaPromise;
  }

  if (withDisplay && !subwayLineEntities.value?.length) {
    await loadSubwayLines();
  }

  if (withBuffers && !safetyBufferOuterDs) {
    await loadSubwayExtras();
  }

  if (withAirportNoFly && !airportNoFlyLoaded) {
    addAirportNoFlyZone();
    airportNoFlyLoaded = true;
  }

  return Boolean(rawSubwayGeojson);
};

/** 地图启动后仅加载地铁线路（缓冲区与白膜错峰，避免启动 CPU/GPU 峰值叠加） */
const loadSubwayLinesOnly = async () => {
  const ok = await ensureSubwayDataForRoute({
    withDisplay: true,
    withBuffers: false,
    withAirportNoFly: false,
  });
  if (!ok) {
    console.warn('[map] 地铁数据未就绪，跳过线路渲染');
    return;
  }
  const lineCount = subwayLineEntities.value?.length ?? 0;
  console.info(`[map] 地铁线路就绪: ${lineCount} 条`);
  scheduleAirportNoFlyZones();
  viewer?.scene?.requestRender?.();
};

/** 白膜全部就绪后再加载地铁缓冲区，彻底避免 CPU/GPU 峰值叠加 */
const scheduleSubwayBuffersAfterBuildings = () => {
  const extraMs = Number(import.meta.env.VITE_BUFFER_DEFER_MS) || 3000;
  const run = () => {
    loadSubwayExtras().catch((err) => {
      console.warn('[map] 地铁缓冲区延后加载失败:', err);
    });
  };
  loadcitymode()
    .then(() => setTimeout(run, extraMs))
    .catch(() => setTimeout(run, extraMs));
};

/** 延迟加载白膜（纯 setTimeout，避免 requestIdleCallback 过早触发） */
const scheduleBuildingLoad = () => {
  const deferMs = Number(import.meta.env.VITE_BUILDING_DEFER_MS) || 5000;
  setTimeout(() => {
    scheduleSubwayBuffersAfterBuildings();
  }, deferMs);
};

/** 地图启动后加载地铁线路 + 保护区缓冲（含机场禁飞区） */
const loadSubwayLayersAndBuffers = async () => {
  const ok = await ensureSubwayDataForRoute({
    withDisplay: true,
    withBuffers: true,
    withAirportNoFly: true,
  });
  if (!ok) {
    console.warn('[map] 地铁数据未就绪，跳过线路/缓冲区渲染');
    return;
  }
  const lineCount = subwayLineEntities.value?.length ?? 0;
  const innerCount = safetyBufferInnerDs?.entities?.values?.length ?? 0;
  const outerCount = safetyBufferOuterDs?.entities?.values?.length ?? 0;
  console.info(`[map] 地铁图层就绪: 线路 ${lineCount} 条, 20m缓冲 ${innerCount} 面, 50m缓冲 ${outerCount} 面`);
  viewer?.scene?.requestRender?.();
};

/** 加载地铁保护区缓冲（20m 内圈 + 50m 外圈，同时显示） */
const loadSubwayExtras = async () => {
  try {
    if (!rawSubwayGeojson) {
      rawSubwayGeojson = await loadChengduSubwayRouteGeojson("/geodata/subway1.geojson");
      const lines = listSubwayLinesFromGeojson(rawSubwayGeojson);
      if (lines.length) {
        routeLines.value = lines;
        if (routeLineIndex.value >= lines.length) routeLineIndex.value = 0;
        syncMapUi();
      }
    }
    await renderSafetyBuffers();
    if (cityTileset && viewer) tuneBuildingTilesetForOverlay(viewer, cityTileset);
    console.log("地铁保护区缓冲区加载成功");
  } catch (err) {
    console.warn('[map] 地铁缓冲区加载失败:', err);
  }
};

// const mininitCesium = async () => {
//   if (!minCesium.value) return;
//   try {
//     minviewer = new Cesium.Viewer(minCesium.value, {
//       infoBox: false,
//       geocoder: false,
//       homeButton: false,
//       sceneModePicker: false,
//       baseLayerPicker: false,
//       navigationHelpButton: false,
//       animation: false,
//       timeline: false,
//       fullscreenButton: false,
//       requestRenderMode: true,
//       maximumRenderTimeChange: 0,
//     });
//     minviewer.cesiumWidget.creditContainer.style.display = "none";
//     minviewer.container.style.overflow = "hidden";
//     // viewer.scene.globe.depthTestAgainstTerrain = false;
//     minviewer.container.style.borderRadius = "50%";
//     if (minviewer.imageryLayers.length > 0) {
//       minviewer.imageryLayers.remove(minviewer.imageryLayers.get(0));
//     }

//     const tk = "b7176ddf328714f09afc918c08ef5a37";
//     const tdtImg = new Cesium.WebMapTileServiceImageryProvider({
//       url: `https://t{s}.tianditu.gov.cn/img_w/wmts?service=wmts&request=GetTile&version=1.0.0&LAYER=img&style=default&tileMatrixSet=w&format=tiles&TileMatrix={TileMatrix}&TileRow={TileRow}&TileCol={TileCol}&tk=${tk}`,
//       layer: "img",
//       style: "default",
//       format: "tiles",
//       tileMatrixSetID: "w",
//       subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
//       maximumLevel: 18
//     });
//     minviewer.imageryLayers.addImageryProvider(tdtImg);
//     minviewer.camera.setView({
//       destination: Cesium.Cartesian3.fromDegrees(104.0668, 30.5728, 1500),
//       orientation: {
//         heading: Cesium.Math.toRadians(0),
//         pitch: Cesium.Math.toRadians(-45),
//         roll: 0,
//       },
//     });
//   } catch (err) {
//     console.error("小地图-------------------------------------------------", err);
//   }
// }






// =============================================================================
// 地铁保护区安全缓冲区（20m / 50m 渐变闪烁多边形）
// =============================================================================
let rawSubwayGeojson = null;
let targetLineFc = null;
let safetyBufferGeojson = null;
let safetyBufferInnerDs = null;
let safetyBufferOuterDs = null;
let oneBuffercolor1 = Cesium.Color.RED.withAlpha(0.9);
let oneBuffercolor2 = Cesium.Color.RED.withAlpha(0.3);
let twoBuffercolor1 = Cesium.Color.BLUE.withAlpha(0.8);
let twoBuffercolor2 = Cesium.Color.BLUE.withAlpha(0.25);
let removeBlinkEventListener = null;

const SUBWAY_LINE_FILTER = [
  "成都地铁10号线", "成都地铁17号线", "成都地铁2号线", "成都地铁19号线",
  "成都地铁1号线", "成都地铁3号线", "成都地铁4号线", "成都地铁5号线",
  "成都地铁6号线", "成都地铁7号线", "成都地铁8号线", "成都地铁9号线",
  "成都地铁18号线",
];

function applyBufferColorsToDataSource(dataSource, strokeColor, fillColor) {
  const terrainClass = Cesium.ClassificationType?.TERRAIN
  const entities = dataSource?.entities?.values || [];
  for (const entity of entities) {
    if (entity.polygon) {
      entity.polygon.material = fillColor;
      entity.polygon.clampToGround = true;
      entity.polygon.outline = false;
      // 仅贴地形/椭球，不贴 3D Tiles（BOTH 会把白膜压住；undefined 则放大后 depth plane 闪烁缺块）
      if (terrainClass != null) {
        entity.polygon.classificationType = terrainClass;
      }
      entity.polygon.perPositionHeight = false;
      if (entity.polygon.height !== undefined) entity.polygon.height = undefined;
    }
    if (entity.polyline) {
      entity.polyline.material = strokeColor;
      entity.polyline.width = 2;
      entity.polyline.clampToGround = true;
      if (terrainClass != null) {
        entity.polyline.classificationType = terrainClass;
      }
    }
  }
}

function registerBufferLayer(id, dataSource, name) {
  if (!dataSource) return;
  registerAnalysisLayer(id, dataSource, name);
}

/** 同时渲染 20m（红）与 50m（蓝）双层保护区 */
const renderSafetyBuffers = async () => {
  if (!viewer || !rawSubwayGeojson) return;
  if (removeBlinkEventListener) {
    clearInterval(removeBlinkEventListener);
    removeBlinkEventListener = null;
  }

  targetLineFc = filterTargetLines(rawSubwayGeojson, SUBWAY_LINE_FILTER);
  if (!targetLineFc?.features?.length) {
    console.warn('[map] 未匹配到地铁线路，跳过缓冲区渲染');
    return;
  }

  const geo20 = buildBuffer(targetLineFc, 20);
  const geo50 = buildBuffer(targetLineFc, 50);
  safetyBufferGeojson = geo50;

  // 先加载外层 50m，再加载内层 20m，保证红区盖在蓝区之上
  if (safetyBufferOuterDs) {
    viewer.dataSources.remove(safetyBufferOuterDs, true);
    safetyBufferOuterDs = null;
  }
  safetyBufferOuterDs = await Cesium.GeoJsonDataSource.load(geo50, {
    stroke: twoBuffercolor1,
    fill: twoBuffercolor2,
    strokeWidth: 0,
    clampToGround: true,
  });
  viewer.dataSources.add(safetyBufferOuterDs);
  applyBufferColorsToDataSource(safetyBufferOuterDs, twoBuffercolor1, twoBuffercolor2);
  registerBufferLayer('subway-buffer-50m', safetyBufferOuterDs, '地铁保护区 50m');

  if (safetyBufferInnerDs) {
    viewer.dataSources.remove(safetyBufferInnerDs, true);
    safetyBufferInnerDs = null;
  }
  safetyBufferInnerDs = await Cesium.GeoJsonDataSource.load(geo20, {
    stroke: oneBuffercolor1,
    fill: oneBuffercolor2,
    strokeWidth: 0,
    clampToGround: true,
  });
  viewer.dataSources.add(safetyBufferInnerDs);
  applyBufferColorsToDataSource(safetyBufferInnerDs, oneBuffercolor1, oneBuffercolor2);
  registerBufferLayer('subway-buffer-20m', safetyBufferInnerDs, '地铁保护区 20m');
};

/** @deprecated 请使用 renderSafetyBuffers */
const buildAndRenderSafetyBuffer = async (buffer_width, buffer_color1, buffer_color2) => {
  if (!viewer || !rawSubwayGeojson) return;
  targetLineFc = filterTargetLines(rawSubwayGeojson, SUBWAY_LINE_FILTER);
  safetyBufferGeojson = buildBuffer(targetLineFc, buffer_width);
  const ds = await Cesium.GeoJsonDataSource.load(safetyBufferGeojson, {
    stroke: buffer_color1,
    fill: buffer_color2,
    strokeWidth: 2,
    clampToGround: false,
  });
  viewer.dataSources.add(ds);
  applyBufferColorsToDataSource(ds, buffer_color1, buffer_color2);
};

// =============================================================================
// 用户手绘禁飞区（点击取点 → 自动闭合 → 调用 noflyzone 渲染）
// =============================================================================
const zone = ref([]);
let handler = null;
let drawstatus = false;
const startDraw = () => {
  if (!viewer) return;
  ensureMinimalMarkerLayers();
  if (surveyMeasureManager && activeSurveyTool.value) {
    surveyMeasureManager.activateTool('none');
    activeSurveyTool.value = '';
    syncMapUi();
  }
  if (handler) {
    handler.destroy();
    handler = null;
  }
  zone.value = [];
  getdata.patchMapUi({ nofly: { drawing: true } });
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    const ray = viewer.camera.getPickRay(movement.position)
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene)
    if (!cartesian) return
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
    const lng = Cesium.Math.toDegrees(cartographic.longitude)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    zone.value.push([lng, lat])
    // drawstatus = false;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

}

const stopDraw = () => {
  if (handler) {
    handler.destroy();
    handler = null;
  }
  getdata.patchMapUi({ nofly: { drawing: false } });
  if (zone.value.length >= 3) {
    if (timer) clearTimeout(timer);
    timer = null;
    commitNoFlyPolygon([...zone.value]);
  }
}


let timer = null;

/** 提交手绘禁飞多边形并触发航线重校验 */
const commitNoFlyPolygon = async (points) => {
  if (!viewer || !markerLayers || !points?.length) return;
  if (points.length < 3) return;

  const closed = points.map((p) => [Number(p[0]), Number(p[1])]);
  const [f0, f1] = closed[0];
  const [l0, l1] = closed[closed.length - 1];
  if (Math.abs(f0 - l0) > 1e-8 || Math.abs(f1 - l1) > 1e-8) {
    closed.push([f0, f1]);
  }

  const polyCoords = normalizeNoFlyRing(closed);
  if (polyCoords.length < 3) return;

  markerLayers.ensureNoflyLayerOnTop();
  await noflyzone(closed, Cesium, markerLayers.noflyLayer);
  const saved = registerHandDrawnNoFlyPolygon(closed);
  if (saved) drawnNoFlyPolygons.push(saved);
  zone.value = [];

  await revalidateExistingRouteIfAny();
};

/** 生成航线前：立即提交尚未入库的手绘禁飞区 */
const flushPendingNoFlyDraw = async () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (zone.value.length >= 3) {
    await commitNoFlyPolygon([...zone.value]);
  }
};

const revalidateExistingRouteIfAny = async () => {
  if (!routePlanner?.getRoute()) return;
  try {
    const { windGrid, rainRegions } = await getRouteWeatherContext();
    const route = routePlanner.revalidateAllRisks({
      noFlyZones: collectNoFlyZones(),
      windGrid,
      rainRegions,
      weatherThresholds,
    });
    if (!route) return;
    updateRouteStats(route);
    await syncRouteToServer(route);
    viewer?.scene.requestRender();
    if (route.hasRisk) {
      ElMessage.warning(`航线已更新：${route.riskWaypoints.length} 个风险航点（含禁飞区）`);
    }
  } catch (err) {
    console.warn('航线禁飞重校验失败:', err);
  }
};

watch(
  zone,
  (newval) => {
    if (newval.length >= 3) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        commitNoFlyPolygon([...newval]);
      }, 800);
    }
  },
  { deep: true }
)

const clearNoFlyZones = async () => {
  stopDraw();
  zone.value = [];
  clearHandDrawnNoFlyPolygons();
  drawnNoFlyPolygons.length = 0;
  if (markerLayers?.noflyLayer) {
    markerLayers.noflyLayer.entities.removeAll();
  }
  await revalidateExistingRouteIfAny();
  ElMessage.info('手绘禁飞区已清空');
};

const startDrawNoFly = () => startDraw();
const stopDrawNoFly = () => stopDraw();

// =============================================================================
// 地铁巡检航线自动生成（Web Worker + 空域/气象校验）
// =============================================================================
const MIN_ROUTE_INTERVAL = ROUTE_DEFAULTS.MIN_INTERVAL_M;
const ROUTE_FIXED_PITCH = ROUTE_DEFAULTS.FIXED_PITCH;
const routeLines = ref(['1号线保护区', '2号线保护区', '3号线保护区', '19号线保护区']);
const routeLineIndex = ref(0);
const routeIntervalM = ref(50);
const routePatrolHeight = ref(ROUTE_DEFAULTS.FIXED_HEIGHT);
const activeSurveyTool = ref('');
const surveyStats = reactive({
  distanceTotalM: 0,
  areaPlaneM2: 0,
  areaSurfaceM2: 0,
  elevationCount: 0,
});
let surveyMeasureManager = null;

const syncMapUi = () => {
  getdata.patchMapUi({
    layers: {
      wind: windLayerVisible.value,
      rain: rainLayerVisible.value,
      cloud: cloudLayerVisible.value,
      heatmap: heatmapLayerVisible.value,
      route: routeLayerVisible.value,
      building: buildingLayerVisible.value,
      terrain: terrainLayerVisible.value,
      blindZone: blindZoneLayerVisible.value,
      orbit: orbitActive.value,
    },
    orbit: {
      heightM: orbitHeight.value,
      pitchDeg: orbitPitch.value,
    },
    route: {
      lineIndex: routeLineIndex.value,
      lines: routeLines.value,
      intervalM: routeIntervalM.value,
      patrolHeight: routePatrolHeight.value,
      editMode: routeEditMode.value,
      generating: routeGenerating.value,
      stats: { ...routeStats },
    },
    survey: {
      activeTool: activeSurveyTool.value,
      distanceTotalM: surveyStats.distanceTotalM,
      areaPlaneM2: surveyStats.areaPlaneM2,
      areaSurfaceM2: surveyStats.areaSurfaceM2,
      elevationCount: surveyStats.elevationCount,
    },
    nofly: { drawing: !!handler },
    simulation: {
      active: simulationDemoActive.value,
      placedCount: violationVehicleSeq,
    },
  });
};

const toggleSurveyTool = (tool) => {
  if (!ensureSurveyMeasureManager()) {
    ElMessage.warning('测绘模块未就绪，请稍候再试');
    return;
  }
  if (activeSurveyTool.value === tool) {
    surveyMeasureManager.activateTool('none');
    activeSurveyTool.value = '';
    syncMapUi();
    return;
  }
  if (handler) {
    handler.destroy();
    handler = null;
    getdata.patchMapUi({ nofly: { drawing: false } });
  }
  surveyMeasureManager.activateTool(tool);
  activeSurveyTool.value = tool;
  syncMapUi();
};

const clearSurveyMeasure = () => {
  surveyMeasureManager?.clearCurrent();
  surveyStats.distanceTotalM = 0;
  surveyStats.areaPlaneM2 = 0;
  surveyStats.areaSurfaceM2 = 0;
  surveyStats.elevationCount = 0;
  syncMapUi();
  viewer?.scene.requestRender();
};

const clearAllSurveyMeasure = () => {
  surveyMeasureManager?.clearAll();
  activeSurveyTool.value = '';
  surveyMeasureManager?.activateTool('none');
  surveyStats.distanceTotalM = 0;
  surveyStats.areaPlaneM2 = 0;
  surveyStats.areaSurfaceM2 = 0;
  surveyStats.elevationCount = 0;
  syncMapUi();
};

const setRouteLineIndex = (index) => {
  routeLineIndex.value = index;
  syncMapUi();
};

const setRouteIntervalM = (m) => {
  routeIntervalM.value = m;
  syncMapUi();
};

const setRoutePatrolHeight = (h) => {
  routePatrolHeight.value = h;
  routePlanner?.setFixedHeight?.(h);
  syncMapUi();
};

const setOrbitHeight = (heightM) => {
  const next = Number(heightM);
  orbitHeight.value = Number.isFinite(next)
    ? Math.min(50000, Math.max(500, next))
    : ORBIT_CONFIG.HEIGHT_M;
  syncMapUi();
};

const setOrbitPitch = (pitchDeg) => {
  const next = Number(pitchDeg);
  orbitPitch.value = Number.isFinite(next)
    ? Math.min(-5, Math.max(-89, next))
    : ORBIT_CONFIG.PITCH_DEG;
  syncMapUi();
};

const getDemoRainRegions = () => [{
  min_lng: CHENGDU_CENTER.lng - 0.03,
  max_lng: CHENGDU_CENTER.lng + 0.03,
  min_lat: CHENGDU_CENTER.lat - 0.03,
  max_lat: CHENGDU_CENTER.lat + 0.03,
  center_lng: CHENGDU_CENTER.lng,
  center_lat: CHENGDU_CENTER.lat,
  intensity: 0.8,
  weather_text: '演示降雨',
  precipitation: '0.5',
}];

const loadRainOnStartup = async () => {
  if (!viewer || !rainLayerVisible.value) return;
  startRainPoll();
  try {
    const regions = await fetchRainWeatherRegions(true);
    if (regions.length) {
      await applyRainRegions(regions);
      return;
    }
  } catch (err) {
    console.warn('降雨实况不可用，使用演示区域:', err);
  }
  const demoRegions = getDemoRainRegions();
  cachedRainRegions = demoRegions;
  rainWeatherAvailable.value = true;
  rainRegionCount.value = demoRegions.length;
  rainLayerVisible.value = true;
  await applyRainRegions(demoRegions);
};

const initStartupLayers = async () => {
  if (!viewer || viewer.isDestroyed?.()) return;

  orbitHeight.value = ORBIT_CONFIG.HEIGHT_M;
  orbitPitch.value = ORBIT_CONFIG.PITCH_DEG;

  const tasks = [];
  if (windLayerVisible.value) {
    startWindPoll();
    tasks.push(loadWindField(true));
  }
  if (rainLayerVisible.value) {
    tasks.push(loadRainOnStartup());
  }
  if (heatmapLayerVisible.value && !isVehicleHeatmapActive()) {
    tasks.push(loadVehicleHeatmap({ skipFlyTo: true }));
  }
  if (cloudLayerVisible.value && !isVolumetricCloudActive()) {
    tasks.push((async () => {
      cloudLayerLoading.value = true;
      try {
        await enableVolumetricCloudLayer(viewer);
      } catch (err) {
        console.warn('[cloud] 启动体积云失败:', err);
        cloudLayerVisible.value = false;
      } finally {
        cloudLayerLoading.value = false;
      }
    })());
  }

  await Promise.allSettled(tasks);

  if (isVolumetricCloudActive() && cachedWindFieldRaw) {
    syncCloudWindFromField(cachedWindFieldRaw);
  }

  if (MAP_AUTO_ORBIT) {
    clearTimeout(orbitStartupTimer);
    orbitStartupTimer = setTimeout(() => {
      orbitStartupTimer = null;
      if (!viewer || viewer.isDestroyed?.()) return;
      if (orbitActive.value || routePlanner?.getRoute?.()) return;
      startOrbitRotation();
    }, 800);
  }

  syncMapUi();
};

const exportBlindJsonFromMap = async () => {
  try {
    const jsonStr = await viewshedManager?.exportBlindZoneJson?.();
    if (!jsonStr) {
      ElMessage.warning('暂无可导出数据');
      return;
    }
    const record = JSON.parse(jsonStr);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `viewshed_wp${record.waypointIndex ?? 0}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await fetch(`${API}/api/fleet/viewshed/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    });
    getdata.addViewshedRecord(record);
    ElMessage.success('盲区 JSON 已下载并同步存档');
  } catch (err) {
    ElMessage.error(err.message || '导出失败');
  }
};

const registerMapBridge = () => {
  /** 航线 / 可视域 — 同步初始化重型模块，机队标记仍延迟加载 */
  const withHeavyManagers = (fn) => (...args) => {
    ensureMinimalMarkerLayers();
    if (!ensureHeavyMapManagers()) {
      ElMessage.warning('地图模块正在初始化，请稍候再试');
      return;
    }
    scheduleFleetMarkersLoad();
    return fn(...args);
  };
  /** 测绘 — 仅初始化测量工具 */
  const withSurvey = (fn) => (...args) => {
    if (!ensureSurveyMeasureManager()) {
      ElMessage.warning('测绘模块未就绪');
      return;
    }
    return fn(...args);
  };
  /** 禁飞区 — 仅创建空 DataSource */
  const withNoflyLayer = (fn) => (...args) => {
    ensureMinimalMarkerLayers();
    return fn(...args);
  };

  getdata.registerMapActions({
    ensureMapMarkersLoaded: scheduleFleetMarkersLoad,
    toggleWindLayer,
    toggleRainLayer,
    toggleCloudLayer,
    toggleHeatmapLayer,
    toggleRouteLayer: withHeavyManagers(toggleRouteLayer),
    toggleBuildingLayer,
    toggleTerrainLayer,
    toggleBlindZoneLayer: withHeavyManagers(toggleBlindZoneLayer),
    toggleOrbitRotation,
    setOrbitHeight,
    setOrbitPitch,
    setRouteLineIndex,
    setRouteIntervalM,
    setRoutePatrolHeight,
    generatePatrolRoute: withHeavyManagers(generatePatrolRoute),
    toggleRouteEditMode: withHeavyManagers(toggleRouteEditMode),
    clearPatrolRoute: withHeavyManagers(clearPatrolRoute),
    exportPatrolRoute: withHeavyManagers(exportPatrolRoute),
    toggleSurveyTool: withSurvey(toggleSurveyTool),
    clearAllSurveyMeasure: withSurvey(clearAllSurveyMeasure),
    startDrawNoFly: withNoflyLayer(startDrawNoFly),
    stopDrawNoFly: withNoflyLayer(stopDrawNoFly),
    clearNoFlyZones: withNoflyLayer(clearNoFlyZones),
    exportBlindJson: withHeavyManagers(exportBlindJsonFromMap),
    addViolationExcavator,
    startSimulationDemo,
  });
  syncMapUi();
};

// =============================================================================
// 地铁巡检航线（续）
// =============================================================================
const routeGenerating = ref(false);
const routeEditMode = ref(false);
const routeLayerVisible = ref(true);
const routeStats = reactive({ total: 0, risk: 0, normal: 0 });
const drawnNoFlyPolygons = [];
let routePlanner = null;
let routeEditHandler = null;
let cachedWindFieldRaw = null;
const weatherThresholds = {
  windDangerKmh: 36,
  windCautionKmh: 25,
  precipDanger: 10,
  precipCaution: 2,
};
const riskReturnTriggered = new Set();
const riskCheckLastAt = new Map();

const yieldToMain = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => resolve());
  } else {
    setTimeout(resolve, 0);
  }
});

/** 恢复地图拖拽/缩放（生成航线、环绕、拖拽异常后调用） */
const ensureMapCameraInteractive = () => {
  if (!viewer || viewer.isDestroyed?.()) return;
  clearTimeout(orbitStartupTimer);
  orbitStartupTimer = null;
  stopOrbitRotation();
  stopDroneCameraFollow();
  draggingViolationEntity = null;
  try {
    viewer.camera.cancelFlight?.();
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch {
    /* ignore */
  }
  const ctrl = viewer.scene?.screenSpaceCameraController;
  if (ctrl) {
    ctrl.enableInputs = true;
    ctrl.enableRotate = true;
    ctrl.enableTranslate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;
    ctrl.enableLook = true;
  }
  fixCanvasForInteraction();
  recoverSceneHealth(viewer);
};

const getRouteWeatherContext = async () => {
  if (!cachedWindFieldRaw) {
    try {
      cachedWindFieldRaw = await Promise.race([
        fetchWindField(true),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('风场请求超时')), 4000)
        }),
      ])
    } catch (err) {
      console.warn('[route] 风场不可用，跳过风场风险校验:', err?.message || err)
    }
  }
  const windGrid = buildWindSpeedGrid(cachedWindFieldRaw)

  const rainRegions = [];
  const seen = new Set();
  const addRain = (r) => {
    const key = `${r.min_lng}_${r.max_lng}_${r.min_lat}_${r.max_lat}`;
    if (!seen.has(key)) {
      seen.add(key);
      rainRegions.push(r);
    }
  };
  for (const r of cachedRainRegions) addRain(r);
  return { windGrid, rainRegions };
};

const collectNoFlyPolygons = () => {
  const polys = [];
  const seen = new Set();

  const addPoly = (raw) => {
    const ring = normalizeNoFlyRing(raw);
    if (ring.length < 3) return;
    const key = ring.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    polys.push(ring);
  };

  for (const p of getHandDrawnNoFlyPolygons()) addPoly(p);
  for (const p of drawnNoFlyPolygons) addPoly(p);
  return polys;
};

const collectNoFlyZones = () => ({
  polygons: collectNoFlyPolygons(),
  ellipses: AIRPORT_NO_FLY_ELLIPSES,
});

const syncRouteToServer = async (route) => {
  if (!route) return;
  try {
    const res = await fetch(`${API}/api/fleet/route/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line: route.lineText,
        intervalM: route.intervalM,
        fixedHeight: routePatrolHeight.value,
        fixedPitch: ROUTE_FIXED_PITCH,
        waypoints: route.waypoints,
        riskWaypoints: route.riskWaypoints,
        hasRisk: route.hasRisk,
        stats: route.stats,
      }),
    });
    const json = await res.json();
    if (json.success) {
      getdata.setRoutePlan(json.data);
    }
  } catch (err) {
    console.warn('航线上传失败:', err);
  }
};

const updateRouteStats = (route) => {
  if (!route) {
    routeStats.total = 0;
    routeStats.risk = 0;
    routeStats.normal = 0;
    syncMapUi();
    return;
  }
  routeStats.total = route.stats?.total ?? (route.waypoints.length + route.riskWaypoints.length);
  routeStats.risk = route.riskWaypoints?.length ?? 0;
  routeStats.normal = route.waypoints?.length ?? 0;
  syncMapUi();
};

const generatePatrolRoute = async () => {
  if (!ensureHeavyMapManagers()) {
    ElMessage.error('地图或航线模块未就绪');
    return;
  }
  try {
    const ready = await ensureSubwayDataForRoute({
      withDisplay: false,
      withBuffers: false,
      withAirportNoFly: false,
    });
    if (!ready) {
      ElMessage.error('地铁线路数据未就绪，请稍候再试');
      return;
    }
  } catch (err) {
    ElMessage.error(`地铁数据加载失败：${err.message || err}`);
    return;
  }
  const interval = Number(routeIntervalM.value);
  if (!interval || interval < MIN_ROUTE_INTERVAL) {
    ElMessage.warning(`航点间隔不能小于 ${MIN_ROUTE_INTERVAL} 米`);
    return;
  }
  clearAllSurveyMeasure();
  viewshedManager?.resetAllFrustums?.();
  clearTimeout(orbitStartupTimer);
  orbitStartupTimer = null;
  stopOrbitRotation();
  routeGenerating.value = true;
  mapLabelManager?.pause();
  syncMapUi();
  try {
    await flushPendingNoFlyDraw();
    await yieldToMain();
    const { windGrid, rainRegions } = await getRouteWeatherContext();
    const lineText = routeLines.value[routeLineIndex.value];
    const route = await routePlanner.generateRoute({
      geojson: rawSubwayGeojson,
      lineText,
      intervalM: interval,
      noFlyZones: collectNoFlyZones(),
      windGrid,
      rainRegions,
      weatherThresholds,
    });
    updateRouteStats(route);
    routeLayerVisible.value = true;
    routePlanner.setVisible(true);
    void syncRouteToServer(route).catch((err) => {
      console.warn('[route] 航线上传失败:', err);
    });
    void tryStartDetection({ silent: true });
    if (route.hasRisk) {
      ElMessageBox.alert(
        `「${lineText}」检测到 ${route.riskWaypoints.length} 个风险航点。小程序端仍可启动，进入风险区后无人机将原路返航。`,
        '航线风险提醒',
        { type: 'warning' },
      );
    } else {
      ElMessage.success(`航线生成成功，共 ${route.stats.total} 个航点`);
    }
  } catch (err) {
    ElMessageBox.alert(err.message || '航线生成失败', '计算异常', { type: 'error' });
  } finally {
    routeGenerating.value = false;
    stopOrbitRotation();
    try {
      mapLabelManager?.resume();
    } catch (err) {
      console.warn('[route] 标签恢复失败:', err?.message || err);
    }
    ensureMapCameraInteractive();
    syncMapUi();
  }
};

const clearPatrolRoute = async () => {
  clearAllSurveyMeasure();
  viewshedManager?.resetAllFrustums?.();
  routePlanner?.clearRoute();
  updateRouteStats(null);
  riskReturnTriggered.clear();
  ensureMapCameraInteractive();
  try {
    const lineText = routeLines.value[routeLineIndex.value];
    const qs = lineText ? `?line=${encodeURIComponent(lineText)}` : '';
    await fetch(`${API}/api/fleet/route/plan${qs}`, { method: 'DELETE' });
    getdata.setRoutePlan(null);
  } catch (err) {
    console.warn('航线清空同步失败:', err);
  }
  ElMessage.info('航线已清空');
};

const exportPatrolRoute = () => {
  const json = routePlanner?.exportJson();
  if (!json) {
    ElMessage.warning('暂无航线可导出');
    return;
  }
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patrol-route-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success('航线 JSON 已导出');
};

const toggleRouteLayer = () => {
  routeLayerVisible.value = !routeLayerVisible.value;
  routePlanner?.setVisible(routeLayerVisible.value);
  syncMapUi();
};

const teardownRouteEditHandler = () => {
  if (routeEditHandler) {
    routeEditHandler.destroy();
    routeEditHandler = null;
  }
};

const setupRouteEditHandler = () => {
  teardownRouteEditHandler();
  if (!viewer || !routeEditMode.value) return;
  routeEditHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  routeEditHandler.setInputAction(async (movement) => {
    const picked = viewer.scene.pick(movement.position);
    if (picked?.id?.properties) {
      const isWp = picked.id.properties.routeWaypoint?.getValue?.()
        ?? picked.id.properties.routeWaypoint;
      if (isWp) {
        routePlanner.removeWaypoint(picked.id);
        const route = routePlanner.getRoute();
        updateRouteStats(route);
        await syncRouteToServer(route);
        return;
      }
    }
    const ray = viewer.camera.getPickRay(movement.position);
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    const lng = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const { windGrid, rainRegions } = await getRouteWeatherContext();
    routePlanner.insertWaypointOnTrack(lng, lat, collectNoFlyZones(), windGrid, rainRegions, weatherThresholds);
    const route = routePlanner.getRoute();
    updateRouteStats(route);
    await syncRouteToServer(route);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
};

const toggleRouteEditMode = () => {
  routeEditMode.value = !routeEditMode.value;
  syncMapUi();
  if (routeEditMode.value) {
    setupRouteEditHandler();
    void routePlanner?.showRoutePoints?.(true);
    ElMessage.info('编辑模式：点击轨道新增航点，点击球体删除');
  } else {
    teardownRouteEditHandler();
    void routePlanner?.showRoutePoints?.(false);
  }
};

const handleInFlightRisk = async (droneId, pos) => {
  if (!pos || riskReturnTriggered.has(droneId)) return;
  const now = Date.now();
  const last = riskCheckLastAt.get(droneId) || 0;
  if (now - last < 2000) return;
  riskCheckLastAt.set(droneId, now);
  const { windGrid, rainRegions } = await getRouteWeatherContext();
  const { isRisk, reasons } = routePlanner?.checkPointRisk(
    pos.lng, pos.lat, collectNoFlyZones(), windGrid, rainRegions, weatherThresholds,
  ) ?? { isRisk: false, reasons: [] };
  if (!isRisk) return;
  riskReturnTriggered.add(droneId);
  viewshedSkipDroneIds.add(droneId);
  viewshedManager?.cancelScan();
  patrolManager?.forceReturn(droneId);
  try {
    await fetch(`${API}/api/fleet/patrol/risk-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        droneId,
        lng: pos.lng,
        lat: pos.lat,
        reasons,
        message: `无人机驶入风险区域（${reasons.join('、')}），强制返航`,
      }),
    });
  } catch (err) {
    console.warn('风险告警推送失败:', err);
  }
  ElMessageBox.alert(
    `检测到飞行风险：${reasons.join('、')}，无人机已强制返航`,
    '巡航风险',
    { type: 'error' },
  );
};

// =============================================================================
// 机场禁飞区（双流 / 天府，中心向外扩散填充 — 与示例 EllipsoidFade 一致）
// =============================================================================
const AIRPORT_NOFLY_FADE_MS = 3000;
const STATIC_AIRPORT_NOFLY_MATERIAL = Cesium.Color.RED.withAlpha(0.35);

/** 暂停/恢复机场禁飞区扩散动画（航线生成后暂停以减轻 GPU 压力） */
function setAirportNoFlyAnimating(animating) {
  if (!viewer || viewer.isDestroyed?.()) return;
  const layer = markerLayers?.airportNoflyLayer;
  if (!layer) return;
  for (const entity of layer.entities.values) {
    if (!entity.ellipse) continue;
    entity.ellipse.material = animating
      ? new EllipsoidFadeMaterialProperty(Cesium.Color.RED, AIRPORT_NOFLY_FADE_MS)
      : STATIC_AIRPORT_NOFLY_MATERIAL;
  }
  viewer.scene.requestRender();
}

function addAirportNoFlyZone() {
  if (!viewer || viewer.isDestroyed?.()) return;

  ensureMinimalMarkerLayers();
  const layer = markerLayers?.airportNoflyLayer;
  if (!layer) return;

  for (const legacyId of ['shuangLiu', 'tianFu']) {
    try {
      viewer.entities.removeById(legacyId);
    } catch {
      /* ignore */
    }
  }

  AIRPORT_NO_FLY_ELLIPSES.forEach((zone, index) => {
    const id = `airport_nofly_${index}`;
    const existing = layer.entities.getById(id);
    if (existing) layer.entities.remove(existing);

    const radiusM = zone.radiusM ?? 5000;
    layer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(zone.lng, zone.lat, 0),
      ellipse: {
        height: 100,
        semiMinorAxis: radiusM,
        semiMajorAxis: radiusM,
        // 3000 为毫秒，控制扩散速度（与示例一致）
        material: new EllipsoidFadeMaterialProperty(Cesium.Color.RED, AIRPORT_NOFLY_FADE_MS),
      },
    });
  });

  if (mapLabelManager) {
    syncAirportNoFlyLabels(mapLabelManager);
  }

  recoverSceneHealth(viewer);
  viewer.scene.requestRender();
}


// =============================================================================
// 本地无人机配置（历史遗留，实际数据来自 Pinia fleetDrones）
// =============================================================================
const createDrone = (
  subwayLine,
) => ({
  subwayLine,
  cruisePath: [],
  updatePositionListener: null,
  cameraUpdateListener: null,
});

const drones = ref([
  createDrone("drone1", "无人机1号", "成都地铁19号线", "#ff4444", 50),
  createDrone("drone2", "无人机2号", "成都地铁2号线", "#44ff44", 50),
  createDrone("drone3", "无人机3号", "成都地铁1号线", "#4444ff", 100),
]);



// =============================================================================
// 右侧面板检测结果状态 & 相机视角信息
// =============================================================================
const rightPanelDetectionResult = reactive({
  droneName: "",
  location: "N/A",
  time: "N/A",
  avgConfidence: 0,
  detectedObjectsCount: 0,
  detectedVehicles: [],
  detectionSummary: "",
});


// 地铁标注控制（addSubwayLineLabels 已停用）
const showSubwayLines = ref(true);
const subwayLineEntities = ref([]);

const currentView = reactive({
  longitude: 104.0668,
  latitude: 30.5728,
  height: 1500,
  zoom: 15,
});



// 监听 detectionTargets → 汇总置信度/车型 → emit 给父组件
watch(
  detectionTargets,
  (newTargets) => {
    if (newTargets.length > 0) {
      const totalConfidence = newTargets.reduce(
        (sum, target) => sum + target.confidence,
        0
      );
      const avgConfidence = (
        (totalConfidence / newTargets.length) *
        100
      ).toFixed(1);

      // 生成检测摘要
      const detectionSummary = generateDetectionSummary(newTargets);

      // 处理检测到的车辆信息
      const detectedVehicles = newTargets.map((target) => ({
        type: target.label || target.class_name || "未知车辆",
        chineseName: getVehicleChineseName(
          target.label || target.class_name || "未知车辆"
        ),
        confidence: (target.confidence * 100).toFixed(1),
        bbox: target.bbox || null,
      }));

      Object.assign(rightPanelDetectionResult, {
        avgConfidence: parseFloat(avgConfidence),
        detectedObjectsCount: newTargets.length,
        time: new Date().toLocaleTimeString(), // 更新时间
        detectedVehicles: detectedVehicles,
        detectionSummary: detectionSummary,
      });

    } else {
      // 如果没有检测目标，重置置信度和数量
      Object.assign(rightPanelDetectionResult, {
        avgConfidence: 0,
        detectedObjectsCount: 0,
        time: new Date().toLocaleTimeString(),
        detectedVehicles: [],
        detectionSummary: "未检测到车辆",
      });
    }
    emit("update-detection-result", rightPanelDetectionResult);
  },
  { deep: true }
);



// const addSubwayLineLabels = (entities) => { ... }  // 地铁线路文字标注（已停用）




// =============================================================================
// 相机信息面板 & 环绕旋转控制
// =============================================================================
const updateCameraInfo = () => {
  if (viewer) {
    const position = viewer.camera.positionCartographic;
    currentView.longitude = Cesium.Math.toDegrees(position.longitude);
    currentView.latitude = Cesium.Math.toDegrees(position.latitude);
    currentView.height = position.height;
    currentView.zoom = Math.log2(
      40075017 / (viewer.camera.positionCartographic.height * 2 * Math.PI)
    );
  }
};

/** 停止环绕：移除 tick 监听、还原相机变换矩阵（无论 orbitActive 状态都强制清理） */
const stopOrbitRotation = () => {
  clearTimeout(orbitStartupTimer);
  orbitStartupTimer = null;
  const wasActive = orbitActive.value;
  orbitActive.value = false;
  if (viewer && !viewer.isDestroyed?.()) {
    viewer.__orbitActive = false;
    if (orbitTickListener) {
      viewer.clock.onTick.removeEventListener(orbitTickListener);
      orbitTickListener = null;
    }
    try {
      viewer.camera.cancelFlight?.();
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } catch {
      /* ignore */
    }
    viewer.scene.requestRender();
    if (wasActive) updateCameraInfo();
  }
  if (orbitInputHandler) {
    orbitInputHandler.destroy();
    orbitInputHandler = null;
  }
  orbitTransform = null;
  if (wasActive) syncMapUi();
};

/** 每帧更新 heading，lookAt 后立即还原 IDENTITY（避免风场投影失效） */
const updateOrbitCamera = () => {
  if (!viewer || !orbitActive.value || !orbitTransform) return;
  const dt = Math.min(viewer.clock?.deltaTime ?? 0.016, 0.1);
  orbitHeading += Cesium.Math.toRadians(ORBIT_CONFIG.SPEED_DEG_PER_SEC) * dt;
  viewer.camera.lookAtTransform(
    orbitTransform,
    new Cesium.HeadingPitchRange(
      orbitHeading,
      Cesium.Math.toRadians(orbitPitch.value),
      orbitHeight.value
    )
  );
  // 立即还原变换矩阵，避免 lookAtTransform 锁定相机参考系导致风场坐标投影失效
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
};

/** 监听用户拖动/缩放，一旦交互立即停止环绕 */
const setupOrbitInputHandler = () => {
  if (!viewer || orbitInputHandler) return;
  orbitInputHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  const stopOnUserInput = () => stopOrbitRotation();
  [
    Cesium.ScreenSpaceEventType.LEFT_DOWN,
    Cesium.ScreenSpaceEventType.RIGHT_DOWN,
    Cesium.ScreenSpaceEventType.MIDDLE_DOWN,
    Cesium.ScreenSpaceEventType.WHEEL,
    Cesium.ScreenSpaceEventType.PINCH_START,
  ].forEach((type) => {
    orbitInputHandler.setInputAction(stopOnUserInput, type);
  });
};

const startOrbitRotation = () => {
  if (!viewer || orbitActive.value) return;
  stopDroneCameraFollow();
  const center = Cesium.Cartesian3.fromDegrees(
    CHENGDU_CENTER.lng,
    CHENGDU_CENTER.lat,
    0
  );
  orbitTransform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  orbitHeading = 0;
  orbitActive.value = true;
  if (viewer) viewer.__orbitActive = true;
  updateOrbitCamera();
  orbitTickListener = updateOrbitCamera;
  viewer.clock.onTick.addEventListener(orbitTickListener);
  setupOrbitInputHandler();
  syncMapUi();
};

const toggleOrbitRotation = () => {
  if (orbitActive.value) {
    stopOrbitRotation();
  } else {
    startOrbitRotation();
  }
  syncMapUi();
};

// =============================================================================
// 违规车辆：添加挖掘机模型 & 地图拖动 & 模拟演示扫描
// =============================================================================
const isViolationVehicleEntity = (entity) => {
  const id = entity?.id;
  return typeof id === "string" && id.startsWith("violation_excavator_");
};

const haversineM = (lng1, lat1, lng2, lat2) => {
  const latRad = (lat1 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * 110540);
  const dLng = ((lng2 - lng1) * 111320 * Math.cos(latRad));
  return Math.hypot(dLng, dLat);
};

const cartesianToLngLat = (cartesian) => {
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lng: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
  };
};

const getPatrolRoutePathPoints = () => {
  const plannerPoints = routePlanner?.getPathPoints?.();
  if (plannerPoints?.length >= 2) return plannerPoints;

  const flyingIds = patrolManager?.getActiveIds?.() ?? new Set();
  for (const droneId of flyingIds) {
    const patrol = activePatrols.value?.[droneId];
    if (patrol?.waypoints?.length >= 2) {
      return patrol.waypoints.map((w) => ({
        lng: w.lng,
        lat: w.lat,
        height: w.height,
      }));
    }
  }
  return [];
};

const getActivePatrolPathPoints = () => {
  const routePoints = getPatrolRoutePathPoints();
  if (routePoints.length >= 2) return routePoints;

  const lineText = routeLines.value?.[routeLineIndex.value];
  if (lineText && rawSubwayGeojson) {
    const path = getSubwayLinePath(rawSubwayGeojson, lineText);
    if (path.length >= 2) return path;
  }
  return [];
};

const pointToRouteDistanceM = (lng, lat, pathPoints) => {
  if (!pathPoints?.length) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < pathPoints.length - 1; i += 1) {
    const a = pathPoints[i];
    const b = pathPoints[i + 1];
    const segLen = haversineM(a.lng, a.lat, b.lng, b.lat);
    if (segLen < 1) continue;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((lng - a.lng) * (b.lng - a.lng) + (lat - a.lat) * (b.lat - a.lat)) /
          Math.max((b.lng - a.lng) ** 2 + (b.lat - a.lat) ** 2, 1e-12),
      ),
    );
    const projLng = a.lng + t * (b.lng - a.lng);
    const projLat = a.lat + t * (b.lat - a.lat);
    minDist = Math.min(minDist, haversineM(lng, lat, projLng, projLat));
  }
  return minDist;
};

const validateViolationPlacement = (entity) => {
  const pos = getEntityPosition(entity);
  const coords = cartesianToLngLat(pos);
  if (!coords) return false;

  const pathPoints = getPatrolRoutePathPoints();
  if (pathPoints.length < 2) {
    ElMessage.warning("请先在右侧「航线与空域管控」生成巡检航线，再将挖掘机拖放到航线上");
    entity._onRoute = false;
    return false;
  }

  const dist = pointToRouteDistanceM(coords.lng, coords.lat, pathPoints);
  entity._onRoute = dist <= SIM_ROUTE_PROXIMITY_M;
  entity._coords = coords;

  if (entity._onRoute) {
    ElMessage.success(`已放置到巡检航线上（距航线 ${Math.round(dist)}m），等待无人机扫描`);
  } else {
    ElMessage.warning(`距巡检航线 ${Math.round(dist)}m，请拖近至 ${SIM_ROUTE_PROXIMITY_M}m 内`);
  }
  syncMapUi();
  return entity._onRoute;
};

const checkSimulationViolationScan = (droneId, pos) => {
  if (!simulationDemoActive.value || !violationVehicleLayer || !pos) return;

  const drone = fleetDrones.value.find((d) => d.id === droneId);
  if (!drone || drone.status !== "flying") return;

  const entities = violationVehicleLayer.entities.values;
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    if (!isViolationVehicleEntity(entity) || entity._simReported || !entity._onRoute) continue;

    const vPos = getEntityPosition(entity);
    const vCoords = entity._coords || cartesianToLngLat(vPos);
    if (!vCoords) continue;

    const dist = haversineM(pos.lng, pos.lat, vCoords.lng, vCoords.lat);
    if (dist <= SIM_SCAN_RADIUS_M) {
      triggerSimulationViolation(entity, drone, vCoords);
    }
  }
};

const triggerSimulationViolation = async (entity, drone, coords) => {
  if (entity._simReported) return;
  entity._simReported = true;

  const beamId = entity.id.replace("violation_excavator_", "");
  createViolationLightBeam(viewer, beamId, coords.lng, coords.lat);

  const lineText = routeLines.value?.[routeLineIndex.value] || drone.line || "";
  try {
    const res = await fetch(`${API}/api/fleet/violations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plate: "模拟·违规挖掘机",
        type: "保护区违规 · 挖掘机",
        line: lineText,
        lng: coords.lng,
        lat: coords.lat,
        desc: "模拟演示：无人机巡航扫描发现保护区违规停放挖掘机",
        droneId: drone.id,
        droneName: drone.name,
        autoAssign: true,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      getdata.triggerViolationAlert({
        violation: json.data.violation,
        task: json.data.task,
        timestamp: new Date().toISOString(),
      });
      if (json.data.violation) {
        syncViolationMarkers(markerLayers, [
          json.data.violation,
          ...fleetViolations.value.filter((v) => v.id !== json.data.violation.id),
        ]);
      }
      // 全屏 ViolationAlertOverlay 已展示，不再重复顶部 error 消息条
    }
  } catch (err) {
    console.warn("模拟违规上报失败（已本地触发全屏告警）:", err);
    getdata.triggerViolationAlert({
      violation: {
        id: entity.id,
        plate: "模拟·违规挖掘机",
        type: "保护区违规 · 挖掘机",
        line: lineText,
        lng: coords.lng,
        lat: coords.lat,
        droneName: drone.name,
      },
      timestamp: new Date().toISOString(),
    });
  }

  viewer?.scene.requestRender();
};

const startSimulationDemo = () => {
  if (!viewer) {
    ElMessage.warning("地图尚未就绪，请稍候");
    return;
  }
  simulationDemoActive.value = true;
  addViolationExcavator();
  syncMapUi();
  ElMessage({
    message: "已生成挖掘机模型，请将其拖放到巡检航线上；启动无人机巡航后，扫描到该车辆将触发全屏告警",
    type: "info",
    duration: 8000,
    showClose: true,
  });
};

const ensureViolationVehicleLayer = () => {
  if (!viewer) return null;
  if (!violationVehicleLayer) {
    violationVehicleLayer = new Cesium.CustomDataSource("violation-vehicles");
    viewer.dataSources.add(violationVehicleLayer);
  }
  return violationVehicleLayer;
};

const pickGroundFromScreen = (screenPosition) => {
  if (!viewer) return null;
  const ray = viewer.camera.getPickRay(screenPosition);
  if (!ray) return null;
  return viewer.scene.globe.pick(ray, viewer.scene);
};

const getViolationSpawnPosition = () => {
  const canvas = viewer.scene.canvas;
  const screenCenter = new Cesium.Cartesian2(
    canvas.clientWidth / 2,
    canvas.clientHeight / 2
  );
  let cartesian = pickGroundFromScreen(screenCenter);
  if (!cartesian) {
    cartesian = Cesium.Cartesian3.fromDegrees(
      CHENGDU_CENTER.lng,
      CHENGDU_CENTER.lat,
      0
    );
  }
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  const offset = violationVehicleSeq * 0.00035;
  carto.longitude += offset;
  carto.latitude += offset * 0.6;
  return Cesium.Cartesian3.fromRadians(
    carto.longitude,
    carto.latitude,
    carto.height
  );
};

const setupViolationDragHandler = () => {
  if (!viewer || violationDragHandler) return;

  violationDragHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  violationDragHandler.setInputAction((click) => {
    if (handler || draggingViolationEntity) return;
    const picked = viewer.scene.pick(click.position);
    if (!Cesium.defined(picked) || !isViolationVehicleEntity(picked.id)) return;
    draggingViolationEntity = picked.id;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  violationDragHandler.setInputAction((movement) => {
    if (!draggingViolationEntity) return;
    const cartesian = pickGroundFromScreen(movement.endPosition);
    if (!cartesian) return;
    draggingViolationEntity.position = cartesian;
    viewer.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  const releaseDrag = () => {
    if (draggingViolationEntity) {
      validateViolationPlacement(draggingViolationEntity);
    }
    draggingViolationEntity = null;
    if (viewer && !viewer.isDestroyed?.()) {
      viewer.scene.screenSpaceCameraController.enableInputs = true;
    }
  };

  violationDragHandler.setInputAction(releaseDrag, Cesium.ScreenSpaceEventType.LEFT_UP);
  violationDragHandler.setInputAction(releaseDrag, Cesium.ScreenSpaceEventType.LEFT_UP_OUTSIDE);
};

const addViolationExcavator = () => {
  if (!viewer) return;
  const layer = ensureViolationVehicleLayer();
  if (!layer) return;

  violationVehicleSeq += 1;
  const position = getViolationSpawnPosition();

  layer.entities.add({
    id: `violation_excavator_${violationVehicleSeq}`,
    position,
    model: {
      uri: VIOLATION_EXCAVATOR_URI,
      scale: 10,
      minimumPixelSize: 64,
      maximumScale: 180,
      silhouetteColor: Cesium.Color.fromCssColorString("#ff4444"),
      silhouetteSize: 1.6,
    },
  });

  setupViolationDragHandler();
  viewer.scene.requestRender();
};

const clearViolationVehicleLayer = () => {
  draggingViolationEntity = null;
  if (violationDragHandler) {
    violationDragHandler.destroy();
    violationDragHandler = null;
  }
  if (viewer && !viewer.isDestroyed() && violationVehicleLayer) {
    if (viewer.dataSources.contains(violationVehicleLayer)) {
      viewer.dataSources.remove(violationVehicleLayer, true);
    }
  }
  violationVehicleLayer = null;
  violationVehicleSeq = 0;
};

// =============================================================================
// 工具函数：时间刷新 & Entity 位置读取
// =============================================================================
const getEntityPosition = (entity) => {
  if (!entity?.position) return null;
  if (entity.position instanceof Cesium.Cartesian3) {
    return entity.position;
  }
  if (typeof entity.position.getValue === "function") {
    const time = viewer?.clock?.currentTime ?? Cesium.JulianDate.now();
    return entity.position.getValue(time);
  }
  return null;
};

const lerpAngle = (from, to, t) => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Cesium.Math.TWO_PI;
  while (diff < -Math.PI) diff += Cesium.Math.TWO_PI;
  return from + diff * t;
};

const bearingFromLngLat = (from, to) => {
  const latRad = Cesium.Math.toRadians((from.lat + to.lat) / 2);
  const dLon = to.lng - from.lng;
  const dLat = to.lat - from.lat;
  return Math.atan2(dLon * Math.cos(latRad), dLat);
};

const getInitialDroneHeading = (drone) => {
  const patrolPos = patrolManager?.getPosition(drone.fleetId);
  if (patrolPos) {
    const fleetDrone = fleetDrones.value.find((d) => d.id === drone.fleetId);
    const patrol = activePatrols.value?.[drone.fleetId];
    const lineText =
      patrol?.line ||
      (fleetDrone?.line ? `${fleetDrone.line}保护区` : fleetDrone?.line);
    if (lineText && rawSubwayGeojson) {
      const pathPoints = getSubwayLinePath(rawSubwayGeojson, lineText);
      if (pathPoints.length >= 2) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        for (let i = 0; i < pathPoints.length; i += 1) {
          const p = pathPoints[i];
          const dx = (p.lng - patrolPos.lng) * Math.cos(Cesium.Math.toRadians(patrolPos.lat));
          const dy = p.lat - patrolPos.lat;
          const dist = dx * dx + dy * dy;
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
          }
        }
        const nextIdx = Math.min(nearestIdx + 1, pathPoints.length - 1);
        const from = pathPoints[nearestIdx];
        const to = pathPoints[nextIdx];
        if (from && to && (from.lng !== to.lng || from.lat !== to.lat)) {
          return bearingFromLngLat(from, to);
        }
      }
    }
  }

  const pos = getEntityPosition(drone.model);
  if (pos && viewer) {
    return viewer.camera.heading;
  }
  return 0;
};

// =============================================================================
// 无人机相机跟随（单击选中 → 第三人称跟随，双击取消）
// =============================================================================
const updateDroneFollowCamera = (drone) => {
  if (!viewer || !drone?.model) return;

  const pos = getEntityPosition(drone.model);
  if (!pos) return;

  if (drone._followLastPos) {
    const delta = Cesium.Cartesian3.subtract(
      pos,
      drone._followLastPos,
      new Cesium.Cartesian3()
    );
    if (Cesium.Cartesian3.magnitude(delta) > 0.3) {
      const enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
      const inv = Cesium.Matrix4.inverse(enuFrame, new Cesium.Matrix4());
      const enu = Cesium.Matrix4.multiplyByPointAsVector(
        inv,
        delta,
        new Cesium.Cartesian3()
      );
      const targetHeading = Math.atan2(enu.x, enu.y);
      drone._followHeading = lerpAngle(
        drone._followHeading ?? targetHeading,
        targetHeading,
        DRONE_CAMERA_CONFIG.HEADING_SMOOTH
      );
    }
  }
  drone._followLastPos = Cesium.Cartesian3.clone(pos);

  viewer.camera.lookAt(
    pos,
    new Cesium.HeadingPitchRange(
      (drone._followHeading ?? 0) + DRONE_CAMERA_CONFIG.FOLLOW_HEADING_OFFSET,
      Cesium.Math.toRadians(DRONE_CAMERA_CONFIG.FOLLOW_PITCH),
      DRONE_CAMERA_CONFIG.FOLLOW_DISTANCE
    )
  );
};

const clearDroneCameraFollow = (drone) => {
  if (!drone?.cameraUpdateListener || !viewer) return;
  viewer.clock.onTick.removeEventListener(drone.cameraUpdateListener);
  drone.cameraUpdateListener = null;
  drone.cameraInitialized = false;
  drone._followLastPos = null;
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
};

const findOnlineDroneByEntity = (entity) => {
  return allDrones.find(
    (d) =>
      d.model === entity || d.rings?.some((r) => r === entity)
  );
};

const stopDroneCameraFollow = () => {
  if (followingDrone) {
    clearDroneCameraFollow(followingDrone);
    const flying = fleetDrones.value.some(
      (d) => d.id === followingDrone.fleetId && d.status === "flying" && d.online
    );
    if (!flying) {
      setDronePulseVisible(followingDrone, true);
    }
    followingDrone = null;
  }
};

const activateDroneCameraFollow = (drone) => {
  if (!viewer || !drone?.model) return;
  stopOrbitRotation();

  allDrones.forEach((d) => {
    const flying = fleetDrones.value.some(
      (fd) => fd.id === d.fleetId && fd.status === "flying" && fd.online
    );
    if (!flying) {
      setDronePulseVisible(d, d.fleetId !== drone.fleetId);
    }
  });

  if (followingDrone && followingDrone !== drone) {
    clearDroneCameraFollow(followingDrone);
  }
  followingDrone = drone;
  startContinuousCameraFollow(drone);
};

const startDroneCameraFollow = (drone) => {
  activateDroneCameraFollow(drone);
};

const startContinuousCameraFollow = (drone) => {
  if (!viewer || !drone?.model) return;
  clearDroneCameraFollow(drone);
  viewer.trackedEntity = undefined;
  drone._followLastPos = null;
  drone._followHeading = getInitialDroneHeading(drone);

  updateDroneFollowCamera(drone);
  viewer.scene.requestRender();

  drone.cameraUpdateListener = () => {
    updateDroneFollowCamera(drone);
  };
  viewer.clock.onTick.addEventListener(drone.cameraUpdateListener);
};

// =============================================================================
// 无人机视觉特效（锥形雷达扫描 / 在线脉冲环）
// =============================================================================
const getDronePositionForScan = (fleetId, entry) => {
  const patrolPos = patrolManager?.getPosition(fleetId);
  if (patrolPos) return patrolPos;
  const pos = getEntityPosition(entry?.model);
  if (!pos) return null;
  const carto = Cesium.Cartographic.fromCartesian(pos);
  return {
    lng: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height,
  };
};

const syncDroneVisualEffects = () => {
  if (!markerLayers) return;

  const activeFlyingIds = new Set();

  for (const d of fleetDrones.value) {
    const isFlying = d.status === "flying" && d.online;
    const entry = allDrones.find((x) => x.fleetId === d.id);
    if (!entry) continue;

    if (isFlying) {
      activeFlyingIds.add(d.id);
      setDronePulseVisible(entry, false);

      if (!droneConeScans.has(d.id)) {
        droneConeScans.set(
          d.id,
          createDroneConeScan(markerLayers.radarScanLayer, {
            id: d.id,
            getPosition: () => getDronePositionForScan(d.id, entry),
          })
        );
      }
    } else {
      clearDroneConeScan(droneConeScans, d.id);
      const lon = d.lng ?? d.lon;
      const lat = d.lat;
      const height = d.homeHeight ?? d.height ?? 600;
      if (lon != null && lat != null) {
        ensureDroneOnlinePulseRings(markerLayers, entry, lon, lat, height);
      }
      setDronePulseVisible(entry, true);
    }
  }

  for (const id of [...droneConeScans.keys()]) {
    if (!activeFlyingIds.has(id)) {
      clearDroneConeScan(droneConeScans, id);
    }
  }
};

const setupDronePickHandler = () => {
  if (!viewer) return;
  if (dronePickHandler) {
    dronePickHandler.destroy();
    dronePickHandler = null;
  }
  dronePickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  dronePickHandler.setInputAction((movement) => {
    if (handler) return;
    const picked = viewer.scene.pick(movement.position);
    if (!Cesium.defined(picked) || !picked.id) return;
    const drone = findOnlineDroneByEntity(picked.id);
    if (!drone) return;
    startDroneCameraFollow(drone);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  dronePickHandler.setInputAction(() => {
    stopDroneCameraFollow();
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
};

// =============================================================================
// 无人机巡航引擎 & 机队标记同步
// =============================================================================
const completePatrolOnServer = async (droneId) => {
  try {
    await fetch(`${API}/api/fleet/patrol/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ droneId }),
    });
  } catch (err) {
    console.warn("巡航结束上报失败:", err);
  }
};

const resolvePatrolFlightHeight = (patrol) => {
  const fromPatrol = patrol?.cruiseHeight ?? patrol?.fixedHeight;
  if (fromPatrol != null && Number.isFinite(Number(fromPatrol))) {
    return Number(fromPatrol);
  }
  const route = routePlanner?.getRoute?.();
  const fromRoute = route?.fixedHeight ?? routePlanner?.getFixedHeight?.();
  if (fromRoute != null && Number.isFinite(Number(fromRoute))) {
    return Number(fromRoute);
  }
  return Number(routePatrolHeight.value) || ROUTE_DEFAULTS.FIXED_HEIGHT;
};

const buildPatrolPathPoints = (patrol, lineText, flightHeight) => {
  if (patrol?.waypoints?.length) {
    return patrol.waypoints.map((w) => ({
      lng: w.lng,
      lat: w.lat,
      height: w.height ?? flightHeight,
    }));
  }
  const route = routePlanner?.getRoute?.();
  if (route?.waypoints?.length) {
    return [...route.waypoints]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((w) => ({
        lng: w.lng,
        lat: w.lat,
        height: w.height ?? route.fixedHeight ?? flightHeight,
      }));
  }
  if (routePlanner?.getPathPoints?.()?.length) {
    return routePlanner.getPathPoints().map((w) => ({
      lng: w.lng,
      lat: w.lat,
      height: w.height ?? flightHeight,
    }));
  }
  return getSubwayLinePath(rawSubwayGeojson, lineText).map((w) => ({
    lng: w.lng,
    lat: w.lat,
    height: w.height ?? flightHeight,
  }));
};

const ensureDronePatrols = () => {
  if (!patrolManager || !viewer || !rawSubwayGeojson) return;

  const droneMap = new Map(allDrones.map((d) => [d.fleetId, d]));
  const patrolIds = patrolManager.getActiveIds();

  for (const drone of fleetDrones.value) {
    const isFlying = drone.status === "flying" && drone.online;
    if (!isFlying) {
      if (patrolIds.has(drone.id)) patrolManager.stopPatrol(drone.id);
      continue;
    }
    if (patrolManager.isPatrolling(drone.id)) continue;

    const patrol = activePatrols.value?.[drone.id];
    const lineText = patrol?.line || `${drone.line}保护区` || drone.line;
    const flightHeight = resolvePatrolFlightHeight(patrol);
    const pathPoints = buildPatrolPathPoints(patrol, lineText, flightHeight);
    if (pathPoints.length < 2) {
      console.warn("未找到地铁线路路径:", lineText);
      continue;
    }

    const entry = droneMap.get(drone.id); 
    if (!entry) continue;

    patrolManager.startPatrol(drone.id, entry, {
      homeLng: patrol?.homeLng ?? drone.homeLng ?? drone.lng,
      homeLat: patrol?.homeLat ?? drone.homeLat ?? drone.lat,
      homeHeight: patrol?.homeHeight ?? drone.homeHeight ?? 45,
      cruiseHeight: flightHeight,
      pathPoints,
      oneDirection: true,
    });
    console.log(`开始巡航: ${drone.name} · ${lineText} · 高度 ${flightHeight}m（最近航点起单向）`);
  }
};

let markerHeavyLoaded = false;
let fleetMarkersScheduled = false;

/** 仅注册工具栏回调，不加载标记（零 GPU 开销） */
const bootstrapMapBridge = () => {
  if (mapBridgeRegistered) return;
  mapBridgeRegistered = true;
  registerMapBridge();
};

/** 创建空 CustomDataSource（禁飞区等），几乎零 GPU 开销 */
const ensureMinimalMarkerLayers = () => {
  if (!viewer || viewer.isDestroyed?.()) return false;
  if (!markerLayers) {
    markerLayers = initMarkerLayers(viewer);
  }
  return true;
};

/** 按需初始化测绘工具（与机队标记解耦） */
const ensureSurveyMeasureManager = () => {
  if (!viewer || viewer.isDestroyed?.()) return false;
  if (surveyMeasureManager) return true;
  try {
    surveyMeasureManager = createSurveyMeasureManager(viewer, {
      meshPrecision: getdata.viewshed.meshPrecision || 'high',
      onStateChange: (state) => {
        surveyStats.distanceTotalM = state.distanceTotalM ?? 0;
        surveyStats.areaPlaneM2 = state.areaPlaneM2 ?? 0;
        surveyStats.areaSurfaceM2 = state.areaSurfaceM2 ?? 0;
        surveyStats.elevationCount = state.elevationCount ?? 0;
        syncMapUi();
      },
    });
    console.log('[map] 测绘模块就绪');
    return true;
  } catch (err) {
    console.error('[map] 测绘模块初始化失败:', err);
    return false;
  }
};

/** 延迟加载机队 GLTF / HTML 标签，避免阻塞工具栏点击 */
const scheduleFleetMarkersLoad = () => {
  if (markerHeavyLoaded || fleetMarkersScheduled) return;
  if (routeGenerating.value) return;
  fleetMarkersScheduled = true;
  requestAnimationFrame(() => {
    setTimeout(() => {
      fleetMarkersScheduled = false;
      loadFleetMarkersDeferred();
    }, 16);
  });
};

/** 地图就绪后自动加载无人机 GLTF（无需先点航线面板） */
const scheduleFleetMarkersLoadOnStartup = () => {
  const deferMs = Number(import.meta.env.VITE_DRONE_DEFER_MS) || 2500;
  setTimeout(() => scheduleFleetMarkersLoad(), deferMs);
};

const loadFleetMarkersDeferred = () => {
  if (!viewer || viewer.isDestroyed?.() || markerHeavyLoaded) return;
  ensureMinimalMarkerLayers();
  preloadDroneGltf(viewer);
  try {
    if (!mapLabelManager) {
      mapLabelManager = createMapLabelManager(viewer);
      syncAirportNoFlyLabels(mapLabelManager);
      setupDronePickHandler();
    }
    markerHeavyLoaded = true;
    syncFleetFromStore();
    console.log('[map] 机队标记图层初始化完成（含无人机 GLTF）');
  } catch (err) {
    console.error('[map] 机队标记加载失败:', err);
  }
};

/** 按需初始化可视域/巡航/航线 */
const ensureHeavyMapManagers = () => {
  if (!viewer || viewer.isDestroyed?.()) return false;
  ensureMinimalMarkerLayers();
  if (!routePlanner) initHeavyMapManagers();
  return Boolean(routePlanner);
};

const initHeavyMapManagers = () => {
  if (!viewer || !markerLayers || routePlanner) return;

  try {
    routePlanner = createRoutePlannerManager(viewer, {
      fixedHeight: routePatrolHeight.value,
      fixedPitch: ROUTE_FIXED_PITCH,
    });
    patrolManager = createDronePatrolManager({
      onComplete: (droneId) => {
        patrolManager.stopPatrol(droneId);
        riskReturnTriggered.delete(droneId);
        viewshedSkipDroneIds.delete(droneId);
        viewshedManager?.clearFlightViewshed();
        completePatrolOnServer(droneId);
      },
      onPositionUpdate: (droneId, pos, phase) => {
        const drone = fleetDrones.value.find((d) => d.id === droneId);
        if (drone?.status === 'flying') {
          handleInFlightRisk(droneId, pos);
          checkSimulationViolationScan(droneId, pos);
        }
        // 可视域仅在航点悬停时分析，飞行途中不更新
      },
      onWaypointHover: (droneId, point, pathIndex) => {
        handleWaypointHover(droneId, point, pathIndex);
      },
    });
    viewshedManager = createViewshedManager(viewer, {
      maxDistanceM: 500,
      buildingCheckRadiusM: 300,
      hFovDeg: 60,
      vFovDeg: 40,
      scanStepDeg: 10,
      pitchDeg: -28,
      meshPrecision: getdata.viewshed.meshPrecision || 'high',
      onStateChange: (state) => {
        getdata.patchViewshed({
          mode: state.mode,
          buildingsEnabled: state.buildingsEnabled,
          terrainEnabled: state.terrainEnabled,
          meshPrecision: state.meshPrecision,
          gimbalPitch: state.gimbalPitch,
          gimbalHeading: state.gimbalHeading,
          canExport: state.canExport,
          scanning: state.scanning,
          analysing: state.analysing,
          boundsDebugVisible: state.boundsDebugVisible,
          buildProgress: state.buildProgress,
          savedWaypointCount: state.savedWaypointCount,
          visibleAreaM2: state.visibleAreaM2 ?? getdata.viewshed.visibleAreaM2,
          blindAreaM2: state.blindAreaM2 ?? getdata.viewshed.blindAreaM2,
          footprintAreaM2: state.footprintAreaM2 ?? getdata.viewshed.footprintAreaM2,
          currentWaypointIndex: state.currentWaypointIndex ?? getdata.viewshed.currentWaypointIndex,
          areaSource: state.areaSource ?? getdata.viewshed.areaSource,
          cumulativeVisibleM2: state.cumulativeVisibleM2 ?? getdata.viewshed.cumulativeVisibleM2,
          cumulativeBlindM2: state.cumulativeBlindM2 ?? getdata.viewshed.cumulativeBlindM2,
        });
      },
      onScanProgress: ({ progress }) => {
        getdata.patchViewshed({ scanProgress: progress, scanning: true });
      },
      onAnalyseComplete: ({ waypointMeta, visibleAreaM2, blindAreaM2, exportJson, areaValidation, footprintAreaM2, bboxFilterStats, boundsDebugVisible: debugVisible, areaSource, cumulativeVisibleM2, cumulativeBlindM2 }) => {
        getdata.patchViewshed({
          mode: 'idle',
          scanning: false,
          analysing: false,
          scanProgress: 1,
          visibleAreaM2,
          blindAreaM2,
          canExport: true,
          currentWaypointIndex: waypointMeta?.index,
          areaValidation,
          footprintAreaM2,
          areaSource,
          cumulativeVisibleM2,
          cumulativeBlindM2,
          bboxFilterStats,
          boundsDebugVisible: !!debugVisible,
          savedWaypointCount: viewshedManager?.getSavedWaypointCount?.() ?? 0,
        });
        if (exportJson) getdata.addViewshedRecord(exportJson);
      },
      onAreaWarning: (validation) => {
        if (validation?.ok !== false || !validation?.warning) return;
        ElMessageBox.alert(validation.warning, '可视域面积计算异常', { type: 'error' });
      },
      onBboxFilterWarning: (payload) => {
        if (!payload?.message) return;
        console.warn('[viewshed-bbox]', payload.message, payload.stats);
      },
    });
    viewshedManager.setBuildingsEnabled(buildingLayerVisible.value);
    viewshedManager.setTerrainEnabled(terrainLayerVisible.value);
    viewshedManager.setBlindZoneVisible(blindZoneLayerVisible.value);
    if (cityTileset) viewshedManager.setCityTileset(cityTileset);
    registerViewshedBridge();
    ensureSurveyMeasureManager();
    patrolManager.attachTick(viewer);
    console.log("可视域/巡航模块初始化完成");
  } catch (err) {
    console.error("可视域/巡航模块加载失败:", err);
  }
};

const syncFleetFromStore = () => {
  if (!viewer || viewer.isDestroyed?.()) return;
  if (!markerHeavyLoaded) {
    scheduleFleetMarkersLoad();
    return;
  }
  if (!markerLayers) return;
  clearTimeout(syncFleetDebounceTimer);
  syncFleetDebounceTimer = setTimeout(flushFleetMarkersFromStore, 350);
};

let syncFleetDebounceTimer = null;

const flushFleetMarkersFromStore = () => {
  if (!markerLayers) return;
  const skipDroneIds = patrolManager?.getActiveIds() ?? new Set();
  const flyingDroneIds = new Set([
    ...fleetDrones.value
      .filter((d) => d.status === "flying" && d.online)
      .map((d) => d.id),
    ...skipDroneIds,
  ]);
  const { drones } = syncFleetMarkers(markerLayers, {
    personnel: fleetPersonnel.value,
    drones: fleetDrones.value,
  }, { skipDroneIds, flyingDroneIds });
  syncViolationMarkers(markerLayers, fleetViolations.value);
  allDrones = drones.map((d) => ({
    cameraUpdateListener: null,
    ...d,
  }));
  syncFleetLabels(mapLabelManager, viewer, {
    personnel: fleetPersonnel.value,
    droneEntries: allDrones,
    personnelRegistry: getPersonnelRegistry(),
  }, { flyingDroneIds });
  ensureDronePatrols();
  syncDroneVisualEffects();
  viewer?.scene.requestRender();
};

// =============================================================================
// AI 检测违规上报（车辆在保护区内 → POST 到后端）
// =============================================================================
const reportDetectionViolations = async () => {
  if (!safetyBufferGeojson || !targetLineFc || !detections.value?.length) return;
  const flyingDrone = fleetDrones.value.find((d) => d.status === "flying" && d.online);
  for (const det of detections.value) {
    const lng = det.position?.lng ?? det.position?.longitude;
    const lat = det.position?.lat ?? det.position?.latitude;
    if (lng == null || lat == null) continue;
    const risk = evaluateVehicleRisk([lng, lat], targetLineFc, safetyBufferGeojson);
    if (!risk.shouldAlert) continue;
    const key = `${det.id || det.label}_${Math.round(lng * 1000)}_${Math.round(lat * 1000)}`;
    if (reportedViolationKeys.has(key)) continue;
    reportedViolationKeys.add(key);
    try {
      await fetch(`${API}/api/fleet/violations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: det.label || det.type || "检测车辆",
          type: `${risk.riskLevel} · 保护区违规`,
          line: flyingDrone?.line || "",
          lng,
          lat,
          desc: `巡航检测到${det.label || "车辆"}，距轨道${risk.distanceToTrack}m`,
          droneId: flyingDrone?.id,
          droneName: flyingDrone?.name,
          autoAssign: true,
        }),
      });
    } catch (err) {
      console.warn("上报违规失败:", err);
    }
  }
};

// =============================================================================
// Pinia 数据监听：机队变化 / 检测变化 → 自动同步地图
// =============================================================================
watch([fleetPersonnel, fleetDrones, fleetViolations], () => {
  syncFleetFromStore();
}, { deep: true });

watch(fleetUpdatedAt, () => {
  syncFleetFromStore();
});

watch(isLoading, (loading) => {
  if (!loading) syncFleetFromStore();
});

watch(detections, () => {
  reportDetectionViolations();
}, { deep: true });

watch(routeLineIndex, () => {
  clearAllSurveyMeasure();
});

watch(
  () => getdata.viewshed.meshPrecision,
  (precision) => {
    surveyMeasureManager?.setMeshPrecision?.(precision);
  },
);

// =============================================================================
// 生命周期：初始化地图 → 加载线路/白膜 → 同步机队 → 清理资源
// =============================================================================
onMounted(async () => {
  await nextTick()

  if (cesiumContainer.value && typeof ResizeObserver !== 'undefined') {
    const resizeTarget = cesiumContainer.value.closest('.enhanced-3d-map') || cesiumContainer.value
    mapResizeObserver = new ResizeObserver(() => {
      clearTimeout(mapResizeDebounce)
      mapResizeDebounce = setTimeout(() => {
        if (viewer && !viewer.isDestroyed?.()) {
          syncViewerCanvasSize(viewer)
        }
      }, 150)
    })
    mapResizeObserver.observe(resizeTarget)
  }

  try {
    await initCesium();
    if (!viewer) return;

    forceViewerResize();
    await finalizeSceneView(viewer, null, { force: true });
  } catch (err) {
    console.error("地图初始化异常:", err);
    ElMessage.error(`地图初始化失败：${err?.message || err}`);
  } finally {
    isLoading.value = false;
  }

  if (!viewer || viewer.isDestroyed?.()) return;

  bootstrapMapBridge();
  scheduleFleetMarkersLoadOnStartup();
  window.__ensureMapInteractive = () => {
    stopOrbitRotation();
    ensureMapCameraInteractive();
    return window.__mapDebug?.();
  };

  try {
    await loadSubwayLinesOnly();
  } catch (err) {
    console.warn('[map] 地铁线路加载失败:', err);
  }

  scheduleBuildingLoad();

  initStartupLayers().catch((err) => {
    console.warn('[map] 启动图层加载失败:', err);
  });

  window.__mapReloadSubway = async () => {
    removeLayer(viewer, 'subway-lines');
    subwayLineEntities.value = [];
    if (safetyBufferInnerDs && viewer) {
      viewer.dataSources.remove(safetyBufferInnerDs, true);
      safetyBufferInnerDs = null;
    }
    if (safetyBufferOuterDs && viewer) {
      viewer.dataSources.remove(safetyBufferOuterDs, true);
      safetyBufferOuterDs = null;
    }
    await loadSubwayLayersAndBuffers();
  };

  window.__mapReloadBuildings = async () => {
    buildingLoadPromise = null;
    removeLayer(viewer, 'city-building');
    cityTileset = null;
    buildingLayerVisible.value = true;
    return loadcitymode();
  };
});

/** 组件卸载：停止轮询、清除图层/特效/事件监听、销毁 Viewer */
onUnmounted(() => {
  mapResizeObserver?.disconnect()
  mapResizeObserver = null
  clearTimeout(mapResizeDebounce)
  mapResizeDebounce = null
  clearTimeout(airportNoFlyScheduleTimer)
  airportNoFlyScheduleTimer = null
  clearTimeout(orbitStartupTimer)
  orbitStartupTimer = null
  clearTimeout(syncFleetDebounceTimer)
  syncFleetDebounceTimer = null
  if (removeBlinkEventListener) {
    clearInterval(removeBlinkEventListener)
    removeBlinkEventListener = null
  }
  stopWindPoll();
  stopRainPoll();
  removeWindLayer();
  destroyVolumetricCloudLayer(viewer);
  clearRainEffect(viewer);
  clearVehicleHeatmap(viewer);
  clearAllDroneConeScans(droneConeScans);
  getdata.unregisterViewshedActions();
  getdata.unregisterMapActions();
  viewshedManager?.destroy();
  viewshedManager = null;
  surveyMeasureManager?.destroy();
  surveyMeasureManager = null;
  patrolManager?.destroy(viewer);
  patrolManager = null;
  stopOrbitRotation();
  stopDroneCameraFollow();
  clearViolationVehicleLayer();
  clearViolationLightBeams(viewer);
  teardownRouteEditHandler();
  routePlanner?.destroy();
  routePlanner = null;
  if (viewer) {
    if (safetyBufferInnerDs) {
      viewer.dataSources.remove(safetyBufferInnerDs, true);
      safetyBufferInnerDs = null;
    }
    if (safetyBufferOuterDs) {
      viewer.dataSources.remove(safetyBufferOuterDs, true);
      safetyBufferOuterDs = null;
    }
    if (markerTickListener) {
      viewer.clock.onTick.removeEventListener(markerTickListener);
      markerTickListener = null;
    }
    clearDroneCameraFollow(followingDrone);
    followingDrone = null;
    if (dronePickHandler) {
      dronePickHandler.destroy();
      dronePickHandler = null;
    }
    allDrones = [];
    clearFleetMarkers(markerLayers);
    clearViolationMarkers(markerLayers);
    mapLabelManager?.destroy();
    mapLabelManager = null;
    markerLayers?.destroy();
    markerLayers = null;
    drones.value.forEach((drone) => {
      if (drone.updatePositionListener) {
        viewer.clock.onTick.removeEventListener(drone.updatePositionListener);
      }
      if (drone.cameraUpdateListener) {
        viewer.clock.onTick.removeEventListener(drone.cameraUpdateListener);
      }
    });
    destroyCesiumViewer(viewer);
    viewer = null;
  }
});

</script>

<style scoped>
/* =============================================================================
   布局基础：全屏 Cesium 容器 + 浮层控件
   ============================================================================= */
.enhanced-3d-map {
  --header-height: 80px;
  width: 100%;
  height: 100%;
  position: relative;
  background: transparent;
  border-radius: 0;
  overflow: hidden;
}

.cesium-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.cesium-container :deep(.cesium-widget) {
  width: 100%;
  height: 100%;
  display: block;
  position: relative;
  z-index: 0;
  pointer-events: auto;
  touch-action: none;
}

.cesium-container :deep(.cesium-widget canvas) {
  display: block;
  pointer-events: auto;
  touch-action: none;
}

/* 整层穿透到 Cesium canvas；只有具体控件自己开 pointer-events */
.map-overlays {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

/* 通用控件组（部分历史样式，当前未在 template 中使用） */
.map-controls {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 1000;
}

.control-group {
  display: flex;
  gap: 8px;
  background: rgba(0, 0, 0, 0.8);
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(0, 212, 255, 0.3);
}

.subway-controls {
  margin-top: 10px;
  flex-direction: column;
  align-items: stretch;
}

.subway-controls .el-button {
  margin-bottom: 5px;
  width: 100%;
}

.drone-controls {
  position: absolute;
  top: 20px;
  left: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  z-index: 1000;
  max-height: 80%;
  overflow-y: auto;
}

.drone-panel {
  background: rgba(0, 0, 0, 0.8);
  border-radius: 8px;
  padding: 12px;
  border: 2px solid rgba(0, 212, 255, 0.3);
  min-width: 200px;
}

.drone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.2);
}

.drone-name {
  color: #00d4ff;
  font-weight: bold;
  cursor: pointer;
  transition: color 0.3s ease;
}

.drone-name:hover {
  color: #00ff88;
}

.drone-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: bold;
}

.drone-status.idle {
  background: rgba(128, 128, 128, 0.3);
  color: #a0a0a0;
}

.drone-status.cruising {
  background: rgba(0, 255, 136, 0.3);
  color: #00ff88;
}

.drone-status.paused {
  background: rgba(249, 202, 36, 0.3);
  color: #f9ca24;
}

.drone-status.manual {
  background: rgba(33, 150, 243, 0.3);
  color: #2196f3;
}

.drone-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.drone-buttons .el-button {
  flex: 1;
  min-width: 60px;
}

/* 线路分配弹窗样式 */
.assignment-content {
  padding: 10px 0;
  background: rgba(0, 0, 0, 0.9);
  border-radius: 8px;
}

.drone-info {
  margin-bottom: 20px;
  padding: 15px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 8px;
  border: 1px solid rgba(0, 212, 255, 0.5);
}

.drone-info h4 {
  margin: 0 0 8px 0;
  color: #ffffff;
  font-size: 16px;
  font-weight: bold;
}

.drone-info p {
  margin: 0;
  color: #ffffff;
  font-size: 14px;
  font-weight: 500;
}

.line-selection {
  margin-bottom: 20px;
}

.line-selection h4 {
  margin: 0 0 15px 0;
  color: #ffffff;
  font-size: 16px;
  font-weight: bold;
}

.line-radio-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 300px;
  overflow-y: auto;
}

.line-radio {
  width: 100%;
  margin: 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
}

.line-radio:hover {
  background: rgba(0, 212, 255, 0.2);
  border-color: rgba(0, 212, 255, 0.5);
}

.line-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.line-name {
  font-size: 14px;
  color: #ffffff;
  font-weight: bold;
}

.line-color {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.assignment-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

/* 检测目标 HTML 覆盖层（历史功能） */
.detection-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 500;
}

.detection-marker {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #fff;
  animation: pulse 2s infinite;
  cursor: pointer;
  pointer-events: all;
}

.detection-marker.excavator {
  background: linear-gradient(45deg, #ff6b6b, #ff8e8e);
  box-shadow: 0 0 20px rgba(255, 107, 107, 0.6);
}

.detection-marker.loader {
  background: linear-gradient(45deg, #4ecdc4, #6dd5ed);
  box-shadow: 0 0 20px rgba(78, 205, 196, 0.6);
}

.detection-marker.truck {
  background: linear-gradient(45deg, #45b7d1, #96c7ed);
  box-shadow: 0 0 20px rgba(69, 183, 209, 0.6);
}

.marker-label {
  position: absolute;
  top: -25px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  border: 1px solid rgba(0, 212, 255, 0.3);
}

.confidence-label {
  position: absolute;
  top: -45px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 255, 136, 0.9);
  color: #000;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: bold;
  white-space: nowrap;
}

.map-info-panel {
  position: absolute;
  bottom: 20px;
  left: var(--left-panel-occupy, 344px);
  display: flex;
  gap: 15px;
  z-index: 5;
  pointer-events: none;
}

.map-info-panel .info-card {
  pointer-events: auto;
}

.info-card {
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 8px;
  padding: 15px;
  min-width: 150px;
}

.info-title {
  font-size: 14px;
  font-weight: bold;
  color: #00d4ff;
  margin-bottom: 10px;
  text-align: center;
}

.info-content {
  font-size: 12px;
  color: #e0e0e0;
  line-height: 1.6;
}

@keyframes pulse {

  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }

  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .drone-controls {
    left: 10px;
    top: 10px;
  }

  .map-controls {
    right: 10px;
    top: 10px;
  }

  .map-info-panel {
    bottom: 10px;
    left: var(--left-panel-occupy, 344px);
  }

  .drone-panel {
    min-width: 150px;
  }
}

/* 站点信息显示样式 */
.station-info-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2000;
  pointer-events: none;
}

.station-info-card {
  background: linear-gradient(135deg,
      rgba(0, 150, 255, 0.95),
      rgba(0, 100, 200, 0.95));
  border: 2px solid #00d4ff;
  border-radius: 15px;
  padding: 20px 25px;
  box-shadow: 0 8px 32px rgba(0, 212, 255, 0.3);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  gap: 15px;
  min-width: 300px;
  animation: stationSlideIn 0.5s ease-out;
}

.station-icon {
  font-size: 32px;
  animation: stationPulse 2s infinite;
}

.station-content {
  flex: 1;
}

.station-name {
  font-size: 18px;
  font-weight: bold;
  color: #ffffff;
  margin-bottom: 5px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.station-detail {
  font-size: 14px;
  color: #e0f6ff;
  opacity: 0.9;
}

@keyframes stationSlideIn {
  0% {
    opacity: 0;
    transform: translateY(-20px) scale(0.9);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes stationPulse {

  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.1);
  }
}


/* =============================================================================
   地图工具面板（图层 / 禁飞区 / 环绕）
   ============================================================================= */
.map-toolbar {
  position: absolute;
  top: 16px;
  right: 380px;
  z-index: 1100;
  width: 188px;
  padding: 14px;
  background: rgba(6, 14, 32, 0.16);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toolbar-section--params {
  gap: 6px;
}

.toolbar-title {
  font-size: 12px;
  font-weight: 600;
  color: #00d4ff;
  letter-spacing: 0.06em;
  text-shadow: 0 0 8px rgba(0, 212, 255, 0.35);
  padding-left: 2px;
}

.toolbar-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(0, 212, 255, 0.2),
    transparent
  );
}

.toolbar-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.map-tool-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 6px;
  background: rgba(12, 22, 48, 0.22);
  color: #b8dce8;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  cursor: pointer;
  transition: all 0.22s ease;
  white-space: nowrap;
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
  box-shadow: 0 0 10px rgba(0, 255, 136, 0.12);
}

.map-tool-btn--accent {
  justify-content: center;
  color: #ffb4b4;
  border-color: rgba(255, 90, 90, 0.35);
  background: rgba(255, 68, 68, 0.08);
}

.map-tool-btn--accent:hover {
  color: #ffd0d0;
  border-color: rgba(255, 120, 120, 0.55);
  background: rgba(255, 68, 68, 0.14);
}

.toolbar-hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(142, 184, 200, 0.75);
  text-align: center;
}

.tool-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(0, 212, 255, 0.35);
  box-shadow: 0 0 4px rgba(0, 212, 255, 0.2);
  transition: all 0.22s ease;
}

.tool-dot.on {
  background: #00ff88;
  box-shadow: 0 0 8px rgba(0, 255, 136, 0.7);
}

.orbit-params {
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
  transition: border-color 0.2s ease;
}

.param-field input:focus {
  border-color: rgba(0, 212, 255, 0.65);
}

.toolbar-title--toggle {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.route-panel,
.survey-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.survey-stats {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: #8eb8c8;
  text-align: center;
}

.route-select {
  width: 88px;
  padding: 4px 4px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 4px;
  color: #00d4ff;
  font-size: 11px;
  outline: none;
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

.route-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.45);
  color: #00d4ff;
  font-size: 14px;
  pointer-events: none;
}

.route-loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(0, 212, 255, 0.2);
  border-top-color: #00d4ff;
  border-radius: 50%;
  animation: route-spin 0.8s linear infinite;
}

@keyframes route-spin {
  to { transform: rotate(360deg); }
}

/* 
.minimap-box {
  position: absolute;
  top: 10px;
  left: 330px;
  z-index: 999;
  width: 320px;
  height: 320px;
  border: 2px solid #fff;
  background: #184cdb;
  margin-bottom: 10px;
  border-radius: 50%;
}
 */
</style>
