<template>
  <div class="page">
    <div class="panel col" style="max-width:520px; width:100%">
      <h3>工程</h3>
      <div class="row"><label>工程名</label>
        <input v-model="store.project.name" @change="store.autosave()" style="flex:1" />
      </div>
      <div class="row"><label>自动保存到本机</label>
        <input type="checkbox" v-model="store.project.settings.autosave" @change="store.autosave()" />
        <span class="hint" v-if="store.lastSavedAt">上次保存 {{ store.lastSavedAt }}</span>
      </div>
      <div class="row">
        <button class="primary" @click="store.saveLocal()">立即保存</button>
        <button @click="exportProject">导出工程文件 (.json)</button>
        <label class="import-label">
          <input type="file" accept=".json" hidden @change="importProject" />
          <button @click="$event.preventDefault(); $el.querySelector('input').click()">导入工程文件</button>
        </label>
      </div>
      <button class="danger" @click="resetProject">清空重来(不可恢复)</button>
    </div>

    <div class="panel col" style="max-width:520px; width:100%">
      <h3>渲染与演出</h3>
      <div class="row"><label>帧率 fps</label>
        <input type="number" v-model.number="store.project.settings.fps" min="12" max="60" style="width:70px" @change="store.autosave()" />
      </div>
      <div class="row"><label>皮子透光度</label>
        <input type="range" min="0.3" max="1" step="0.05" v-model.number="store.project.settings.translucency" @input="store.autosave()" />
      </div>
      <div class="row"><label>关节铆钉</label>
        <input type="checkbox" v-model="store.project.settings.showRivets" @change="store.autosave()" />
        <label>大小</label>
        <input type="range" min="2" max="12" v-model.number="store.project.settings.rivetSize" @input="store.autosave()" />
      </div>
      <div class="row"><label>幕布宽</label>
        <input type="number" v-model.number="store.project.stage.screen.width" style="width:80px" @change="store.autosave()" />
        <label>高</label>
        <input type="number" v-model.number="store.project.stage.screen.height" style="width:80px" @change="store.autosave()" />
      </div>
    </div>

    <div class="panel col" style="max-width:520px; width:100%">
      <h3>关于</h3>
      <div class="hint">
        皮影云坊 —— 给皮影剧团的线上动画工坊。<br>
        流程:角色库导入分件 → 骨骼绑定(自动/手刷权重)→ 动画编辑(K帧、IK、混合)→ 演出舞台(打灯、录 WebM)。<br>
        防撕裂三件套:细分网格 + 平滑双骨权重 + 关节铆钉遮盖;硬片铰接模式则完全不形变。
      </div>
    </div>
  </div>
</template>

<script setup>
import { useProjectStore } from '../store/project.js'
import { downloadText, readFileAsText } from '../core/storage.js'
import { createProject } from '../core/model.js'

const store = useProjectStore()

function exportProject() {
  downloadText(`${store.project.name}.shadowpuppet.json`, store.exportJSON())
}

async function importProject(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  try {
    const data = JSON.parse(await readFileAsText(file))
    store.importData(data)
    store.saveLocal()
    alert('导入成功')
  } catch (err) {
    alert('导入失败:' + err.message)
  }
}

function resetProject() {
  if (!confirm('确定清空整个工程?角色、动作、舞台全没了!')) return
  store.project = createProject()
  store.currentCharacterId = null
  store.currentClipId = null
  store.saveLocal()
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 24px; overflow-y: auto; }
.row { justify-content: flex-start; }
.row label:first-child { min-width: 90px; }
</style>
