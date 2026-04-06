<template>
  <component :is="resolvedView" />
</template>

<script setup>
import { computed } from 'vue'

import { useArchitectureMode } from '../composables/useArchitectureMode.js'
import NarrativeMode from './NarrativeMode.vue'
import V2AgentTraceMode from './V2AgentTraceMode.vue'

const { architectureMode } = useArchitectureMode()

const resolvedView = computed(() => {
  return architectureMode.value === 'v2' ? V2AgentTraceMode : NarrativeMode
})
</script>
