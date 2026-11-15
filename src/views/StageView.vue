<template>
  <div class="page">
    <!-- 左:灯光 + 演员表 -->
    <div class="panel col side-l scroll">
      <h3>幕布与灯光</h3>
      <div class="row"><label>灯左右</label>
        <input type="range" min="-600" max="600" v-model.number="light.x" @input="applyLight" />
      </div>
      <div class="row"><label>灯高低</label>
        <input type="range" min="-300" max="350" v-model.number="light.y" @input="applyLight" />
      </div>
      <div class="row"><label>灯远近 {{ light.distance }}</label>
        <input type="range" min="120" max="1500" v-model.number="light.distance" @input="applyLight" />
      </div>
      <div class="row"><label>亮度</label>
        <input type="range" min="0.2" max="2" step="0.05" v-model.number="light.intensity" @input="applyLight" />
      </div>
      <div class="row"><label>虚实</label>
        <input type="range" min="0" max="1" step="0.05" v-model.number="light.softness" @input="applyLight" />
      </div>
      <div class="row"><label>灯色</label>
        <input type="color" v-model="light.color" @input="applyLight" />
      </div>
      <div class="row"><label>皮子透光</label>
        <input type="range" min="0.3" max="1" step="0.05" v-model.number="store.project.settings.translucency" @input="store.autosave()" />
      </div>
      <div class="hint">灯越近影子越大越虚,灯越远影子越小越实 —— 和后台真灯一个道理。</div>

      <h3 style="margin-top:10px">演员表</h3>
      <div class="row">
        <select v-model="castCharId" style="flex:1">
          <option v-for="c in store.project.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button class="primary" @click="addCast" :disabled="!castCharId">上台</button>
      </div>
      <div v-for="m in store.project.stage.cast" :key="m.id" class="cast-item col">
        <div class="row">
          <strong>{{ charName(m.characterId) }}</strong>
          <span style="flex:1"></span>
          <button class="danger" @click="store.removeCastMember(m.id)">下台</button>
        </div>
        <div class="row"><label>动作</label>
          <select v-model="m.clipId" @change="store.autosave()" style="flex:1">
            <option :value="null">(静止)</option>
            <option v-for="c in store.project.clips" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="row"><label>混动作</label>
          <select v-model="m.clip2Id" @change="store.autosave()" style="flex:1">
            <option :value="null">(不混)</option>
            <option v-for="c in store.project.clips" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="row" v-if="m.clip2Id"><label>混合度</label>
          <input type="range" min="0" max="1" step="0.05" v-model.number="m.blend" @input="store.autosave()" />
        </div>
        <div class="row">
          <label>位置</label>
          <input type="number" v-model.number="m.x" style="width:64px" @change="store.autosave()" />
          <input type="number" v-model.number="m.y" style="width:64px" @change="store.autosave()" />
          <label>缩放</label>
          <input type="number" v-model.number="m.scale" step="0.1" min="0.2" style="width:56px" @change="store.autosave()" />
        </div>
        <div class="row">
          <label>出场s</label>
          <input type="number" v-model.number="m.offset" step="0.5" min="0" style="width:64px" @change="store.autosave()" />
          <label>循环</label>
          <input type="checkbox" v-model="m.loop" @change="store.autosave()" />
        </div>
      </div>
    </div>

    <!-- 中:舞台 -->
    <div class="stage-col">
      <div class="stage-wrap" ref="wrapEl">
        <canvas ref="canvasEl" class="gl"></canvas>
        <div class="rec-dot" v-if="recording">● REC</div>
      </div>
      <div class="panel row controls">
        <button class="primary" @click="togglePlay">{{ playing ? '⏸ 停场' : '▶ 开演' }}</button>
        <button @click="time = 0">⏮ 回幕</button>
        <input type="range" min="0" :max="stageDuration" step="0.01" v-model.number="time" style="flex:1" />
        <span class="hint">{{ time.toFixed(1) }}s / {{ stageDuration.toFixed(1) }}s</span>
        <label>总时长s</label>
        <input type="number" v-model.number="stageDuration" min="1" style="width:64px" />
        <button :class="{ danger: recording }" @click="toggleRecord">{{ recording ? '■ 停止并保存' : '⏺ 录制 WebM' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useProjectStore } from '../store/project.js'
import { StageRenderer } from '../core/stageRenderer.js'
import { WebmRecorder } from '../core/storage.js'

const store = useProjectStore()
const canvasEl = ref(null)
const wrapEl = ref(null)
const playing = ref(false)
const recording = ref(false)
const time = ref(0)
const stageDuration = ref(10)
const castCharId = ref(null)
let renderer = null
let recorder = null
let raf = 0
let lastTs = 0

const light = computed(() => store.project.stage.light)

function charName(id) { return store.characterById(id)?.name || '?' }

function addCast() {
  if (castCharId.value) store.addCastMember(castCharId.value)
}

function applyLight() {
  renderer?.setLight(store.project.stage.light)
  store.autosave()
}

function togglePlay() { playing.value = !playing.value }

function toggleRecord() {
  if (recording.value) {
    recorder.stop(`${store.project.name}-演出.webm`)
    recording.value = false
  } else {
    recorder = recorder || new WebmRecorder(canvasEl.value, store.project.settings.fps)
    recorder.start()
    recording.value = true
    if (!playing.value) playing.value = true
  }
}

watch(() => store.project.stage.cast.length, syncCast)
watch(() => store.project.characters.length, syncCast)
function syncCast() {
  renderer?.syncCast(store.project.stage.cast, store.project.characters, store.project.settings.translucency)
}

onMounted(() => {
  renderer = new StageRenderer(canvasEl.value)
  const ro = new ResizeObserver(() => renderer.resize())
  ro.observe(wrapEl.value)
  renderer.setScreen(store.project.stage.screen.width, store.project.stage.screen.height)
  renderer.setLight(store.project.stage.light)
  syncCast()
  const loop = (ts) => {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0
    lastTs = ts
    if (playing.value) {
      time.value += dt
      if (time.value >= stageDuration.value) {
        time.value = 0
        if (recording.value) toggleRecord() // 录满一轮自动停
      }
    }
    renderer.updateFrame(store.project.stage.cast, store.project.clips, time.value)
    renderer.render()
    raf = requestAnimationFrame(loop)
  }
  loop()
  onBeforeUnmount(() => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose() })
})
</script>

<style scoped>
.page { display: flex; flex: 1; min-height: 0; gap: 10px; padding: 10px; }
.side-l { width: 280px; flex: none; }
.stage-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.stage-wrap {
  flex: 1; min-height: 0; position: relative; border: 1px solid var(--line); border-radius: 10px;
  overflow: hidden; background: #14100c;
}
.rec-dot {
  position: absolute; top: 12px; right: 16px; color: #ff4d4d; font-weight: 700;
  animation: blink 1s infinite;
}
@keyframes blink { 50% { opacity: 0.2; } }
.controls { flex: none; }
.cast-item { border-top: 1px solid var(--line); padding-top: 8px; }
.cast-item .row { justify-content: space-between; }
input[type="number"] { width: 100%; }
</style>
