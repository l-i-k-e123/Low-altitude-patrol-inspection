/**
 * cesiumVolumetricCloudLayer.js — 体积云图层（开源版占位实现）
 *
 * 说明：
 *   本项目完整的体积云 / 大气散射效果，是在开源库 cesium-clouds-atmosphere
 *   （three-geospatial 管线，MIT）基础上二次开发而来，包含 3D 噪声纹理体积云、
 *   Beer-Lambert 地面云影、太阳光后处理等。该模块依赖较多外部二进制资源
 *   （shape.bin / stbn.bin / turbulence.png 等）与第三方渲染管线，
 *   因此**未包含在本次开源的代码范围内**。
 *
 *   这里保留完整的函数签名，保证上层 UI 在缺少该模块时仍能正常降级：
 *   开启体积云会返回 false，界面据此提示「该模块未包含在开源版中」。
 */
import { SCENE_CONFIG } from '@/config/cesium'

let warned = false

function warnOnce() {
  if (warned) return
  warned = true
  console.info(
    '[cloud] 体积云 / 大气散射模块未包含在本开源仓库中，'
    + '如需启用请参考 README 的「未包含的部分」。',
  )
}

/** 体积云当前是否已激活（占位实现恒为 false） */
export function isVolumetricCloudActive() {
  return false
}

/** 初始化体积云图层（占位实现，直接返回 false） */
export async function initVolumetricCloudLayer() {
  warnOnce()
  return false
}

/** 设置体积云显隐（占位实现，无副作用） */
export function setVolumetricCloudVisible() {
  warnOnce()
}

/** 启用体积云（占位实现） */
export async function enableVolumetricCloudLayer() {
  warnOnce()
  return false
}

/** 关闭体积云（占位实现，无副作用） */
export function disableVolumetricCloudLayer() {}

/** 销毁体积云（占位实现，无副作用） */
export function destroyVolumetricCloudLayer() {}

/** 设置云层风场（占位实现） */
export function setCloudWind() {
  warnOnce()
}

/** 根据风场数据同步云层风向（占位实现） */
export function syncCloudWindFromField() {
  warnOnce()
}

/** 供 UI 展示的默认云层视角（成都上空） */
export const CHENGDU_CLOUD_VIEW = {
  longitude: SCENE_CONFIG.SUBWAY_GEOJSON_URL ? 104.066 : 104.066,
  latitude: 30.572,
  height: 9000,
}
