<template>
  <div class="collapsible-panel" :class="{ 'is-collapsed': !expanded }">
    <button type="button" class="section-title" @click="toggle">
      <slot name="title" />
      <span class="toggle-icon">{{ expanded ? '▾' : '▸' }}</span>
    </button>
    <div v-if="expanded" class="panel-body">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import datashare from '@/stores/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: true },
  panelKey: { type: String, default: '' },
  side: { type: String, default: 'right' },
})

const emit = defineEmits(['update:modelValue'])

const store = datashare()

const expanded = computed({
  get() {
    if (props.panelKey) {
      return store.panelStates[props.side]?.[props.panelKey] ?? props.modelValue
    }
    return props.modelValue
  },
  set(v) {
    if (props.panelKey) {
      store.patchPanelStates({ [props.side]: { [props.panelKey]: v } })
    }
    emit('update:modelValue', v)
  },
})

const toggle = () => {
  expanded.value = !expanded.value
}
</script>

<style scoped>
.collapsible-panel {
  background: rgba(12, 22, 48, 0.22);
  border-radius: 8px;
  border: 1px solid rgba(0, 212, 255, 0.18);
  flex-shrink: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 15px;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: bold;
  color: #00d4ff;
  text-shadow: 0 0 5px rgba(0, 212, 255, 0.5);
  cursor: pointer;
  text-align: left;
}

.toggle-icon {
  margin-left: auto;
  font-size: 12px;
  color: #8eb8c8;
}

.panel-body {
  padding: 0 15px 15px;
}
</style>
