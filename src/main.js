import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { isCesiumReady } from '@/utils/cesiumCompat'

function bootstrap() {
  if (!isCesiumReady()) {
    console.error('[Cesium] Cesium 引擎未就绪，请检查 public/Cesium/ 静态资源')
    return
  }
  console.info('[Cesium] Cesium 引擎加载成功，Viewer API 可用')

  const app = createApp(App)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
  }
  app.use(createPinia())
  app.use(router)
  app.use(ElementPlus)
  app.mount('#app')
}

bootstrap()


