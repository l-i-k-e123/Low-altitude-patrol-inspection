/**
 * safetBuffer.js — 地铁保护区缓冲与安全研判（基于 Turf.js）
 *
 * 作用：对地铁线路 GeoJSON 做缓冲区生成、点到线路距离计算、
 *       车辆风险等级分类，以及用户手绘禁飞区多边形渲染。
 *
 * 主要导出：
 *   filterTargetLines(geojson, keywords)  — 按线路名筛选 Feature
 *   buildBuffer(lineFc, distanceMeters)   — 生成固定米数缓冲区
 *   calcMinDistanceToLines / classifyRiskByDistance — 距离与风险分级
 *   evaluateVehicleRisk(lngLat, lines, buffer) — 综合研判（是否在缓冲区内、是否告警）
 *   noflyzone(zone, Cesium, layer)        — 将手绘多边形渲染为闪烁禁飞区
 *
 * 被谁使用：Enhanced3DMap.vue（安全缓冲区、禁飞区、违规检测上报）
 */
  import * as turf from "@turf/turf";
  // import * as Cesium from '@/utils/cesiumCompat';


/**
 * @param {Object} rawGeojson FeatureCollection
 * @param {string[]} lineNameKeywords 例如 ["1号线", "2号线", "19号"]
 */
export function filterTargetLines(rawGeojson, lineNameKeywords = []) {
  if (!rawGeojson || !Array.isArray(rawGeojson.features)) {
    return turf.featureCollection([]);
  }

  const features = rawGeojson.features.filter((f) => {
    if (!f || !f.geometry) return false;
    const gType = f.geometry.type;
    if (gType !== "LineString" && gType !== "MultiLineString") return false;

    if (!lineNameKeywords.length) return true;

    const name = String(f?.properties?.name ?? "");
    return lineNameKeywords.some((kw) => name.includes(kw));
  });

  return turf.featureCollection(features);
}

/**
 * 生成固定距离缓冲区（米）
 * @param {Object} lineFeatureCollection 线路FeatureCollection
 * @param {number} distanceMeters 缓冲距离（米）
 */
export function buildBuffer(lineFeatureCollection, distanceMeters = 30) {
  return turf.buffer(lineFeatureCollection, distanceMeters, {
    units: "meters",
    steps: 16,
  });
}

/**
 * 计算点到所有线路的最小距离（米）
 * @param {[number, number]} lngLat [lng, lat]
 * @param {Object} lineFeatureCollection 线路FeatureCollection
 */
export function calcMinDistanceToLines(lngLat, lineFeatureCollection) {
  const pt = turf.point(lngLat);
  let min = Infinity;

  for (const f of lineFeatureCollection.features || []) {
    const d = turf.pointToLineDistance(pt, f, { units: "meters" });
    if (d < min) min = d;
  }

  return Number.isFinite(min) ? min : -1;
}

/**
 * 距离分级（固定阈值版）
 * @param {number} distanceMeters
 */
export function classifyRiskByDistance(distanceMeters) {
  if (distanceMeters < 0) return "未知";
  if (distanceMeters <= 10) return "高危";
  if (distanceMeters <= 20) return "中危";
  if (distanceMeters <= 30) return "低危";
  return "安全";
}

/**
 * 车辆点位风险评估
 * @param {[number, number]} lngLat [lng, lat]
 * @param {Object} lineFeatureCollection 线路FeatureCollection
 * @param {Object} bufferFeature 缓冲区Feature或FeatureCollection
 */
export function evaluateVehicleRisk(lngLat, lineFeatureCollection, bufferFeature) {
  const pt = turf.point(lngLat);

  // booleanPointInPolygon 需要 Polygon 或 MultiPolygon，
  // 如果传的是 FeatureCollection，就逐个判断
  let isInBuffer = false;

  if (bufferFeature?.type === "FeatureCollection") {
    for (const f of bufferFeature.features || []) {
      if (turf.booleanPointInPolygon(pt, f)) {
        isInBuffer = true;
        break;
      }
    }
  } else if (bufferFeature?.type === "Feature") {
    isInBuffer = turf.booleanPointInPolygon(pt, bufferFeature);
  }
  
  const distance = calcMinDistanceToLines(lngLat, lineFeatureCollection);
  const riskLevel = classifyRiskByDistance(distance);

  return {
    isInBuffer,
    distanceToTrack: distance >= 0 ? Number(distance.toFixed(2)) : -1,
    riskLevel,
    shouldAlert: isInBuffer && riskLevel !== "安全",
  };
}

export const noflyzone = async (zone, Cesium, noflyLayer) => {
  const coordinates = zone.map((point) =>
    Cesium.Cartesian3.fromDegrees(point[0], point[1])
  );
  noflyLayer.entities.add({
    polygon: {
      hierarchy: coordinates,
      material: new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString("#ff0000").withAlpha(0.4)
      ),
      show: new Cesium.CallbackProperty(() => {
        return (Date.now() % 1000) < 500;
      }, false),
      outline: true,
      outlineColor: Cesium.Color.RED,
      outlineWidth: 3,
      height: 300,
      extrudedHeight: 320,
      clampToGround: false,
      perPositionHeight: false,
    },
  });
};