#!/usr/bin/env node

/**
 * ISV 定制版打包脚本
 *
 * 用途：生成带有 ISVision 公司品牌信息的安装包，供公司内部使用。
 * 配置不提交 git —— 每次打包时脚本自动注入 ISV 元数据，打包完成后还原。
 *
 * 用法：node scripts/build-isv.mjs
 * 产物位于 release-isv/ 目录
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const ymlPath = join(root, 'electron-builder.yml')
const ymlBackupPath = join(root, 'electron-builder.yml.bak')
const isvOutputDir = join(root, 'release-isv')

const ISV_HEADER = `appId: com.isv-tech.flux
productName: Flux

# ISV 定制版元数据（由 build-isv.mjs 自动注入）
extraMetadata:
  homepage: https://www.isv-tech.com
  author:
    name: ISVision (Hangzhou) Technology Co., Ltd
    email: https://www.isv-tech.com`

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: root, ...opts })
}

try {
  // 1. 备份原始配置
  console.log('[ISV] 备份 electron-builder.yml …')
  const original = readFileSync(ymlPath, 'utf-8')
  writeFileSync(ymlBackupPath, original, 'utf-8')

  // 2. 注入 ISV 元数据（替换前两行 appId + productName）
  console.log('[ISV] 注入 ISV 元数据 …')
  const patched = original.replace(
    /^appId:.*\nproductName:.*$/m,
    ISV_HEADER
  )
  // 修改输出目录为 release-isv
  const final = patched.replace(
    /output: release/,
    'output: release-isv'
  )
  writeFileSync(ymlPath, final, 'utf-8')

  // 3. 清理旧产物
  if (existsSync(isvOutputDir)) {
    console.log('[ISV] 清理旧产物 …')
    rmSync(isvOutputDir, { recursive: true, force: true })
  }

  // 4. 构建图标 + electron-vite build（仅当需要时）
  console.log('[ISV] 构建图标 …')
  run('npm run icons:build')

  // 如果 out 目录不存在或过旧则重新构建
  console.log('[ISV] electron-vite build …')
  run('npx electron-vite build')

  // 5. 打包
  console.log('[ISV] electron-builder --win …')
  run('npx electron-builder --win')

  // 6. 还原原始配置
  console.log('[ISV] 还原 electron-builder.yml …')
  writeFileSync(ymlPath, original, 'utf-8')
  rmSync(ymlBackupPath)

  console.log(`\n[ISV] 打包完成！产物见 ${isvOutputDir}/`)

} catch (e) {
  // 出错时还原配置
  console.error('[ISV] 打包失败，还原配置 …')
  if (existsSync(ymlBackupPath)) {
    const backup = readFileSync(ymlBackupPath, 'utf-8')
    writeFileSync(ymlPath, backup, 'utf-8')
    rmSync(ymlBackupPath)
  }
  process.exit(1)
}
