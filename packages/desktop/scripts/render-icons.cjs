// Renders icons/app-icon.svg to every PNG size the channel folders need.
// Run from packages/desktop:  node_modules/electron/dist/electron.exe scripts/render-icons.cjs <out-dir>
//
// Each size re-rasterizes the SVG at its own width/height through a canvas in a hidden window,
// so every entry stays pixel-exact with transparent rounded corners. The previous headless Chrome
// screenshot flow (`--force-device-scale-factor=<size/512>`) clamped its scale factor and produced
// offset, cropped entries — the cause of the truncated Windows taskbar icon.
const { app, BrowserWindow } = require("electron")
const fs = require("node:fs")
const path = require("node:path")

const svgPath = path.join(__dirname, "..", "icons", "app-icon.svg")
const outDir = process.argv[2] ?? path.join(__dirname, "..", "icons", "rendered")
const log = (...values) => fs.appendFileSync(`${outDir}-log.txt`, values.join(" ") + String.fromCharCode(10))

const SIZES = [
  16, 20, 24, 29, 30, 32, 40, 44, 48, 49, 50, 58, 60, 64, 71, 76, 80, 87, 89, 96, 107, 120, 128, 142, 144, 150, 152,
  167, 180, 192, 216, 256, 284, 310, 512, 1024,
]
// Android adaptive foregrounds: the icon centered at 2/3 of the canvas (the adaptive safe zone).
const FOREGROUNDS = [108, 162, 216, 324, 432]

const svg = fs.readFileSync(svgPath, "utf8").replace(/\swidth="\d+"\s+height="\d+"/, "")

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c"></canvas>
<script>
window.render = async (width, height, scale) => {
  const sized = window.svgSource.replace('viewBox="0 0 1024 1024"', 'viewBox="0 0 1024 1024" width="' + width + '" height="' + height + '"')
  const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(sized)))
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.getElementById("c")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  context.clearRect(0, 0, width, height)
  if (scale === 1) {
    context.drawImage(image, 0, 0, width, height)
  } else {
    const size = Math.round(width * scale)
    context.drawImage(image, Math.round((width - size) / 2), Math.round((height - size) / 2), size, size)
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (const byte of buffer) binary += String.fromCharCode(byte)
  return btoa(binary)
}
</script></body></html>`

app.commandLine.appendSwitch("force-device-scale-factor", "1")

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  const win = new BrowserWindow({
    width: 600,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { contextIsolation: false },
  })
  await win.loadURL("data:text/html;base64," + Buffer.from(html).toString("base64"))
  await win.webContents.executeJavaScript(`window.svgSource = ${JSON.stringify(svg)}; true`)

  for (const size of [...SIZES, ...FOREGROUNDS]) {
    const isForeground = FOREGROUNDS.includes(size)
    const base64 = await win.webContents.executeJavaScript(
      `window.render(${size}, ${size}, ${isForeground ? 2 / 3 : 1})`,
    )
    fs.writeFileSync(path.join(outDir, `${size}${isForeground ? "-fg" : ""}.png`), Buffer.from(base64, "base64"))
    log("rendered", size, isForeground ? "(foreground 2/3)" : "")
  }

  log("done:", fs.readdirSync(outDir).length, "files in", outDir)
  app.quit()
})
