/**
 * mapLabelPopups.js — 无人机 / 人员 / 禁飞区 地图标签同步
 */
import Cesium from '@/utils/cesiumCompat';
import {
  createMapPopupManager,
  buildDroneLabelBody,
  buildPersonLabelBody,
  buildNoFlyLabelBody,
} from "./cesiumMapPopup";
import { AIRPORT_NO_FLY_ELLIPSES } from "./routeGeometry";

export { createMapPopupManager };

/**
 * @param {Cesium.Viewer} viewer
 */
export function createMapLabelManager(viewer) {
  return createMapPopupManager(viewer);
}

/**
 * 同步机场禁飞区标签（静态，始终显示）
 * @param {ReturnType<createMapPopupManager>} manager
 */
export function syncAirportNoFlyLabels(manager) {
  if (!manager) return;
  AIRPORT_NO_FLY_ELLIPSES.forEach((zone) => {
    const id = `nofly_${zone.lng}_${zone.lat}`;
    const position = Cesium.Cartesian3.fromDegrees(zone.lng, zone.lat, 220);
    manager.upsert({
      id,
      theme: "nofly",
      header: escapeLabel(zone.label || "机场禁飞区"),
      bodyHtml: buildNoFlyLabelBody({ radiusM: zone.radiusM }),
      getPosition: () => position,
      visible: true,
      offsetY: 0,
    });
  });
}

function escapeLabel(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** @type {Set<string>} */
const knownDroneLabelIds = new Set();
/** @type {Set<string>} */
const knownPersonLabelIds = new Set();

function removeStaleLabels(manager, prefix, activeIds, knownSet) {
  for (const id of [...knownSet]) {
    if (!activeIds.has(id)) {
      manager.remove(`${prefix}${id}`);
      knownSet.delete(id);
    }
  }
}

/**
 * 同步无人机与人员标签
 * @param {ReturnType<createMapPopupManager>} manager
 * @param {Cesium.Viewer} viewer
 * @param {{ personnel?: Array, droneEntries?: Array, personnelRegistry?: Map }} data
 * @param {{ flyingDroneIds?: Set<string> }} options
 */
export function syncFleetLabels(manager, viewer, data = {}, options = {}) {
  if (!manager || !viewer || viewer.isDestroyed()) return;

  const flyingDroneIds = options.flyingDroneIds || new Set();
  const activeDroneIds = new Set();
  const activePersonIds = new Set();
  const droneEntries = data.droneEntries || [];
  const personnel = (data.personnel || []).filter((p) => p.online);
  const personnelRegistry = data.personnelRegistry;

  droneEntries.forEach((entry) => {
    const fleetId = entry.fleetId || entry.id;
    if (!fleetId || !entry.model) return;

    const isFlying = flyingDroneIds.has(fleetId) || entry.isFlying;
    activeDroneIds.add(fleetId);
    knownDroneLabelIds.add(fleetId);

    manager.upsert({
      id: `drone_label_${fleetId}`,
      theme: "drone",
      header: escapeLabel(entry.name || "无人机"),
      bodyHtml: buildDroneLabelBody({ line: entry.line, battery: entry.battery }),
      getPosition: (time) => {
        const pos = entry.model.position;
        if (!pos) return null;
        const cartesian = typeof pos.getValue === "function" ? pos.getValue(time) : pos;
        if (!cartesian) return null;
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + 28);
      },
      visible: !isFlying,
      offsetY: 0,
    });
  });

  personnel.forEach((p) => {
    activePersonIds.add(p.id);
    knownPersonLabelIds.add(p.id);
    const marker = personnelRegistry?.get(p.id);
    const lon = p.lng ?? p.lon;
    const lat = p.lat;

    manager.upsert({
      id: `person_label_${p.id}`,
      theme: "person",
      header: escapeLabel(p.name || "巡检员"),
      bodyHtml: buildPersonLabelBody({ role: p.role, line: p.line, phone: p.phone }),
      getPosition: (time) => {
        if (marker?.icon?.position) {
          const pos = marker.icon.position;
          const cartesian = typeof pos.getValue === "function" ? pos.getValue(time) : pos;
          if (cartesian) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + 12);
          }
        }
        if (lon == null || lat == null) return null;
        return Cesium.Cartesian3.fromDegrees(lon, lat, 12);
      },
      visible: true,
      offsetY: 0,
    });
  });

  removeStaleLabels(manager, "drone_label_", activeDroneIds, knownDroneLabelIds);
  removeStaleLabels(manager, "person_label_", activePersonIds, knownPersonLabelIds);
}
