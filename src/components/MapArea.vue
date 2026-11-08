<template>
  <div class="map-area">
    <Enhanced3DMap
      @update-current-line="handleCurrentLineUpdate"
      @update-detection-result="handleDetectionResultUpdate"
    />
  </div>
</template>
 
<script setup>
import Enhanced3DMap from './Enhanced3DMap.vue'


// 定义emits
const emit = defineEmits(['update-current-line', 'update-detection-result'])

// 处理当前线路更新
const handleCurrentLineUpdate = (line) => {
  emit('update-current-line', line)
}

const handleDetectionResultUpdate = (result) => {
  emit('update-detection-result', result)
}

</script>

<style scoped>
.map-area {
  flex: 1;
  width: 100%;
  height: 100%;
  position: relative;
}
</style>


