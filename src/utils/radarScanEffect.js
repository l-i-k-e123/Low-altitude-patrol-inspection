/**
 * radarScanEffect.js — 无人机锥形雷达扫描特效
 *
 * 作用：为飞行中的无人机创建向下扩散的圆锥扫描视觉效果，
 *       包含半透明圆柱体 + 多层动态扫描环（PolylineGlow 动画）。
 *
 * 主要导出：
 *   createDroneConeScan(layer, { id, getPosition }) — 创建跟随无人机的扫描特效
 *   clearDroneConeScan / clearAllDroneConeScans     — 清除单个/全部扫描
 *   createRadarScanEffect (deprecated)              — 旧版静态扫描，兼容保留
 *
 * 被谁使用：Enhanced3DMap.vue（syncDroneVisualEffects）
 */
import Cesium from '@/utils/cesiumCompat';
import { MARKER_THEME_ONLINE } from "./mapMarkerEffects";

const SCAN_CYCLE_MS = 2800;
const SWEEP_RING_COUNT = 5;
const CONE_BOTTOM_RADIUS = 180;
const CONE_TOP_RADIUS = 6;
const CONE_ALPHA_BASE = 0.16;
const CONE_ALPHA_PULSE = 0.1;
const CIRCLE_SEGMENTS = 64;

const PRIMARY = () => Cesium.Color.fromCssColorString(MARKER_THEME_ONLINE.primary);
const ACCENT = () => Cesium.Color.fromCssColorString(MARKER_THEME_ONLINE.accent);

function nowSec() {
  return performance.now() / 1000;
}

function ringPhase(ringIndex) {
  const offset = (SCAN_CYCLE_MS / SWEEP_RING_COUNT) * ringIndex;
  return ((performance.now() + offset) % SCAN_CYCLE_MS) / SCAN_CYCLE_MS;
}

function sweepT(ringIndex) {
  return ringPhase(ringIndex);
}

/** t=0 锥顶小圈（机身下），t=1 锥底大圈（近地面） */
function coneRadiusAt(t) {
  return CONE_TOP_RADIUS + (CONE_BOTTOM_RADIUS - CONE_TOP_RADIUS) * t;
}

function sweepAlpha(t) {
  if (t < 0.06) return t / 0.06;
  if (t > 0.9) return Math.max(0, (1 - t) / 0.1);
  return 1;
}

function lerpThemeColor(mix, alpha) {
  return Cesium.Color.lerp(PRIMARY(), ACCENT(), mix, new Cesium.Color()).withAlpha(
    alpha
  );
}

function getSweepColor(ringIndex) {
  const t = sweepT(ringIndex);
  const a = sweepAlpha(t) * (0.82 + 0.18 * Math.sin(nowSec() * 4.5 + ringIndex));
  const mix = 0.45 + 0.55 * Math.sin(nowSec() * 2.4 + ringIndex * 0.35);
  return lerpThemeColor(mix, Cesium.Math.clamp(a, 0, 0.98));
}

function readApex(getPosition) {
  const p = getPosition?.() || {};
  return {
    lon: p.lng ?? p.lon ?? 104.0668,
    lat: p.lat ?? 30.5728,
    height: Math.max(p.height ?? 600, 20),
  };
}

function buildHorizCirclePositions(lon, lat, heightM, radiusM) {
  const positions = [];
  const latRad = Cesium.Math.toRadians(lat);
  const mPerDegLon = 111319 * Math.cos(latRad);
  const mPerDegLat = 111319;

  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const ang = (i / CIRCLE_SEGMENTS) * Cesium.Math.TWO_PI;
    const dLon = (radiusM * Math.cos(ang)) / mPerDegLon;
    const dLat = (radiusM * Math.sin(ang)) / mPerDegLat;
    positions.push(
      Cesium.Cartesian3.fromDegrees(lon + dLon, lat + dLat, heightM)
    );
  }
  return positions;
}

function createDynamicSweepRing(layer, id, ringIndex, getPosition) {
  const positionsProp = new Cesium.CallbackProperty(() => {
    const apex = readApex(getPosition);
    const t = sweepT(ringIndex);
    const r = Math.max(coneRadiusAt(t), 2);
    const drop = apex.height * t;
    const h = Math.max(apex.height - drop, 1);
    return buildHorizCirclePositions(apex.lon, apex.lat, h, r);
  }, false);

  const ringLine = layer.entities.add({
    id: `drone_cone_sweep_${id}_${ringIndex}`,
    polyline: {
      positions: positionsProp,
      width: new Cesium.CallbackProperty(() => {
        const t = sweepT(ringIndex);
        return 2.8 + sweepAlpha(t) * 3.5;
      }, false),
      material: new Cesium.PolylineGlowMaterialProperty({
        color: new Cesium.CallbackProperty(() => getSweepColor(ringIndex), false),
        glowPower: 0.32,
        taperPower: 0.35,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  const innerLine = layer.entities.add({
    id: `drone_cone_sweep_inner_${id}_${ringIndex}`,
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        const apex = readApex(getPosition);
        const t = sweepT(ringIndex);
        const r = Math.max(coneRadiusAt(t) * 0.86, 2);
        const drop = apex.height * t;
        const h = Math.max(apex.height - drop, 1);
        return buildHorizCirclePositions(apex.lon, apex.lat, h, r);
      }, false),
      width: 1.4,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const c = getSweepColor(ringIndex);
          return c.withAlpha(c.alpha * 0.38);
        }, false)
      ),
      arcType: Cesium.ArcType.NONE,
    },
  });

  return [ringLine, innerLine];
}

/**
 * 跟随无人机的向下圆锥扫描特效（巡航时使用）
 * @param {Cesium.CustomDataSource} layer
 * @param {{ id: string, getPosition: () => { lng, lat, height } }} options
 */
export function createDroneConeScan(layer, { id, getPosition }) {
  const entities = [];

  const cone = layer.entities.add({
    id: `drone_cone_body_${id}`,
    position: new Cesium.CallbackProperty(() => {
      const apex = readApex(getPosition);
      return Cesium.Cartesian3.fromDegrees(
        apex.lon,
        apex.lat,
        apex.height * 0.5
      );
    }, false),
    cylinder: {
      length: new Cesium.CallbackProperty(() => readApex(getPosition).height, false),
      topRadius: CONE_TOP_RADIUS,
      bottomRadius: CONE_BOTTOM_RADIUS,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const pulse = CONE_ALPHA_BASE + CONE_ALPHA_PULSE * Math.sin(nowSec() * 2.4);
          const mix = 0.5 + 0.5 * Math.sin(nowSec() * 1.8);
          return lerpThemeColor(mix, pulse);
        }, false)
      ),
      outline: false,
      numberOfVerticalLines: 16,
    },
  });
  entities.push(cone);

  const apexMarker = layer.entities.add({
    id: `drone_cone_apex_${id}`,
    position: new Cesium.CallbackProperty(() => {
      const apex = readApex(getPosition);
      return Cesium.Cartesian3.fromDegrees(apex.lon, apex.lat, apex.height);
    }, false),
    point: {
      pixelSize: 6,
      color: new Cesium.CallbackProperty(() => {
        const mix = 0.5 + 0.5 * Math.sin(nowSec() * 3);
        return lerpThemeColor(mix, 0.85);
      }, false),
      outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  entities.push(apexMarker);

  for (let i = 0; i < SWEEP_RING_COUNT; i++) {
    entities.push(...createDynamicSweepRing(layer, id, i, getPosition));
  }

  return {
    id,
    entities,
    destroy() {
      entities.forEach((e) => {
        if (layer.entities.contains(e)) {
          layer.entities.remove(e);
        }
      });
    },
  };
}

/** @deprecated 点击用静态扫描，请用 createDroneConeScan */
export function createRadarScanEffect(_viewer, layer, spec) {
  const { id, lon, lat, height } = spec;
  return createDroneConeScan(layer, {
    id,
    getPosition: () => ({ lng: lon, lat, height }),
  });
}

export function clearRadarScan(scan) {
  scan?.destroy?.();
}

export function clearDroneConeScan(scanMap, droneId) {
  const scan = scanMap.get(droneId);
  if (scan) {
    scan.destroy();
    scanMap.delete(droneId);
  }
}

export function clearAllDroneConeScans(scanMap) {
  for (const id of [...scanMap.keys()]) {
    clearDroneConeScan(scanMap, id);
  }
}
