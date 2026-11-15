// ---------- 工程导入导出 + WebM 录制 ----------

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsText(file)
  })
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export function loadImageSize(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = dataURL
  })
}

// WebM 录制器:canvas.captureStream + MediaRecorder
export class WebmRecorder {
  constructor(canvas, fps = 30) {
    this.canvas = canvas
    this.fps = fps
    this.recorder = null
    this.chunks = []
    this.recording = false
  }

  start() {
    const stream = this.canvas.captureStream(this.fps)
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(m => MediaRecorder.isTypeSupported(m)) || ''
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    this.chunks = []
    this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data) }
    this.recorder.start(200)
    this.recording = true
  }

  stop(filename = '皮影演出.webm') {
    return new Promise((resolve) => {
      if (!this.recorder) return resolve(false)
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        this.recording = false
        resolve(true)
      }
      this.recorder.stop()
    })
  }
}
