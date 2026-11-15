<template>
  <div class="page">
    <!-- 左:角色列表 -->
    <div class="panel col side-l">
      <h3>角色</h3>
      <div class="scroll col char-list">
        <div v-for="c in store.project.characters" :key="c.id"
          class="char-item" :class="{ on: c.id === store.currentCharacterId }"
          @click="selectCharacter(c.id)">
          <span>{{ c.name }}</span>
          <span class="hint">{{ c.parts.length }}件</span>
        </div>
        <div v-if="!store.project.characters.length" class="hint">还没有角色,先建一个吧</div>
      </div>
      <div class="row">
        <input v-model="newCharName" placeholder="新角色名字" @keyup.enter="createChar" />
        <button class="primary" @click="createChar">建</button>
      </div>
      <button @click="makeDemo">✨ 生成示例角色(含骨骼和挥手动作)</button>
      <template v-if="character">
        <div class="row">
          <input v-model="character.name" @change="store.autosave()" />
          <button class="danger" @click="removeChar">删角色</button>
        </div>
      </template>
    </div>

    <!-- 中:画布 -->
    <div class="canvas-wrap" ref="wrapEl">
      <canvas ref="canvasEl" class="gl"
        @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
        @wheel.prevent="onWheel"></canvas>
      <div class="toolbar row">
        <button :class="{ active: mode === 'move' }" @click="mode = 'move'">移动部件</button>
        <button :class="{ active: mode === 'pivot' }" @click="mode = 'pivot'">定关节点</button>
        <button @click="renderer?.fitToCharacter()">适配视图</button>
        <span class="hint" v-if="mode === 'pivot'">点击皮片上关节所在位置(如肩膀、胯部),皮片会保持不动</span>
        <span class="hint" v-else>拖动摆放皮片;滚轮缩放</span>
      </div>
    </div>

    <!-- 右:部件 -->
    <div class="panel col side-r">
      <h3>部件(上层在下)</h3>
      <label class="import-btn">
        <input type="file" accept="image/png,image/webp" multiple hidden @change="importParts" />
        <button class="primary" style="width:100%" @click="$event.preventDefault(); $el.querySelector('input').click()">导入分件 PNG</button>
      </label>
      <div class="scroll col part-list">
        <div v-for="p in sortedParts" :key="p.id" class="part-item" :class="{ on: p.id === selectedPartId }"
          @click="selectedPartId = p.id">
          <img :src="p.image" class="thumb" />
          <span class="pname">{{ p.name }}</span>
          <div class="col" style="gap:2px">
            <button @click.stop="store.movePart(character, p.id, 1)">↑</button>
            <button @click.stop="store.movePart(character, p.id, -1)">↓</button>
          </div>
        </div>
      </div>
      <template v-if="selectedPart">
        <div class="col props">
          <h3>部件属性</h3>
          <div class="row"><label>名字</label><input v-model="selectedPart.name" @change="store.autosave()" /></div>
          <div class="row"><label>位置</label>
            <input type="number" v-model.number="selectedPart.x" style="width:70px" @change="commitTransform" />
            <input type="number" v-model.number="selectedPart.y" style="width:70px" @change="commitTransform" />
          </div>
          <div class="row"><label>旋转°</label>
            <input type="number" v-model.number="rotDeg" style="width:70px" @change="commitTransform" />
          </div>
          <div class="row"><label>细分 {{ selectedPart.segments }}</label>
            <input type="range" min="2" max="24" v-model.number="selectedPart.segments" @change="commitTransform" />
          </div>
          <div class="row"><label>硬片铰接</label>
            <input type="checkbox" v-model="selectedPart.rigid" @change="commitTransform" />
            <span class="hint">大角度绝不撕裂</span>
          </div>
          <button class="danger" @click="removePart">删除部件</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useProjectStore } from '../store/project.js'
import { EditorRenderer } from '../core/editorRenderer.js'
import { readFileAsDataURL, loadImageSize } from '../core/storage.js'
import { buildDemoCharacter } from '../core/demoCharacter.js'

const store = useProjectStore()
const canvasEl = ref(null)
const wrapEl = ref(null)
const newCharName = ref('')
const mode = ref('move')
const selectedPartId = ref(null)
let renderer = null
let raf = 0

const character = computed(() => store.currentCharacter)
const sortedParts = computed(() => character.value ? [...character.value.parts].sort((a, b) => b.zIndex - a.zIndex) : [])
const selectedPart = computed(() => character.value?.parts.find(p => p.id === selectedPartId.value) || null)
const rotDeg = computed({
  get: () => selectedPart.value ? +(selectedPart.value.rotation * 180 / Math.PI).toFixed(1) : 0,
  set: (v) => { if (selectedPart.value) selectedPart.value.rotation = v * Math.PI / 180 },
})

function createChar() {
  store.newCharacter(newCharName.value.trim() || undefined)
  newCharName.value = ''
}
function makeDemo() {
  const { character: c, clip } = buildDemoCharacter()
  store.project.characters.push(c)
  store.project.clips.push(clip)
  store.currentCharacterId = c.id
  store.currentClipId = clip.id
  store.autosave()
  nextTick(refreshCharacter)
}
function removeChar() {
  if (confirm(`删除角色「${character.value.name}」?`)) store.removeCharacter(character.value.id)
}
function selectCharacter(id) {
  store.currentCharacterId = id
  selectedPartId.value = null
}

async function importParts(e) {
  if (!character.value) { alert('先创建一个角色'); return }
  const files = [...e.target.files]
  for (const f of files) {
    const dataURL = await readFileAsDataURL(f)
    const { width, height } = await loadImageSize(dataURL)
    const p = store.addPart(character.value, {
      name: f.name.replace(/\.\w+$/, ''), image: dataURL, width, height,
    })
    // 默认排开一点方便看
    p.x = (character.value.parts.length - 1) * 30
    selectedPartId.value = p.id
  }
  e.target.value = ''
  refreshCharacter()
}

function removePart() {
  store.removePart(character.value, selectedPartId.value)
  selectedPartId.value = null
  refreshCharacter()
}

function commitTransform() {
  const p = selectedPart.value
  if (!p) return
  renderer.rebuildPartMesh(p)
  renderer.updatePose({})
  store.autosave()
}

function refreshCharacter() {
  if (!renderer) return
  if (character.value) {
    renderer.setCharacter(character.value)
    renderer.fitToCharacter()
  } else renderer.clearCharacter()
}

// ---------- 画布交互 ----------
let drag = null
function pickPart(wx, wy) {
  if (!character.value) return null
  const parts = [...character.value.parts].sort((a, b) => b.zIndex - a.zIndex)
  for (const p of parts) {
    const dx = wx - p.x, dy = wy - p.y
    const c = Math.cos(-p.rotation), s = Math.sin(-p.rotation)
    const lx = dx * c - dy * s + p.pivot.x
    const ly = p.pivot.y - (dx * s + dy * c)
    if (lx >= 0 && lx <= p.width && ly >= 0 && ly <= p.height) return p
  }
  return null
}

function onPointerDown(e) {
  if (!character.value || !renderer) return
  const w = renderer.toWorld(e.clientX, e.clientY)
  if (mode.value === 'pivot') {
    const p = selectedPart.value
    if (!p) { alert('先在右侧选中一个部件'); return }
    // 世界点 → 部件局部像素坐标
    const dx = w.x - p.x, dy = w.y - p.y
    const c = Math.cos(-p.rotation), s = Math.sin(-p.rotation)
    const lx = dx * c - dy * s
    const ly = dx * s + dy * c
    const newPivot = { x: lx + p.pivot.x, y: p.pivot.y - ly }
    // 保持皮片视觉不动:pos' = pos + R·(pivot位移,局部y向上)
    const dpx = newPivot.x - p.pivot.x, dpy = -(newPivot.y - p.pivot.y)
    const rc = Math.cos(p.rotation), rs = Math.sin(p.rotation)
    p.x += rc * dpx - rs * dpy
    p.y += rs * dpx + rc * dpy
    p.pivot = newPivot
    commitTransform()
    return
  }
  const p = pickPart(w.x, w.y)
  if (p) {
    selectedPartId.value = p.id
    drag = { part: p, startWX: w.x, startWY: w.y, origX: p.x, origY: p.y }
    e.target.setPointerCapture(e.pointerId)
  }
}

function onPointerMove(e) {
  if (!drag || !renderer) return
  const w = renderer.toWorld(e.clientX, e.clientY)
  const dx = w.x - drag.startWX, dy = w.y - drag.startWY
  drag.part.x = drag.origX + dx
  drag.part.y = drag.origY + dy
  // 拖动中只平移网格做预览,松手再重建
  const entry = renderer.partMeshes.get(drag.part.id)
  if (entry) entry.mesh.position.set(dx, dy, 0)
}

function onPointerUp() {
  if (drag) {
    const p = drag.part
    drag = null
    renderer.rebuildPartMesh(p)
    renderer.updatePose({})
    store.autosave()
  }
}

function onWheel(e) {
  if (!renderer) return
  renderer.viewSize *= e.deltaY > 0 ? 1.1 : 0.9
  renderer.resize()
}

watch(character, () => nextTick(refreshCharacter))

onMounted(() => {
  renderer = new EditorRenderer(canvasEl.value, { showRivets: false })
  renderer.showBones = false
  const ro = new ResizeObserver(() => renderer.resize())
  ro.observe(wrapEl.value)
  refreshCharacter()
  const loop = () => { renderer.render(); raf = requestAnimationFrame(loop) }
  loop()
  onBeforeUnmount(() => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose() })
})
</script>

<style scoped>
.page { display: flex; flex: 1; min-height: 0; gap: 10px; padding: 10px; }
.side-l { width: 210px; flex: none; }
.side-r { width: 250px; flex: none; }
.char-list { flex: 1; min-height: 60px; }
.char-item {
  display: flex; justify-content: space-between; padding: 8px 10px; border-radius: 6px;
  cursor: pointer; border: 1px solid transparent;
}
.char-item:hover { background: var(--bg3); }
.char-item.on { border-color: var(--accent2); color: var(--accent2); }
.canvas-wrap { flex: 1; min-width: 0; position: relative; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: radial-gradient(ellipse at center, #2a2118 0%, #17120d 80%); }
.toolbar { position: absolute; top: 10px; left: 10px; right: 10px; pointer-events: none; }
.toolbar > * { pointer-events: auto; }
.part-list { flex: 1; min-height: 80px; }
.part-item {
  display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent;
}
.part-item:hover { background: var(--bg3); }
.part-item.on { border-color: var(--accent2); }
.thumb { width: 36px; height: 36px; object-fit: contain; background: repeating-conic-gradient(#3a3a3a 0 25%, #2a2a2a 0 50%) 0 0/12px 12px; border-radius: 4px; }
.pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.props { border-top: 1px solid var(--line); padding-top: 10px; }
.props .row { justify-content: space-between; }
button { padding: 4px 8px; }
</style>
