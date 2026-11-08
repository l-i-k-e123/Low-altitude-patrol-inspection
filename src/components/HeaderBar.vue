<template>
  <div class="header-bar">
    <div class="header-side header-side--left">
      <el-tooltip
        content="微信小程序（尚未上线，扫码后向管理员申请体验）"
        placement="bottom"
        :show-after="200"
      >
        <button
          type="button"
          class="mini-program-btn"
          aria-label="微信小程序"
          @click="showMiniProgramDialog = true"
        >
          <svg class="mini-program-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="14" y="14" width="3" height="3" fill="currentColor" />
            <rect x="18" y="14" width="3" height="3" fill="currentColor" />
            <rect x="14" y="18" width="3" height="3" fill="currentColor" />
            <rect x="18" y="18" width="3" height="3" fill="currentColor" />
          </svg>
        </button>
      </el-tooltip>
    </div>

    <h1 class="title-main">空轨智哨——地铁保护区空天地一体化三维监管平台</h1>

    <div class="header-side header-side--right">
      <TopToolbar />
      <div class="system-info">
        <div class="info-item">
          <el-icon><Clock /></el-icon>
          <span>{{ currentTime }}</span>
        </div>
        <div class="info-item">
          <el-icon><Location /></el-icon>
          <span>成都地铁线路</span>
        </div>
        <div class="info-item status-online">
          <el-icon><Connection /></el-icon>
          <span>系统在线</span>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="showMiniProgramDialog"
      title="微信小程序"
      width="400px"
      top="12vh"
      append-to-body
      align-center
      :z-index="10050"
      class="mini-program-dialog"
      modal-class="mini-program-dialog-modal"
    >
      <div class="mini-program-dialog-body">
        <p class="mini-program-tip">
          小程序尚未正式上线，请使用微信扫描下方二维码，扫描后向管理员提交体验申请。
        </p>
        <img
          src="/image/碳视维体验版（8月21日前有效）.png"
          alt="微信小程序二维码"
          class="mini-program-qr"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Clock, Location, Connection } from '@element-plus/icons-vue'
import TopToolbar from './TopToolbar.vue'

const currentTime = ref('')
const showMiniProgramDialog = ref(false)

const updateTime = () => {
  const now = new Date()
  currentTime.value = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

let timeInterval = null

onMounted(() => {
  updateTime()
  timeInterval = setInterval(updateTime, 1000)
})

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval)
})
</script>

<style scoped>
.header-bar {
  flex-shrink: 0;
  position: relative;
  z-index: 100;
  height: 80px;
  background: rgba(6, 14, 32, 0.16);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-bottom: 1px solid rgba(0, 212, 255, 0.2);
  display: flex;
  overflow: visible;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  gap: 16px;
  /* 标题空白区不挡地图；按钮/工具栏自行接收事件 */
  pointer-events: none;
}

.header-bar > * {
  pointer-events: auto;
}

.title-main {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  padding: 0 12px;
  max-width: min(960px, calc(100% - 420px));
  font-size: clamp(20px, 1.55vw, 30px);
  font-weight: bold;
  color: #00d4ff;
  text-shadow:
    0 0 12px rgba(0, 212, 255, 0.85),
    0 0 28px rgba(0, 212, 255, 0.45);
  letter-spacing: 2px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}

.header-bar :deep(.top-toolbar) {
  position: relative;
  z-index: 101;
  transform: translateY(calc(46px + 50%));
}

.header-side--left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.mini-program-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: 8px;
  background: rgba(0, 212, 255, 0.08);
  color: #00d4ff;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
}

.mini-program-btn:hover {
  background: rgba(0, 212, 255, 0.18);
  border-color: rgba(0, 212, 255, 0.6);
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.25);
}

.mini-program-icon {
  width: 20px;
  height: 20px;
}

.header-side--right {
  flex: 1;
  justify-content: flex-end;
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
}

.system-info {
  display: flex;
  gap: 20px;
  flex-shrink: 0;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #e0e0e0;
  white-space: nowrap;
}

.info-item .el-icon {
  color: #00d4ff;
}

.status-online {
  color: #00ff88 !important;
}

.status-online .el-icon {
  color: #00ff88 !important;
}

.mini-program-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 4px 0 8px;
}

.mini-program-tip {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(224, 224, 224, 0.9);
  text-align: center;
}

.mini-program-qr {
  width: 240px;
  height: 240px;
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
  padding: 8px;
}
</style>

<style>
.mini-program-dialog-modal {
  background-color: rgba(0, 0, 0, 0.65) !important;
}

.mini-program-dialog.el-dialog {
  background: linear-gradient(160deg, rgba(8, 18, 40, 0.98) 0%, rgba(4, 10, 24, 0.98) 100%);
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: 14px;
}

.mini-program-dialog .el-dialog__title {
  color: #00d4ff;
  font-weight: bold;
}

.mini-program-dialog .el-dialog__headerbtn .el-dialog__close {
  color: rgba(224, 224, 224, 0.8);
}

.mini-program-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: #00d4ff;
}
</style>
