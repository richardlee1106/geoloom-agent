import type { SkillDefinition } from '../skills/types.js'
import type { SkillManifest } from '../skills/SkillManifestLoader.js'
import type { ToolSchema } from './types.js'

export function buildToolSchemas(input: {
  skills: SkillDefinition[]
  manifests: SkillManifest[]
}): ToolSchema[] {
  return input.skills.map((skill) => {
    const manifest = input.manifests.find((item) => item.runtimeSkill === skill.name || item.name === skill.name)
    const allowedActions = manifest?.actions?.length
      ? manifest.actions
      : Object.keys(skill.actions)

    return {
      name: skill.name,
      description: manifest?.description || skill.description,
      inputSchema: {
        type: 'object',
        required: ['action', 'payload'],
        properties: {
          action: {
            type: 'string',
            enum: allowedActions,
          },
          payload: {
            type: 'object',
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
    }
  })
}
