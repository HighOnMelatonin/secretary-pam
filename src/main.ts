import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import Task from './components/task.vue'
import dashboard from './components/dashboard.vue'
import project from './components/project.vue'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.component('task', Task)

app.mount('#app')
