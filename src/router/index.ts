// Each form and details page has its own URL, so the browser's back button (or a phone's back
// gesture) closes it instead of leaving the app. Every route shows the dashboard, which opens
// the form or page that matches the route.
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import Dashboard from '@/components/dashboard.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'dashboard', component: Dashboard },
  { path: '/projects/new', name: 'new-project', component: Dashboard },
  { path: '/projects/:id', name: 'project', component: Dashboard },
  { path: '/projects/:id/edit', name: 'edit-project', component: Dashboard },
  { path: '/tasks/new', name: 'new-task', component: Dashboard },
  { path: '/tasks/:id', name: 'task', component: Dashboard },
  { path: '/tasks/:id/edit', name: 'edit-task', component: Dashboard },
  { path: '/tags', name: 'tags', component: Dashboard },
  { path: '/:unknown(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // Forms and pages open at the top; going back returns to where the dashboard was scrolled
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
})

export default router
