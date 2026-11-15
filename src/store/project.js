import { defineStore } from 'pinia'
import { createProject, createCharacter, createPart, createBone, createClip, uid } from '../core/model.js'

const LS_KEY = 'shadow-puppet-project'

export const useProjectStore = defineStore('project', {
  state: () => ({
    project: createProject(),
    currentCharacterId: null,
    currentClipId: null,
    lastSavedAt: null,
  }),
  getters: {
    currentCharacter(s) {
      return s.project.characters.find(c => c.id === s.currentCharacterId) || null
    },
    currentClip(s) {
      return s.project.clips.find(c => c.id === s.currentClipId) || null
    },
    characterById: (s) => (id) => s.project.characters.find(c => c.id === id),
    clipById: (s) => (id) => s.project.clips.find(c => c.id === id),
  },
  actions: {
    // ---------- 角色 ----------
    newCharacter(name) {
      const c = createCharacter(name || `角色${this.project.characters.length + 1}`)
      this.project.characters.push(c)
      this.currentCharacterId = c.id
      this.autosave()
      return c
    },
    removeCharacter(id) {
      this.project.characters = this.project.characters.filter(c => c.id !== id)
      this.project.stage.cast = this.project.stage.cast.filter(m => m.characterId !== id)
      if (this.currentCharacterId === id) this.currentCharacterId = this.project.characters[0]?.id ?? null
      this.autosave()
    },
    addPart(character, partData) {
      const p = createPart(partData)
      p.zIndex = character.parts.length
      character.parts.push(p)
      this.autosave()
      return p
    },
    removePart(character, partId) {
      character.parts = character.parts.filter(p => p.id !== partId)
      delete character.weights[partId]
      character.parts.forEach((p, i) => { p.zIndex = i })
      this.autosave()
    },
    movePart(character, partId, dir) {
      const i = character.parts.findIndex(p => p.id === partId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= character.parts.length) return
      const [p] = character.parts.splice(i, 1)
      character.parts.splice(j, 0, p)
      character.parts.forEach((p2, k) => { p2.zIndex = k })
      this.autosave()
    },
    // ---------- 骨骼 ----------
    addBone(character, boneData) {
      const b = createBone(boneData)
      character.bones.push(b)
      this.autosave()
      return b
    },
    removeBone(character, boneId) {
      const removeIds = new Set([boneId])
      let changed = true
      while (changed) { // 级联删子骨
        changed = false
        for (const b of character.bones) {
          if (b.parentId && removeIds.has(b.parentId) && !removeIds.has(b.id)) {
            removeIds.add(b.id); changed = true
          }
        }
      }
      character.bones = character.bones.filter(b => !removeIds.has(b.id))
      // 清掉引用这些骨的权重
      for (const pid of Object.keys(character.weights)) {
        character.weights[pid] = character.weights[pid].map(w => {
          const nw = [...w]
          for (let k = 0; k < 2; k++) {
            const bi = nw[k * 2]
            if (bi >= 0 && !character.bones[bi]) { nw[k * 2] = -1; nw[k * 2 + 1] = 0 }
          }
          return nw
        })
      }
      this.autosave()
    },
    // ---------- 片段 ----------
    saveClip(clip) {
      const i = this.project.clips.findIndex(c => c.id === clip.id)
      if (i >= 0) this.project.clips.splice(i, 1, clip)
      else this.project.clips.push(clip)
      this.currentClipId = clip.id
      this.autosave()
      return clip
    },
    newClip(name, duration) {
      const c = createClip(name || `动作${this.project.clips.length + 1}`, duration)
      this.project.clips.push(c)
      this.currentClipId = c.id
      this.autosave()
      return c
    },
    removeClip(id) {
      this.project.clips = this.project.clips.filter(c => c.id !== id)
      this.project.stage.cast.forEach(m => {
        if (m.clipId === id) m.clipId = null
        if (m.clip2Id === id) m.clip2Id = null
      })
      if (this.currentClipId === id) this.currentClipId = null
      this.autosave()
    },
    // ---------- 舞台 ----------
    addCastMember(characterId) {
      const m = {
        id: uid('cast'), characterId, clipId: null, clip2Id: null,
        blend: 0, offset: 0, x: 0, y: 0, scale: 1, loop: true,
      }
      this.project.stage.cast.push(m)
      this.autosave()
      return m
    },
    removeCastMember(id) {
      this.project.stage.cast = this.project.stage.cast.filter(m => m.id !== id)
      this.autosave()
    },
    // ---------- 持久化 ----------
    saveLocal() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.project))
        this.lastSavedAt = new Date().toLocaleTimeString()
      } catch (e) {
        console.warn('本地保存失败(可能超出容量):', e)
      }
    },
    loadLocal() {
      try {
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return false
        this.importData(JSON.parse(raw))
        return true
      } catch (e) { console.warn('本地读取失败:', e); return false }
    },
    importData(data) {
      if (!data || data.version !== 1 || !Array.isArray(data.characters)) {
        throw new Error('工程文件格式不正确')
      }
      this.project = data
      this.currentCharacterId = data.characters[0]?.id ?? null
      this.currentClipId = data.clips[0]?.id ?? null
    },
    exportJSON() {
      return JSON.stringify(this.project, null, 2)
    },
    autosave() {
      if (this.project.settings.autosave) this.saveLocal()
    },
  },
})
