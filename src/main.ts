import '@picocss/pico/css/pico.min.css'
import './assets/css/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import Task from './components/task.vue'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.component('task', Task)

app.mount('#app')
