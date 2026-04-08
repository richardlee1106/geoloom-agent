import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import MainLayout from '../MainLayout.vue'

const NarrativeMode = () => import('../views/NarrativeMode.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: MainLayout
  },
  {
    path: '/narrative',
    name: 'Narrative',
    component: NarrativeMode
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
