import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import MainLayout from '../MainLayout.vue'

const NarrativeMode = () => import('../views/NarrativeMode.vue')
const NarrativeProbe = () => import('../views/NarrativeProbe.vue')

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
  },
  {
    path: '/narrative/probe',
    name: 'NarrativeProbe',
    component: NarrativeProbe
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
