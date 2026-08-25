import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { extractOpenFilePath } from '../../src/shared/launch-file'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('baseline2.0 Windows release contract', () => {
  it('keeps the V1 identity and release semantic version', () => {
    const packageJson = JSON.parse(read('package.json')) as { version: string }
    const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version?: string }> }
    const builder = read('electron-builder.yml')

    expect(packageJson.version).toBe('2.0.1')
    expect(lock.version).toBe(packageJson.version)
    expect(lock.packages[''].version).toBe(packageJson.version)
    expect(builder).toContain('appId: com.flux.text-editor')
    expect(builder).toContain('productName: Flux')
  })

  it('builds distinct Windows NSIS and portable artifacts only', () => {
    const builder = read('electron-builder.yml')

    expect(builder).toMatch(/target: nsis[\s\S]*?arch: \[x64\]/)
    expect(builder).toMatch(/target: portable[\s\S]*?arch: \[x64\]/)
    expect(builder).not.toContain('target: zip')
    expect(builder).not.toMatch(/^mac:/m)
    expect(builder).not.toMatch(/^linux:/m)
    expect(builder).toContain('${productName}-setup-${arch}.${ext}')
    expect(builder).toContain('${productName}-portable-${arch}.${ext}')
  })

  it('declares the supported installer associations and install UX', () => {
    const builder = read('electron-builder.yml')
    const installer = read('resources/installer.nsh')

    for (const extension of ['md', 'markdown', 'txt', 'log']) {
      expect(builder).toContain(`ext: ${extension}`)
    }
    expect(builder).toContain('allowToChangeInstallationDirectory: true')
    expect(builder).toContain('createDesktopShortcut: true')
    expect(builder).toContain('createStartMenuShortcut: true')
    expect(installer).toContain('!macro customInit')
    expect(installer).toContain('${IfNot} ${UAC_IsInnerInstance}')
    expect(installer).toContain('是否覆盖安装并保留现有配置')
    expect(installer).toContain('!macro customCheckAppRunning')
    expect(installer).toContain('Flux 正在运行')
  })

  it.each(['md', 'markdown', 'txt', 'log'])('accepts %s external launches', (extension) => {
    const fixtureDir = fs.mkdtempSync(path.join(root, 'tests', '.tmp-release-'))
    const filePath = path.join(fixtureDir, `\u53d1\u5e03\u9a8c\u8bc1.${extension}`)
    try {
      fs.writeFileSync(filePath, 'Flux')
      expect(extractOpenFilePath(['Flux.exe', filePath])).toBe(filePath)
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true })
    }
  })
})
