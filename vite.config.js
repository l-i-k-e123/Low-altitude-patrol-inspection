import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * Vite 配置
 *
 * 说明：Cesium 的静态资源（Cesium.js / Workers / Assets / Widgets）不参与打包，
 * 由 scripts/copy-cesium.js 从 node_modules 复制到 public/cesium/，
 * 页面通过 <script src="/cesium/Cesium.js"> 全局引入，保证 Worker 与离线部署简单可控。
 */
export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  optimizeDeps: {
    // Cesium 走全局脚本，无需预构建
    exclude: ['cesium'],
  },

  server: {
    port: 3000,
    open: true,
    proxy: {
      // 高德瓦片走本地同源代理：避免浏览器系统代理（如未启动的 127.0.0.1:7890）导致瓦片全挂
      '/basemap-gaode': {
        target: 'https://webst02.is.autonavi.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/basemap-gaode/, ''),
      },
      // 演示用的 Flask 后端（未包含在本仓库中，见 README）
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:5000',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  build: {
    chunkSizeWarningLimit: 2000,
  },
})
