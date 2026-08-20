/**
 * 从品牌源图生成全应用图标资源。
 * - src/renderer/src/assets/flux-logo-ui.png：应用内展示 logo（透明底）
 * - resources/icon.png：白色圆角底 + 阴影，用于安装包/任务栏/文件关联图标
 * - resources/icon-transparent.png：透明底，用于窗口图标
 * - resources/icon.ico：Windows 多尺寸图标（extraResources 运行时任务栏）
 * 用法：npm run icons:build
 */
import { writeFileSync } from 'fs'
import sharp from 'sharp'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const src = join(root, 'resources/logo-source.png')
const outUiLogo = join(root, 'src/renderer/src/assets/flux-logo-ui.png')
const outCard = join(root, 'resources/icon.png')
const outTransparent = join(root, 'resources/icon-transparent.png')
const outIco = join(root, 'resources/icon.ico')

const SIZE = 512
const UI_SIZE = 1024
const CARD = 428
const CARD_X = (SIZE - CARD) / 2
const CARD_Y = (SIZE - CARD) / 2
const RADIUS = 100
const LOGO_PAD = 34
const WINDOW_LOGO_SIZE = 288
const ICO_SIZES = [256, 64, 48, 32, 16]

/** 源图已是透明背景、1:1；按 fit:contain 缩放并保持透明 */
async function logoBuffer(maxSize) {
  return sharp(src)
    .resize(maxSize, maxSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
}

/* UI logo：透明底 1024 直接展示 */
const uiLogo = await logoBuffer(UI_SIZE)
await sharp(uiLogo).png().toFile(outUiLogo)

/* 安装包/任务栏：白色圆角卡 + 阴影 */
const cardLogo = await logoBuffer(CARD - LOGO_PAD * 2)
const cardSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.20" />
    </filter>
  </defs>
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD}" height="${CARD}" rx="${RADIUS}" ry="${RADIUS}" fill="#FFFFFF" filter="url(#shadow)" />
</svg>
`)
await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    { input: cardSvg, gravity: 'center' },
    { input: cardLogo, gravity: 'center' },
  ])
  .png()
  .toFile(outCard)

/* 窗口图标：透明底 */
const transparentLogo = await logoBuffer(WINDOW_LOGO_SIZE)
await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: transparentLogo, gravity: 'center' }])
  .png()
  .toFile(outTransparent)

/* Windows .ico：多尺寸（以白卡版为底，任务栏小尺寸也清晰） */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + pngs.length * 16
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // colors
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

const cardPng = await sharp(outCard).toBuffer()
const icoPngs = await Promise.all(
  ICO_SIZES.map(async (size) => {
    const data = await sharp(cardPng).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return { size, data }
  }),
)
writeFileSync(outIco, buildIco(icoPngs))

console.log('[icons:build] wrote', outUiLogo)
console.log('[icons:build] wrote', outCard)
console.log('[icons:build] wrote', outTransparent)
console.log('[icons:build] wrote', outIco)
