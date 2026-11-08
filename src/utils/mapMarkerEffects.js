/**
 * mapMarkerEffects.js — 地图标记与视觉特效
 *
 * 作用：管理 Cesium 地图上的 Entity 图层（人员、无人机、违规事件、禁飞区），
 *       包括 GLTF 模型加载、在线脉冲环、呼吸动画、机队数据同步等。
 *
 * 主要导出：
 *   initMarkerLayers(viewer)           — 初始化各 CustomDataSource 图层
 *   syncFleetMarkers(layers, fleet)    — 根据 Pinia 机队数据同步标记
 *   syncViolationMarkers / clear*      — 违规标记同步与清理
 *   setDronePulseVisible               — 控制无人机在线脉冲环显示
 *   ensureDroneOnlinePulseRings        — 为停驻无人机创建脉冲环
 *   MARKER_STATUS / DRONE_GLTF_URI 等  — 常量与默认配置
 *
 * 被谁使用：Enhanced3DMap.vue、radarScanEffect.js（主题色引用）
 */
import Cesium from '@/utils/cesiumCompat';

export const MARKER_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
};

/** 在线：青绿科技风 */
export const MARKER_THEME_ONLINE = {
  primary: "#00d4ff",
  accent: "#00ff88",
};

/** 离线：灰蓝低调 */
export const MARKER_THEME_OFFLINE = {
  primary: "#6b7b8c",
  accent: "#4a5568",
};

export const MARKER_THEME = MARKER_THEME_ONLINE;

const PULSE_PERIOD_MS = 2200;
const BREATH_PERIOD_MS = 2800;
const BREATH_AMPLITUDE_M = 1.2;

/** 轻量模式：关闭脉冲/呼吸动画（仍可使用 GLTF 模型） */
const LITE_MARKERS = import.meta.env.VITE_MAP_LITE_MARKERS !== 'false';

/** 是否加载 public/models 下 GLTF 无人机（默认 true） */
const USE_DRONE_GLTF = import.meta.env.VITE_DRONE_USE_GLTF !== 'false';

export const DRONE_GLTF_URI =
  import.meta.env.VITE_DRONE_GLTF_URI || '/models/d622d04ee8c44c33a169826bff15db55.gltf';

export const DRONE_GLTF_CONFIG = {
  scale: Number(import.meta.env.VITE_DRONE_GLTF_SCALE) || 12,
  minimumPixelSize: Number(import.meta.env.VITE_DRONE_GLTF_MIN_PX) || 48,
  maximumScale: Number(import.meta.env.VITE_DRONE_GLTF_MAX_SCALE) || 200,
  /** F600 模型原生即为水平姿态；勿再 pitch -90（会立起来） */
  pitchDeg: Number(import.meta.env.VITE_DRONE_GLTF_PITCH) || 0,
  rollDeg: Number(import.meta.env.VITE_DRONE_GLTF_ROLL) || 0,
};

export function droneOrientationQuaternion(lon, lat, height, headingRad = 0) {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  return Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(
      headingRad,
      Cesium.Math.toRadians(DRONE_GLTF_CONFIG.pitchDeg),
      Cesium.Math.toRadians(DRONE_GLTF_CONFIG.rollDeg),
    ),
  );
}

let droneModelPreloaded = false;

/** 预加载无人机 GLTF，避免首次同步机队时卡顿 */
export function preloadDroneGltf(viewer) {
  if (!USE_DRONE_GLTF || droneModelPreloaded || !viewer || viewer.isDestroyed?.()) return;
  droneModelPreloaded = true;
  const url = DRONE_GLTF_URI;
  if (typeof Cesium.Model?.fromGltfAsync === 'function') {
    Cesium.Model.fromGltfAsync({ url }).then((model) => {
      viewer.scene.primitives.add(model);
      viewer.scene.primitives.remove(model);
      model.destroy?.();
      console.info('[mapMarker] 无人机模型预加载完成:', url);
    }).catch((err) => {
      droneModelPreloaded = false;
      console.warn('[mapMarker] 无人机模型预加载失败:', url, err?.message || err);
    });
  }
}

/** 3 架无人机：2 在线 + 1 离线 */
export const DRONE_LIST = [
  {
    id: "uav_1",
    lon: 104.0668,
    lat: 30.5728,
    height: 420,
    withEffects: true,
    status: MARKER_STATUS.ONLINE,
  },
  {
    id: "uav_2",
    lon: 104.045,
    lat: 30.562,
    height: 380,
    withEffects: true,
    status: MARKER_STATUS.ONLINE,
  },
  {
    id: "uav_3",
    lon: 104.092,
    lat: 30.585,
    height: 600,
    withEffects: true,
    status: MARKER_STATUS.OFFLINE,
  },
];

function getTheme(status) {
  return status === MARKER_STATUS.OFFLINE
    ? MARKER_THEME_OFFLINE
    : MARKER_THEME_ONLINE;
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createDroneIconSvg(size = 56, status = MARKER_STATUS.ONLINE) {
  const { primary, accent } = getTheme(status);
  const muted = status === MARKER_STATUS.OFFLINE;
  const rotor = (cx, cy) =>
    `<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="${primary}" stroke-width="1" opacity="${muted ? 0.35 : 0.5}"/>
     <circle cx="${cx}" cy="${cy}" r="5.5" fill="${primary}" opacity="${muted ? 0.2 : 0.35}"/>
     <circle cx="${cx}" cy="${cy}" r="1.8" fill="${accent}" opacity="${muted ? 0.5 : 0.9}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 56 56">
    <g opacity="${muted ? 0.55 : 1}">
      <circle cx="28" cy="28" r="25" fill="none" stroke="${primary}" stroke-width="0.8" opacity="0.3"/>
      <g stroke="${primary}" stroke-width="1.6" stroke-linecap="round" opacity="0.7">
        <line x1="28" y1="28" x2="11" y2="11"/><line x1="28" y1="28" x2="45" y2="11"/>
        <line x1="28" y1="28" x2="11" y2="45"/><line x1="28" y1="28" x2="45" y2="45"/>
      </g>
      ${rotor(11, 11)}${rotor(45, 11)}${rotor(11, 45)}${rotor(45, 45)}
      <path d="M28 19 L33 28 L28 37 L23 28 Z" fill="#1a2535" stroke="${primary}" stroke-width="1.3"/>
      <circle cx="28" cy="28" r="2.2" fill="${accent}" opacity="0.85"/>
    </g>
  </svg>`;
}

function createPulseRingSvg(status = MARKER_STATUS.ONLINE) {
  const { primary, accent } = getTheme(status);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
    <circle cx="36" cy="36" r="30" fill="none" stroke="${primary}" stroke-width="2.2" opacity="0.85"/>
    <circle cx="36" cy="36" r="24" fill="none" stroke="${accent}" stroke-width="0.9" opacity="0.4"/>
    <circle cx="36" cy="36" r="2" fill="${accent}" opacity="0.55"/>
  </svg>`;
}

/** 离线无人机：静态虚线环 */
function createOfflineDroneRingSvg() {
  const { primary } = MARKER_THEME_OFFLINE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="26" fill="none" stroke="${primary}" stroke-width="1.5"
      stroke-dasharray="6 5" opacity="0.45"/>
    <circle cx="32" cy="32" r="18" fill="${primary}" opacity="0.06"/>
  </svg>`;
}

function createPersonIconSvg(size = 48, status = MARKER_STATUS.ONLINE) {
  const { primary, accent } = getTheme(status);
  const muted = status === MARKER_STATUS.OFFLINE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
    <g opacity="${muted ? 0.5 : 1}">
      <ellipse cx="24" cy="44" rx="9" ry="2.5" fill="#000" opacity="0.18"/>
      <path d="M24 6 C15.2 6 8 13.2 8 22c0 9.8 16 20 16 20s16-10.2 16-20C40 13.2 32.8 6 24 6z"
        fill="#1a2535" stroke="${primary}" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="24" cy="20" r="4.2" fill="${primary}"/>
      <path d="M17.5 27.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5v5.5H17.5z" fill="${accent}" opacity="0.8"/>
    </g>
  </svg>`;
}

function createPersonGlowSvg(status = MARKER_STATUS.ONLINE) {
  const { primary, accent } = getTheme(status);
  if (status === MARKER_STATUS.OFFLINE) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <ellipse cx="32" cy="36" rx="18" ry="14" fill="${primary}" opacity="0.12"/>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <defs>
      <radialGradient id="pg" cx="50%" cy="55%" r="50%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"/>
        <stop offset="55%" stop-color="${primary}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${primary}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="32" cy="36" rx="22" ry="18" fill="url(#pg)"/>
    <ellipse cx="32" cy="36" rx="14" ry="11" fill="${accent}" opacity="0.08"/>
  </svg>`;
}

function pulsePhase(phaseOffset = 0) {
  return ((performance.now() + phaseOffset) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
}

function breathOffset() {
  return Math.sin((performance.now() / BREATH_PERIOD_MS) * Math.PI * 2) * BREATH_AMPLITUDE_M;
}

function createPulseScaleProperty(phaseOffset) {
  return new Cesium.CallbackProperty(() => {
    const t = pulsePhase(phaseOffset);
    return 0.35 + t * 2.2;
  }, false);
}

function createPulseColorProperty(phaseOffset, baseColor) {
  return new Cesium.CallbackProperty(() => {
    const t = pulsePhase(phaseOffset);
    return baseColor.withAlpha((1 - t) * 0.65);
  }, false);
}

function createPositionProperty(lon, lat, height, status) {
  if (!LITE_MARKERS && status === MARKER_STATUS.ONLINE) {
    return new Cesium.CallbackProperty(() => {
      const h = height + breathOffset();
      return Cesium.Cartesian3.fromDegrees(lon, lat, h);
    }, false);
  }
  return Cesium.Cartesian3.fromDegrees(lon, lat, height);
}

export function setDronePulseVisible(drone, visible) {
  if (!drone?.rings) return;
  drone.rings.forEach((ring) => {
    if (ring) ring.show = visible;
  });
}

function upsertEntity(layer, entityOptions) {
  if (entityOptions?.id) {
    layer.entities.removeById(entityOptions.id);
  }
  return layer.entities.add(entityOptions);
}

function recoverDronePulseRings(layer, id) {
  const rings = [];
  for (let i = 0; i < 3; i += 1) {
    const entity = layer.entities.getById(`drone_pulse_${id}_${i}`);
    if (entity) rings.push(entity);
  }
  return rings.length === 3 ? rings : [];
}

function syncDroneRegistryRings(registryKey, rings, withEffects = true) {
  if (!registryKey || !rings?.length) return;
  const existing = droneRegistry.get(registryKey);
  if (existing) {
    existing.rings = rings;
    existing.withEffects = withEffects;
  }
}

/** 巡航结束恢复上线脉冲环（若创建时未带环） */
export function ensureDroneOnlinePulseRings(layers, entry, lon, lat, height) {
  if (!layers?.droneLayer || !entry) return;
  if (entry.rings?.length) return;

  const registryKey = entry.fleetId ?? entry.id;
  const registryEntry = droneRegistry.get(registryKey);
  if (registryEntry?.rings?.length) {
    entry.rings = registryEntry.rings;
    entry.withEffects = true;
    return;
  }

  const recovered = recoverDronePulseRings(layers.droneLayer, entry.id);
  if (recovered.length) {
    entry.rings = recovered;
    entry.withEffects = true;
    syncDroneRegistryRings(registryKey, recovered);
    return;
  }

  const position = createPositionProperty(lon, lat, height, MARKER_STATUS.ONLINE);
  entry.rings = addDroneOnlinePulseRings(layers.droneLayer, position, entry.id);
  entry.withEffects = true;
  syncDroneRegistryRings(registryKey, entry.rings);
}

export function initMarkerLayers(viewer) {
  const radarScanLayer = new Cesium.CustomDataSource("radar-scan");
  const droneLayer = new Cesium.CustomDataSource("drone-effects");
  const personnelLayer = new Cesium.CustomDataSource("personnel-effects");
  const noflyLayer = new Cesium.CustomDataSource("nofly-zone");
  const airportNoflyLayer = new Cesium.CustomDataSource("airport-nofly");

  viewer.dataSources.add(radarScanLayer);
  viewer.dataSources.add(droneLayer);
  viewer.dataSources.add(personnelLayer);
  viewer.dataSources.add(airportNoflyLayer);

  return {
    radarScanLayer,
    droneLayer,
    personnelLayer,
    noflyLayer,
    airportNoflyLayer,
    ensureNoflyLayerOnTop() {
      if (!viewer.dataSources.contains(noflyLayer)) {
        viewer.dataSources.add(noflyLayer);
      } else {
        viewer.dataSources.raiseToTop(noflyLayer);
      }
    },
    destroy() {
      [radarScanLayer, droneLayer, personnelLayer, noflyLayer, airportNoflyLayer].forEach((ds) => {
        if (viewer && !viewer.isDestroyed() && viewer.dataSources.contains(ds)) {
          viewer.dataSources.remove(ds, true);
        }
      });
    },
  };
}

function addDroneOnlinePulseRings(layer, position, id) {
  const primaryColor = Cesium.Color.fromCssColorString(MARKER_THEME_ONLINE.primary);
  const accentColor = Cesium.Color.fromCssColorString(MARKER_THEME_ONLINE.accent);
  const phases = [0, PULSE_PERIOD_MS * 0.33, PULSE_PERIOD_MS * 0.66];
  const pulseRingUrl = svgToDataUrl(createPulseRingSvg(MARKER_STATUS.ONLINE));
  const rings = [];

  phases.forEach((phaseOffset, i) => {
    rings.push(
      upsertEntity(layer, {
        id: `drone_pulse_${id}_${i}`,
        position,
        billboard: {
          image: pulseRingUrl,
          scale: createPulseScaleProperty(phaseOffset),
          color: createPulseColorProperty(
            phaseOffset,
            i % 2 === 0 ? primaryColor : accentColor
          ),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.NONE,
        },
      })
    );
  });
  return rings;
}

function addDroneOfflineRing(layer, position, id) {
  const gray = Cesium.Color.fromCssColorString(MARKER_THEME_OFFLINE.primary);
  return upsertEntity(layer, {
    id: `drone_offline_${id}`,
    position,
    billboard: {
      image: svgToDataUrl(createOfflineDroneRingSvg()),
      scale: 1.15,
      color: gray.withAlpha(0.55),
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.NONE,
    },
  });
}

/**
 * GLTF 无人机（模型路径：public/models/…，Vite 静态资源 /models/…）
 * @param {{ withEffects?: boolean, status?: string }} spec
 */
export function addDroneGltfMarker(layer, spec, modelUri = DRONE_GLTF_URI) {
  const {
    id,
    lon,
    lat,
    height,
    withEffects = LITE_MARKERS ? false : true,
    status = MARKER_STATUS.ONLINE,
  } = spec;
  const theme = getTheme(status);
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  const isOnline = status === MARKER_STATUS.ONLINE;

  if (!USE_DRONE_GLTF) {
    const icon = upsertEntity(layer, {
      id: `drone_model_${id}`,
      position,
      billboard: {
        image: svgToDataUrl(createDroneIconSvg(56, status)),
        scale: isOnline ? 1.1 : 0.95,
        color: Cesium.Color.fromCssColorString(theme.primary).withAlpha(isOnline ? 0.95 : 0.5),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.NONE,
      },
    });
    return { model: icon, rings: [], status, withEffects: false, id };
  }

  const model = upsertEntity(layer, {
    id: `drone_model_${id}`,
    position,
    orientation: droneOrientationQuaternion(lon, lat, height),
    model: {
      uri: modelUri,
      scale: DRONE_GLTF_CONFIG.scale,
      minimumPixelSize: DRONE_GLTF_CONFIG.minimumPixelSize,
      maximumScale: DRONE_GLTF_CONFIG.maximumScale,
      heightReference: Cesium.HeightReference.NONE,
      silhouetteColor: Cesium.Color.fromCssColorString(theme.primary),
      silhouetteSize: withEffects ? (isOnline ? 1.2 : 0.5) : 0,
      allowPicking: isOnline,
      runAnimations: true,
      incrementallyLoadTextures: true,
    },
  });

  let rings = [];
  if (withEffects) {
    if (isOnline) {
      rings = addDroneOnlinePulseRings(layer, position, id);
    } else {
      rings = [addDroneOfflineRing(layer, position, id)];
    }
  }

  if (import.meta.env.DEV) {
    console.info('[mapMarker] 无人机 GLTF 已创建:', modelUri, `(${lon.toFixed(4)}, ${lat.toFixed(4)}, ${height}m)`);
  }

  return { model, rings, status, withEffects, id };
}

export function addPersonnelMarker(layer, spec) {
  const { id, lon, lat, status = MARKER_STATUS.ONLINE } = spec;
  const isOnline = status === MARKER_STATUS.ONLINE;
  const groundHeight = 0;
  const position = createPositionProperty(lon, lat, groundHeight, status);
  const theme = getTheme(status);

  const glowScale = isOnline ? 1.35 : 1.0;
  const glowAlpha = isOnline ? 0.92 : 0.35;

  const glow = layer.entities.add({
    id: `person_glow_${id}`,
    position,
    billboard: {
      image: svgToDataUrl(createPersonGlowSvg(status)),
      scale: glowScale,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: LITE_MARKERS
        ? Cesium.HeightReference.NONE
        : Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      color: Cesium.Color.WHITE.withAlpha(glowAlpha),
    },
  });

  const icon = layer.entities.add({
    id: `person_${id}`,
    position,
    billboard: {
      image: svgToDataUrl(createPersonIconSvg(48, status)),
      scale: isOnline ? 1.0 : 0.92,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: LITE_MARKERS
        ? Cesium.HeightReference.NONE
        : Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      color: isOnline
        ? Cesium.Color.WHITE
        : Cesium.Color.fromCssColorString(theme.primary).withAlpha(0.75),
    },
  });

  return { icon, glow, status };
}

/** 3 名工作人员：2 在线 + 1 离线 */
export const DEMO_PERSONNEL = [
  { id: "patrol_1", lon: 104.063, lat: 30.571, status: MARKER_STATUS.ONLINE },
  { id: "patrol_2", lon: 104.069, lat: 30.576, status: MARKER_STATUS.ONLINE },
  { id: "patrol_3", lon: 104.055, lat: 30.568, status: MARKER_STATUS.OFFLINE },
];

export function loadPersonnelMarkers(layers) {
  DEMO_PERSONNEL.forEach((p) => addPersonnelMarker(layers.personnelLayer, p));
}

export function loadDroneMarkers(layers) {
  return DRONE_LIST.map((d) => addDroneGltfMarker(layers.droneLayer, d));
}

const personnelRegistry = new Map();
const droneRegistry = new Map();

/** 供地图标签同步读取人员标记实体 */
export function getPersonnelRegistry() {
  return personnelRegistry;
}

function removePersonnelEntry(layers, id) {
  const entry = personnelRegistry.get(id);
  if (!entry) return;
  const layer = layers.personnelLayer;
  if (entry.glow) layer.entities.remove(entry.glow);
  if (entry.icon) layer.entities.remove(entry.icon);
  personnelRegistry.delete(id);
}

function removeDroneEntry(layers, id) {
  const entry = droneRegistry.get(id);
  if (!entry) return;
  const layer = layers.droneLayer;
  if (entry.model) layer.entities.remove(entry.model);
  entry.rings?.forEach((ring) => {
    if (ring) layer.entities.remove(ring);
  });
  droneRegistry.delete(id);
}

function updateEntityPosition(entity, lon, lat, height = 0, online = true) {
  if (!entity?.position) return;
  if (online) {
    entity.position = createPositionProperty(lon, lat, height, MARKER_STATUS.ONLINE);
  } else {
    entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  }
}

/**
 * 根据后端机队数据同步地图标记（仅 online=true 的显示为在线态）
 */
export function syncFleetMarkers(layers, fleet = {}, options = {}) {
  if (!layers?.personnelLayer || !layers?.droneLayer) {
    return { drones: [] };
  }

  const skipDroneIds = options.skipDroneIds || new Set();
  const flyingDroneIds = options.flyingDroneIds || new Set();
  const personnel = (fleet.personnel || []).filter((p) => p.online);
  const drones = (fleet.drones || []).filter((d) => d.online);

  const personnelIds = new Set(personnel.map((p) => p.id));
  const droneIds = new Set(drones.map((d) => d.id));

  for (const id of [...personnelRegistry.keys()]) {
    if (!personnelIds.has(id)) removePersonnelEntry(layers, id);
  }
  for (const id of [...droneRegistry.keys()]) {
    if (!droneIds.has(id)) removeDroneEntry(layers, id);
  }

  personnel.forEach((p) => {
    const lon = p.lng ?? p.lon;
    const lat = p.lat;
    if (lon == null || lat == null) return;

    const existing = personnelRegistry.get(p.id);
    if (existing) {
      updateEntityPosition(existing.icon, lon, lat, 0, true);
      updateEntityPosition(existing.glow, lon, lat, 0, true);
      return;
    }

    const marker = addPersonnelMarker(layers.personnelLayer, {
      id: p.id,
      lon,
      lat,
      status: MARKER_STATUS.ONLINE,
    });
    personnelRegistry.set(p.id, marker);
  });

  const syncedDrones = [];
  drones.forEach((d) => {
    const lon = d.lng ?? d.lon;
    const lat = d.lat;
    const height = d.height ?? 600;
    if (lon == null || lat == null) return;

    let entry = droneRegistry.get(d.id);
    if (entry && skipDroneIds.has(d.id)) {
      syncedDrones.push({
        ...entry,
        fleetId: d.id,
        name: d.name,
        line: d.line,
        battery: d.battery,
        status: MARKER_STATUS.ONLINE,
        isFlying: flyingDroneIds.has(d.id),
      });
      return;
    }

    if (entry) {
      updateEntityPosition(entry.model, lon, lat, height, true);
      if (!flyingDroneIds.has(d.id)) {
        entry.rings?.forEach((ring) => updateEntityPosition(ring, lon, lat, height, true));
      }
      syncedDrones.push({
        ...entry,
        fleetId: d.id,
        name: d.name,
        line: d.line,
        battery: d.battery,
        status: MARKER_STATUS.ONLINE,
        isFlying: flyingDroneIds.has(d.id),
      });
      return;
    }

    const isFlying = flyingDroneIds.has(d.id);
    entry = addDroneGltfMarker(layers.droneLayer, {
      id: d.id,
      lon,
      lat,
      height,
      withEffects: LITE_MARKERS ? false : !isFlying,
      status: MARKER_STATUS.ONLINE,
    });
    droneRegistry.set(d.id, entry);
    syncedDrones.push({
      ...entry,
      fleetId: d.id,
      name: d.name,
      line: d.line,
      battery: d.battery,
      isFlying,
    });
  });

  return { drones: syncedDrones };
}

export function clearFleetMarkers(layers) {
  for (const id of [...personnelRegistry.keys()]) {
    removePersonnelEntry(layers, id);
  }
  for (const id of [...droneRegistry.keys()]) {
    removeDroneEntry(layers, id);
  }
}

const violationRegistry = new Map();

function createViolationAlertSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="28" fill="none" stroke="#ff4444" stroke-width="3" opacity="0.9"/>
    <circle cx="32" cy="32" r="20" fill="#ff4444" opacity="0.15"/>
    <text x="32" y="38" text-anchor="middle" fill="#ff4444" font-size="28" font-weight="bold">!</text>
  </svg>`;
}

function createViolationPulseScale() {
  return new Cesium.CallbackProperty(() => {
    const t = pulsePhase(0);
    return 0.8 + t * 0.6;
  }, false);
}

function createViolationPulseColor() {
  const red = Cesium.Color.fromCssColorString("#ff4444");
  return new Cesium.CallbackProperty(() => {
    const t = pulsePhase(0);
    return red.withAlpha(0.5 + (1 - t) * 0.5);
  }, false);
}

function removeViolationEntry(layers, id) {
  const entry = violationRegistry.get(id);
  if (!entry) return;
  if (entry.ring) layers.droneLayer.entities.remove(entry.ring);
  if (entry.icon) layers.droneLayer.entities.remove(entry.icon);
  violationRegistry.delete(id);
}

/** 同步违规高亮标记（highlight=true 且未处置） */
export function syncViolationMarkers(layers, violations = []) {
  if (!layers?.droneLayer) return;

  const active = violations.filter((v) => v.highlight !== false && v.status !== "done");
  const activeIds = new Set(active.map((v) => v.id));

  for (const id of [...violationRegistry.keys()]) {
    if (!activeIds.has(id)) removeViolationEntry(layers, id);
  }

  const alertUrl = svgToDataUrl(createViolationAlertSvg());

  active.forEach((v) => {
    const lon = v.lng ?? v.lon;
    const lat = v.lat;
    if (lon == null || lat == null) return;

    if (violationRegistry.has(v.id)) return;

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 8);
    const ring = layers.droneLayer.entities.add({
      id: `violation_ring_${v.id}`,
      position,
      billboard: {
        image: alertUrl,
        scale: createViolationPulseScale(),
        color: createViolationPulseColor(),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    const icon = layers.droneLayer.entities.add({
      id: `violation_${v.id}`,
      position,
      label: {
        text: v.plate || "违规",
        font: "14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#ff4444"),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -36),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    violationRegistry.set(v.id, { ring, icon });
  });
}

export function clearViolationMarkers(layers) {
  for (const id of [...violationRegistry.keys()]) {
    removeViolationEntry(layers, id);
  }
}

const lightBeamRegistry = new Map();

function createBeamPulseColor(baseColor) {
  return new Cesium.ColorMaterialProperty(
    new Cesium.CallbackProperty(() => {
      const t = pulsePhase(0);
      return baseColor.withAlpha(0.25 + (1 - t) * 0.35);
    }, false)
  );
}

/** 违规位置光柱冲天效果 */
export function createViolationLightBeam(viewer, beamId, lng, lat) {
  if (!viewer || lng == null || lat == null) return null;
  removeViolationLightBeam(viewer, beamId);

  const baseColor = Cesium.Color.fromCssColorString("#ff6600");
  const glowColor = Cesium.Color.fromCssColorString("#ffaa00");
  const beamHeight = 900;
  const position = Cesium.Cartesian3.fromDegrees(lng, lat, beamHeight / 2);

  const cylinder = viewer.entities.add({
    id: `violation_beam_${beamId}`,
    position,
    cylinder: {
      length: beamHeight,
      topRadius: 8,
      bottomRadius: 55,
      material: createBeamPulseColor(baseColor),
      outline: true,
      outlineColor: glowColor.withAlpha(0.85),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  const core = viewer.entities.add({
    id: `violation_beam_core_${beamId}`,
    position: Cesium.Cartesian3.fromDegrees(lng, lat, beamHeight * 0.55),
    cylinder: {
      length: beamHeight * 0.85,
      topRadius: 3,
      bottomRadius: 18,
      material: createBeamPulseColor(glowColor),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  const ring = viewer.entities.add({
    id: `violation_beam_ring_${beamId}`,
    position: Cesium.Cartesian3.fromDegrees(lng, lat, 4),
    ellipse: {
      semiMinorAxis: 45,
      semiMajorAxis: 45,
      height: 2,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const t = pulsePhase(0);
          return glowColor.withAlpha(0.35 + (1 - t) * 0.45);
        }, false)
      ),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  lightBeamRegistry.set(beamId, { cylinder, core, ring });
  viewer.scene.requestRender();
  return { cylinder, core, ring };
}

export function removeViolationLightBeam(viewer, beamId) {
  const entry = lightBeamRegistry.get(beamId);
  if (!entry || !viewer) return;
  if (entry.cylinder) viewer.entities.remove(entry.cylinder);
  if (entry.core) viewer.entities.remove(entry.core);
  if (entry.ring) viewer.entities.remove(entry.ring);
  lightBeamRegistry.delete(beamId);
}

export function clearViolationLightBeams(viewer) {
  for (const id of [...lightBeamRegistry.keys()]) {
    removeViolationLightBeam(viewer, id);
  }
}
