import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ProfilesSnapshot } from '../agent/types.js'

export interface ProfileManagerOptions {
  profileDir: URL | string
}

export class ProfileManager {
  private readonly profileDir: string

  constructor(options: ProfileManagerOptions) {
    this.profileDir = typeof options.profileDir === 'string'
      ? options.profileDir
      : fileURLToPath(options.profileDir)
  }

  async loadProfiles(): Promise<ProfilesSnapshot> {
    const soul = await this.readMaybe('soul.md.default', '你是一个证据驱动的 GeoLoom 空间助手。')
    const user = await this.readMaybe('user.md.default', '用户偏好清晰、具体、可落地的空间回答。')

    return { soul, user }
  }

  private async readMaybe(filename: string, fallback: string) {
    try {
      return await readFile(join(this.profileDir, filename), 'utf8')
    } catch {
      return fallback
    }
  }
}
