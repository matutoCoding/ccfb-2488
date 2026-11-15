import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/characters' },
    { path: '/characters', name: 'characters', component: () => import('./views/CharacterLibrary.vue'), meta: { title: '角色库' } },
    { path: '/rigging', name: 'rigging', component: () => import('./views/RiggingView.vue'), meta: { title: '骨骼绑定' } },
    { path: '/animation', name: 'animation', component: () => import('./views/AnimationEditor.vue'), meta: { title: '动画编辑' } },
    { path: '/stage', name: 'stage', component: () => import('./views/StageView.vue'), meta: { title: '演出舞台' } },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置' } },
  ],
})
