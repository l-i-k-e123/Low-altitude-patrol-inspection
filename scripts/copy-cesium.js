/**
 * copy-cesium.js — 把 Cesium 运行时静态资源复制到 public/cesium/
 *
 * 为什么需要这一步：
 *   Cesium 依赖 Workers、Assets（地形/贴图）、Widgets（CSS）等静态文件，
 *   并且它们的加载路径由 window.CESIUM_BASE_URL 决定。
 *   把 Build/Cesium 整体放到 public/ 下，dev 与 build 产物都能直接访问，
 *   也便于内网离线部署（不依赖 CDN）。
 *
 * 执行时机：npm install 之后自动运行（postinstall），也可手动 `npm run prepare:cesium`。
 */
import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'node_modules', 'cesium', 'Build', 'Cesium')
const target = resolve(root, 'public', 'cesium')

const ASSET_DIRS = ['Assets', 'Widgets', 'Workers', 'ThirdParty']

if (!existsSync(source)) {
  // 依赖尚未安装完成时不阻塞 install 流程
  console.warn('[copy-cesium] 未找到 node_modules/cesium/Build/Cesium，跳过复制')
  process.exit(0)
}

mkdirSync(target, { recursive: true })

for (const dir of ASSET_DIRS) {
  const from = join(source, dir)
  if (!existsSync(from)) continue
  cpSync(from, join(target, dir), { recursive: true, force: true })
  console.log(`[copy-cesium] ${dir} → public/cesium/${dir}`)
}

const entry = join(source, 'Cesium.js')
if (existsSync(entry)) {
  cpSync(entry, join(target, 'Cesium.js'), { force: true })
  console.log('[copy-cesium] Cesium.js → public/cesium/Cesium.js')
}

console.log('[copy-cesium] 完成，Cesium 静态资源已就绪')
