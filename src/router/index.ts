// Each form and details page has its own URL, so the browser's back button (or a phone's back
// gesture) closes it instead of leaving the app. Every route but the sign-in pages shows the
// dashboard, which opens the form or page that matches the route.
import { createRouter, createWebHistory, type Router, type RouteRecordRaw } from 'vue-router'
import * as api from '@/api'
import Dashboard from '@/components/dashboard.vue'
import Login from '@/components/login.vue'
import { browser, useSession } from '@/stores/session'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean // for signed-out users only; every other route needs an account
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'dashboard', component: Dashboard },
  { path: '/calendar', name: 'calendar', component: Dashboard }, // ?month=YYYY-MM
  { path: '/login', name: 'login', component: Login, props: { mode: 'login' }, meta: { public: true } },
  { path: '/signup', name: 'signup', component: Login, props: { mode: 'signup' }, meta: { public: true } },
  { path: '/projects/new', name: 'new-project', component: Dashboard },
  { path: '/projects/:id', name: 'project', component: Dashboard },
  { path: '/projects/:id/edit', name: 'edit-project', component: Dashboard },
  { path: '/tasks/new', name: 'new-task', component: Dashboard },
  { path: '/tasks/:id', name: 'task', component: Dashboard },
  { path: '/tasks/:id/edit', name: 'edit-task', component: Dashboard },
  { path: '/tags', name: 'tags', component: Dashboard },
  { path: '/:unknown(.*)*', redirect: '/' },
]

// Sends signed-out users to the sign-in page, remembering where they were going, and signed-in
// users away from it. If the session ends while the app is open, the next request for data
// fails and the app starts again at the sign-in page.
export function requireSignIn(router: Router) {
  router.beforeEach(async (to) => {
    const session = useSession()
    await session.check()
    if (!session.account && !to.meta.public) {
      return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
    }
    if (session.account && to.meta.public) return { name: 'dashboard' }
  })
  api.whenSignedOut(() =>
    browser.load(`/login?redirect=${encodeURIComponent(router.currentRoute.value.fullPath)}`),
  )
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // Forms and pages open at the top; going back returns to where the dashboard was scrolled
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
})

requireSignIn(router)

export default router
