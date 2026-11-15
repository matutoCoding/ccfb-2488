<template>
  <div class="app-shell">
    <aside class="side">
      <div class="logo">
        <span class="logo-mark">影</span>
        <div>
          <div class="logo-name">皮影云坊</div>
          <div class="logo-sub">线上皮影动画工坊</div>
        </div>
      </div>
      <nav>
        <RouterLink v-for="r in routes" :key="r.path" :to="r.path" class="nav-item"
          :class="{ on: $route.path === r.path }">
          <span class="nav-icon">{{ r.icon }}</span>{{ r.title }}
        </RouterLink>
      </nav>
      <div class="side-foot">
        <div class="hint">工程:{{ store.project.name }}</div>
        <div class="hint" v-if="store.lastSavedAt">已自动保存 {{ store.lastSavedAt }}</div>
      </div>
    </aside>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useProjectStore } from './store/project.js'

const store = useProjectStore()
const routes = [
  { path: '/characters', title: '角色库', icon: '🎭' },
  { path: '/rigging', title: '骨骼绑定', icon: '🦴' },
  { path: '/animation', title: '动画编辑', icon: '🎞️' },
  { path: '/stage', title: '演出舞台', icon: '🏮' },
  { path: '/settings', title: '设置', icon: '⚙️' },
]

onMounted(() => {
  store.loadLocal()
})
</script>

<style scoped>
.app-shell { display: flex; height: 100%; }
.side {
  width: 190px; flex: none; background: var(--bg2); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; padding: 16px 10px;
}
.logo { display: flex; gap: 10px; align-items: center; padding: 0 6px 16px; }
.logo-mark {
  width: 40px; height: 40px; border-radius: 10px; background: var(--accent);
  display: grid; place-items: center; font-size: 22px; color: #fff; font-weight: 700;
  box-shadow: 0 0 18px rgba(217, 79, 43, 0.5);
}
.logo-name { font-weight: 700; font-size: 15px; }
.logo-sub { font-size: 11px; color: var(--fg-dim); }
nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
  color: var(--fg-dim); text-decoration: none; font-size: 14px;
}
.nav-item:hover { background: var(--bg3); color: var(--fg); }
.nav-item.on { background: var(--bg3); color: var(--accent2); border-left: 3px solid var(--accent); }
.nav-icon { width: 20px; text-align: center; }
.side-foot { margin-top: auto; padding: 8px 6px; border-top: 1px solid var(--line); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
