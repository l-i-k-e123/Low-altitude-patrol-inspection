/**
 * cesiumMapPopup.js — Cesium 地图 HTML 浮层标签
 *
 * 将 DOM 弹窗锚定到三维坐标，随相机 postRender 同步屏幕位置。
 */
import Cesium from '@/utils/cesiumCompat';
import { worldToScreenCoordinates } from "@/utils/cesiumCompat";

const POPUP_STYLES = `
.cesium-map-popup-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 10;
}
.cesium-map-popup {
  position: absolute;
  transform: translate(-50%, calc(-100% - 14px));
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease, transform 0.25s ease;
  will-change: transform, opacity;
}
.cesium-map-popup.is-visible {
  opacity: 1;
}
.cesium-map-popup__wrap {
  position: relative;
  width: max-content;
  max-width: 260px;
}
.cesium-map-popup__glow {
  position: absolute;
  inset: -2px;
  border-radius: 10px;
  opacity: 0.55;
  filter: blur(6px);
  animation: cesiumPopupGlow 2.4s ease-in-out infinite;
}
.cesium-map-popup__panel {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.cesium-map-popup__scan {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent);
  animation: cesiumPopupScan 2.8s linear infinite;
  opacity: 0.6;
  pointer-events: none;
}
.cesium-map-popup__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.cesium-map-popup__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: cesiumPopupPulse 1.6s ease-in-out infinite;
}
.cesium-map-popup__body {
  padding: 8px 12px 10px;
  font-size: 12px;
  line-height: 1.65;
  color: rgba(230, 245, 255, 0.92);
}
.cesium-map-popup__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.cesium-map-popup__label {
  color: rgba(160, 200, 230, 0.75);
  flex-shrink: 0;
}
.cesium-map-popup__value {
  text-align: right;
  font-weight: 500;
}
.cesium-map-popup__battery {
  margin-top: 6px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.cesium-map-popup__battery-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
}
.cesium-map-popup__stem {
  position: absolute;
  left: 50%;
  bottom: -14px;
  width: 2px;
  height: 14px;
  transform: translateX(-50%);
  border-radius: 1px;
}
.cesium-map-popup__tip {
  position: absolute;
  left: 50%;
  bottom: -20px;
  width: 8px;
  height: 8px;
  transform: translateX(-50%) rotate(45deg);
  border-radius: 1px;
}
.cesium-map-popup--drone .cesium-map-popup__glow {
  background: linear-gradient(135deg, #00d4ff, #00ff88);
}
.cesium-map-popup--drone .cesium-map-popup__panel {
  background: linear-gradient(145deg, rgba(8, 32, 48, 0.92), rgba(12, 52, 72, 0.88));
  border: 1px solid rgba(0, 212, 255, 0.45);
}
.cesium-map-popup--drone .cesium-map-popup__header {
  background: linear-gradient(90deg, rgba(0, 173, 255, 0.35), rgba(0, 255, 136, 0.15));
}
.cesium-map-popup--drone .cesium-map-popup__dot { background: #00ff88; box-shadow: 0 0 8px #00ff88; }
.cesium-map-popup--drone .cesium-map-popup__stem,
.cesium-map-popup--drone .cesium-map-popup__tip {
  background: linear-gradient(180deg, #00d4ff, #00ff8866);
  box-shadow: 0 0 6px #00d4ff88;
}
.cesium-map-popup--person .cesium-map-popup__glow {
  background: linear-gradient(135deg, #26c6da, #00e676);
}
.cesium-map-popup--person .cesium-map-popup__panel {
  background: linear-gradient(145deg, rgba(6, 36, 40, 0.92), rgba(10, 50, 55, 0.88));
  border: 1px solid rgba(38, 198, 218, 0.45);
}
.cesium-map-popup--person .cesium-map-popup__header {
  background: linear-gradient(90deg, rgba(38, 198, 218, 0.35), rgba(0, 230, 118, 0.12));
}
.cesium-map-popup--person .cesium-map-popup__dot { background: #00e676; box-shadow: 0 0 8px #00e676; }
.cesium-map-popup--person .cesium-map-popup__stem,
.cesium-map-popup--person .cesium-map-popup__tip {
  background: linear-gradient(180deg, #26c6da, #00e67666);
  box-shadow: 0 0 6px #26c6da88;
}
.cesium-map-popup--nofly .cesium-map-popup__glow {
  background: linear-gradient(135deg, #ff5252, #ff9800);
}
.cesium-map-popup--nofly .cesium-map-popup__panel {
  background: linear-gradient(145deg, rgba(48, 12, 12, 0.92), rgba(72, 20, 8, 0.88));
  border: 1px solid rgba(255, 82, 82, 0.55);
}
.cesium-map-popup--nofly .cesium-map-popup__header {
  background: linear-gradient(90deg, rgba(255, 82, 82, 0.4), rgba(255, 152, 0, 0.15));
}
.cesium-map-popup--nofly .cesium-map-popup__dot { background: #ff5252; box-shadow: 0 0 8px #ff5252; animation: cesiumPopupWarn 1s ease-in-out infinite; }
.cesium-map-popup--nofly .cesium-map-popup__stem,
.cesium-map-popup--nofly .cesium-map-popup__tip {
  background: linear-gradient(180deg, #ff5252, #ff980066);
  box-shadow: 0 0 8px #ff525288;
}
@keyframes cesiumPopupGlow {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.7; }
}
@keyframes cesiumPopupScan {
  0% { top: 0; opacity: 0; }
  15% { opacity: 0.7; }
  85% { opacity: 0.7; }
  100% { top: 100%; opacity: 0; }
}
@keyframes cesiumPopupPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.35); opacity: 0.65; }
}
@keyframes cesiumPopupWarn {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
`;

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.setAttribute("data-cesium-map-popup", "true");
  style.textContent = POPUP_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolvePosition(position, time) {
  if (!position) return null;
  if (position instanceof Cesium.Cartesian3) return position;
  if (typeof position.getValue === "function") {
    return position.getValue(time);
  }
  return null;
}

/**
 * @param {Cesium.Viewer} viewer
 */
export function createMapPopupManager(viewer) {
  injectStyles();

  const root = document.createElement("div");
  root.className = "cesium-map-popup-root";
  viewer.container.appendChild(root);

  /** @type {Map<string, { el: HTMLElement, getPosition: Function, visible: boolean, offsetY: number }>} */
  const entries = new Map();
  let paused = false;

  const hideAllEntries = () => {
    entries.forEach((entry) => {
      entry.el.classList.remove("is-visible");
      entry.el.style.display = "none";
    });
  };

  let lastLabelUpdateAt = 0;
  const LABEL_UPDATE_MS = 50;

  const updatePositions = () => {
    if (paused || !viewer || viewer.isDestroyed()) return;
    const now = performance.now();
    if (now - lastLabelUpdateAt < LABEL_UPDATE_MS) return;
    lastLabelUpdateAt = now;

    const time = viewer.clock.currentTime;
    const scene = viewer.scene;

    entries.forEach((entry) => {
      const { el, getPosition, visible, offsetY } = entry;
      if (!visible) {
        el.classList.remove("is-visible");
        el.style.display = "none";
        return;
      }

      const cartesian = getPosition(time);
      if (!cartesian) {
        el.classList.remove("is-visible");
        return;
      }

      const win = worldToScreenCoordinates(scene, cartesian);
      if (!win || win.x < -200 || win.y < -200 || win.x > scene.canvas.clientWidth + 200 || win.y > scene.canvas.clientHeight + 200) {
        el.classList.remove("is-visible");
        return;
      }

      el.style.display = "block";
      el.style.left = `${win.x}px`;
      el.style.top = `${win.y - (offsetY || 0)}px`;
      el.classList.add("is-visible");
    });
  };

  const scheduleLabelUpdate = () => {
    if (paused) return;
    try {
      updatePositions();
    } catch (err) {
      console.warn('[mapLabel] 位置更新失败:', err?.message || err);
    }
  };

  viewer.camera.changed.addEventListener(scheduleLabelUpdate);
  viewer.scene.postRender.addEventListener(scheduleLabelUpdate);

  function buildElement(theme) {
    const el = document.createElement("div");
    el.className = `cesium-map-popup cesium-map-popup--${theme || "drone"}`;
    el.style.display = "none";
    el.innerHTML = `
      <div class="cesium-map-popup__wrap">
        <div class="cesium-map-popup__glow"></div>
        <div class="cesium-map-popup__panel">
          <div class="cesium-map-popup__scan"></div>
          <div class="cesium-map-popup__header"></div>
          <div class="cesium-map-popup__body"></div>
        </div>
        <div class="cesium-map-popup__stem"></div>
        <div class="cesium-map-popup__tip"></div>
      </div>`;
    root.appendChild(el);
    return el;
  }

  return {
    /**
     * @param {{ id: string, theme?: string, header: string, bodyHtml: string, getPosition: Function, visible?: boolean, offsetY?: number }} spec
     */
    upsert(spec) {
      const { id, theme = "drone", header, bodyHtml, getPosition, visible = true, offsetY = 0 } = spec;
      let entry = entries.get(id);
      if (!entry) {
        const el = buildElement(theme);
        entry = { el, getPosition, visible, offsetY, theme };
        entries.set(id, entry);
      } else {
        entry.getPosition = getPosition;
        entry.visible = visible;
        entry.offsetY = offsetY;
        if (theme && entry.theme !== theme) {
          entry.el.className = `cesium-map-popup cesium-map-popup--${theme}`;
          entry.theme = theme;
        }
      }
      entry.el.querySelector(".cesium-map-popup__header").innerHTML =
        `<span class="cesium-map-popup__dot"></span><span>${header}</span>`;
      entry.el.querySelector(".cesium-map-popup__body").innerHTML = bodyHtml;
      if (!visible) {
        entry.el.classList.remove("is-visible");
        entry.el.style.display = "none";
      } else {
        lastLabelUpdateAt = 0;
        scheduleLabelUpdate();
      }
    },

    setVisible(id, visible) {
      const entry = entries.get(id);
      if (entry) entry.visible = visible;
    },

    remove(id) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.el.remove();
      entries.delete(id);
    },

    removeByPrefix(prefix) {
      for (const id of [...entries.keys()]) {
        if (id.startsWith(prefix)) this.remove(id);
      }
    },

    pause() {
      paused = true;
      hideAllEntries();
    },

    resume() {
      paused = false;
      lastLabelUpdateAt = 0;
      scheduleLabelUpdate();
    },

    destroy() {
      if (viewer && !viewer.isDestroyed()) {
        viewer.camera.changed.removeEventListener(scheduleLabelUpdate);
        viewer.scene.postRender.removeEventListener(scheduleLabelUpdate);
      }
      entries.forEach((entry) => entry.el.remove());
      entries.clear();
      root.remove();
    },
  };
}

export function buildDroneLabelBody({ line, battery }) {
  const pct = Math.max(0, Math.min(100, Number(battery) || 0));
  const barColor = pct >= 60 ? "#00ff88" : pct >= 30 ? "#ffc107" : "#ff5252";
  return `
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">线路</span><span class="cesium-map-popup__value">${escapeHtml(line || "—")}</span></div>
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">电量</span><span class="cesium-map-popup__value">${pct}%</span></div>
    <div class="cesium-map-popup__battery"><div class="cesium-map-popup__battery-fill" style="width:${pct}%;background:${barColor}"></div></div>
    <div class="cesium-map-popup__row" style="margin-top:4px"><span class="cesium-map-popup__label">状态</span><span class="cesium-map-popup__value" style="color:#00ff88">待命</span></div>`;
}

export function buildPersonLabelBody({ role, line, phone }) {
  return `
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">岗位</span><span class="cesium-map-popup__value">${escapeHtml(role || "外业巡检员")}</span></div>
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">线路</span><span class="cesium-map-popup__value">${escapeHtml(line || "—")}</span></div>
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">手机</span><span class="cesium-map-popup__value">${escapeHtml(phone || "—")}</span></div>
    <div class="cesium-map-popup__row" style="margin-top:4px"><span class="cesium-map-popup__label">状态</span><span class="cesium-map-popup__value" style="color:#00e676">在岗</span></div>`;
}

export function buildNoFlyLabelBody({ radiusM }) {
  const km = ((radiusM ?? 5000) / 1000).toFixed(0);
  return `
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">类型</span><span class="cesium-map-popup__value">机场净空区</span></div>
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">半径</span><span class="cesium-map-popup__value">${km} km</span></div>
    <div class="cesium-map-popup__row"><span class="cesium-map-popup__label">限制</span><span class="cesium-map-popup__value" style="color:#ff5252">禁止飞行</span></div>`;
}
