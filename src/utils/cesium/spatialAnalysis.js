/**
 * spatialAnalysis.js — 可选的「后端空间分析」适配层
 *
 * 说明：
 *   三维立体可视域（真正按建筑物遮挡逐像素求交）需要射线求交能力，
 *   本项目在浏览器端实现了 2.5D 视域估算（见 viewshedAreaEstimate.js），
 *   能给出可视面积 / 盲区面积的解析近似值，不依赖任何后端。
 *
 *   若你需要更高精度的结果，可以自建分析服务，并在此处对接。
 *   开源版默认不启用远端分析：未配置 VITE_ANALYSIS_BASE 时直接回退到本地估算。
 *
 * 约定的后端接口（可选，非必需）：
 *   POST {VITE_ANALYSIS_BASE}/viewshed       单点可视域
 *   POST {VITE_ANALYSIS_BASE}/viewshed-360   360° 环视可视域
 *   POST {VITE_ANALYSIS_BASE}/route-plan     巡检航线规划
 *   POST {VITE_ANALYSIS_BASE}/point-risk     航点风险研判
 */
import axios from 'axios'
import { API_BASE } from '@/config'

const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_ANALYSIS_TIMEOUT_MS) || 12000
const http = axios.create({ baseURL: API_BASE, timeout: REQUEST_TIMEOUT_MS })

/** 远端分析服务根地址；为空表示不启用 */
const ANALYSIS_BASE = (import.meta.env.VITE_ANALYSIS_BASE ?? '').replace(/\/$/, '')

/** 是否启用了远端分析服务 */
export function isRemoteAnalysisEnabled() {
  return Boolean(ANALYSIS_BASE)
}

/** 统一 POST，未启用时抛出可捕获的「未启用」错误，调用方据此回退本地算法 */
async function post(path, params) {
  if (!ANALYSIS_BASE) {
    const err = new Error('未启用远端空间分析服务')
    err.code = 'ANALYSIS_DISABLED'
    throw err
  }
  const { data } = await http.post(`${ANALYSIS_BASE}${path}`, params, {
    baseURL: API_BASE || undefined,
  })
  return data
}

/** 单点可视域分析 */
export function requestViewshedAnalysis(params) {
  return post('/viewshed', params)
}

/** 360° 环视可视域分析 */
export function requestViewshed360Analysis(params) {
  return post('/viewshed-360', params)
}

/** 巡检航线规划（可选；前端默认用本地插值 + 风险再分类） */
export function requestPatrolRoute(params) {
  return post('/route-plan', params)
}

/** 航点风险研判（可选；前端默认用 routeGeometry.evaluatePointRisk） */
export function requestPointRiskCheck(params) {
  return post('/point-risk', params)
}
