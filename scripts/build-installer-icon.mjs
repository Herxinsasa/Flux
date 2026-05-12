/**
 * 从 UI logo 生成应用图标资源。
 * - resources/icon.png：白色圆角底 + 阴影，用于安装包/任务栏图标
 * - resources/icon-transparent.png：透明底，用于窗口左上角图标
 * 用法：npm run icons:build
 */
import sharp from 'sharp'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const src = join(root, 'src/renderer/src/assets/flux-logo-ui.png')
const outCard = join(root, 'resources/icon.png')
const outTransparent = join(root, 'resources/icon-transparent.png')

const SIZE = 512
const CARD = 428
const CARD_X = (SIZE - CARD) / 2
const CARD_Y = (SIZE - CARD) / 2
const RADIUS = 100
const LOGO_PAD = 34
const WINDOW_LOGO_SIZE = 288

const logo = await sharp(src)
  .resize(CARD - LOGO_PAD * 2, CARD - LOGO_PAD * 2, {
    fit: 'inside',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .toBuffer()

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
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    { input: cardSvg, gravity: 'center' },
    { input: logo, gravity: 'center' },
  ])
  .png()
  .toFile(outCard)

const transparentLogo = await sharp(src)
  .resize(WINDOW_LOGO_SIZE, WINDOW_LOGO_SIZE, {
    fit: 'inside',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .toBuffer()

await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: transparentLogo, gravity: 'center' }])
  .png()
  .toFile(outTransparent)

console.log('[icons:build] wrote', outCard)
console.log('[icons:build] wrote', outTransparent)
