/**
 * 从 UI logo 生成安装包用的透明底 icon.png（512×512，electron-builder 使用）。
 * 用法：npm run icons:build
 */
import sharp from 'sharp'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const src = join(root, 'src/renderer/src/assets/flux-logo-ui.png')
const out = join(root, 'resources/icon.png')

const SIZE = 512
const PAD = 56

const inner = await sharp(src)
  .resize(SIZE - PAD * 2, SIZE - PAD * 2, {
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
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out)

console.log('[icons:build] wrote', out)
