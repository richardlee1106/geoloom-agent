import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../MainLayout.vue')
  },
  {
    path: '/narrative/:mode?',
    name: 'NarrativeMode',
    component: () => import('../views/NarrativeShell.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
