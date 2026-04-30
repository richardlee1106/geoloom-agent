import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import MainLayout from '../MainLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: MainLayout
  },
  {
    path: '/narrative',
    name: 'NarrativeMode',
    component: () => import('../views/NarrativeMode.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
