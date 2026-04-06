import { AppError } from '../utils/errors.js'
import type { SkillDefinition, SkillSummary } from './types.js'

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>()

  register(skill: SkillDefinition) {
    if (this.skills.has(skill.name)) {
      throw new AppError(
        'duplicate_skill',
        `Skill "${skill.name}" is already registered`,
        400,
      )
    }

    this.skills.set(skill.name, skill)
  }

  get(name: string) {
    return this.skills.get(name) || null
  }

  list(): SkillSummary[] {
    return [...this.skills.values()].map((skill) => ({
      name: skill.name,
      description: skill.description,
      capabilities: skill.capabilities,
      actions: Object.values(skill.actions),
    }))
  }

  size() {
    return this.skills.size
  }
}

