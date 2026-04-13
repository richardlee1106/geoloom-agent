type SchemaTypeName = 'array' | 'object' | 'null' | 'number' | 'string' | 'boolean'

export interface JsonSchema {
  type?: SchemaTypeName | readonly SchemaTypeName[]
  anyOf?: readonly JsonSchema[]
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  items?: JsonSchema
  enum?: readonly unknown[]
  additionalProperties?: boolean
  minItems?: number
}

export interface SSEValidationResult {
  ok: boolean
  event: string
  errors: string[]
  skipped?: boolean
}

const SSE_EVENT_META_PROPERTIES: Readonly<Record<string, JsonSchema>> = Object.freeze({
  trace_id: { type: 'string' },
  schema_version: { type: 'string' },
  capabilities: {
    type: 'array',
    items: { type: 'string' }
  }
})

function withEventMeta(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object') return schema

  if (schema.type === 'object') {
    return {
      ...schema,
      properties: {
        ...(schema.properties || {}),
        ...SSE_EVENT_META_PROPERTIES
      },
      additionalProperties: schema.additionalProperties !== undefined ? schema.additionalProperties : true
    }
  }

  if (Array.isArray(schema.anyOf)) {
    return {
      ...schema,
      anyOf: schema.anyOf.map((child) => withEventMeta(child))
    }
  }

  return schema
}

export const SSE_EVENT_SCHEMAS = Object.freeze({
  job: withEventMeta({
    type: 'object',
    required: ['mode'],
    properties: {
      mode: { type: 'string' }
    },
    additionalProperties: true
  }),
  stage: withEventMeta({
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' }
    },
    additionalProperties: true
  }),
  thinking: withEventMeta({
    type: 'object',
    properties: {
      status: { type: 'string' },
      message: { type: 'string' }
    },
    additionalProperties: true
  }),
  reasoning: withEventMeta({
    type: 'object',
    required: ['content'],
    properties: {
      content: { type: 'string' }
    },
    additionalProperties: true
  }),
  intent_preview: withEventMeta({
    type: 'object',
    properties: {
      rawAnchor: { type: ['string', 'null'] },
      normalizedAnchor: { type: ['string', 'null'] },
      displayAnchor: { type: ['string', 'null'] },
      targetCategory: { type: ['string', 'null'] },
      spatialRelation: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      needsClarification: { type: 'boolean' },
      clarificationHint: { type: ['string', 'null'] },
      isAbbreviation: { type: 'boolean' },
      parserModel: { type: ['string', 'null'] },
      parserProvider: { type: ['string', 'null'] }
    },
    additionalProperties: true
  }),
  progress: withEventMeta({
    type: 'object',
    required: ['progress'],
    properties: {
      progress: { type: 'number' }
    },
    additionalProperties: true
  }),
  partial: withEventMeta({
    type: 'object',
    properties: {
      text_chunk: { type: 'string' }
    },
    additionalProperties: true
  }),
  pois: {
    type: 'array',
    items: { type: 'object' }
  },
  boundary: {
    anyOf: [
      { type: 'object' },
      { type: 'array' },
      { type: 'string' },
      { type: 'null' }
    ]
  },
  spatial_clusters: withEventMeta({
    type: 'object',
    properties: {
      hotspots: { type: 'array', items: { type: 'object' } }
    },
    additionalProperties: true
  }),
  vernacular_regions: {
    type: 'array',
    items: { type: 'object' }
  },
  fuzzy_regions: {
    type: 'array',
    items: { type: 'object' }
  },
  stats: withEventMeta({
    type: 'object',
    additionalProperties: true
  }),
  web_search: withEventMeta({
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string' },
      source: { type: 'string' },
      query: { type: 'string' },
      pages_read: { type: 'number' },
      answer_preview: { type: 'string' },
      message: { type: 'string' },
    },
    additionalProperties: true
  }),
  entity_alignment: withEventMeta({
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string' },
      total_web_results: { type: 'number' },
      total_local_pois: { type: 'number' },
      matched_count: { type: 'number' },
      dual_verified: { type: 'number' },
      local_only: { type: 'number' },
      web_only: { type: 'number' },
      message: { type: 'string' },
      sample_matches: {
        type: 'array',
        items: { type: 'object' }
      }
    },
    additionalProperties: true
  }),
  refined_result: withEventMeta({
    type: 'object',
    additionalProperties: true
  }),
  error: withEventMeta({
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string' }
    },
    additionalProperties: true
  }),
  done: withEventMeta({
    type: 'object',
    properties: {
      duration_ms: { type: 'number' }
    },
    additionalProperties: true
  }),
  schema_error: withEventMeta({
    type: 'object',
    required: ['event', 'errors'],
    properties: {
      event: { type: 'string' },
      errors: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    additionalProperties: true
  })
} satisfies Record<string, JsonSchema>)

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesType(value: unknown, typeName: SchemaTypeName): boolean {
  switch (typeName) {
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isObjectLike(value)
    case 'null':
      return value === null
    case 'number':
      return Number.isFinite(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    default:
      return false
  }
}

function validateSchema(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (!schema || typeof schema !== 'object') return

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const anyOfErrors: string[] = []
    const matched = schema.anyOf.some((child) => {
      const childErrors: string[] = []
      validateSchema(value, child, path, childErrors)
      if (childErrors.length === 0) return true
      anyOfErrors.push(...childErrors)
      return false
    })
    if (!matched) {
      errors.push(`${path}: does not satisfy anyOf`)
      errors.push(...anyOfErrors.slice(0, 3))
    }
    return
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? [...schema.type] : [schema.type]
    const typeMatched = expectedTypes.some((typeName) => matchesType(value, typeName))
    if (!typeMatched) {
      errors.push(`${path}: expected type ${expectedTypes.join('|')}`)
      return
    }
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value is not in enum`)
    return
  }

  if (schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))) {
    const arrayValue = Array.isArray(value) ? value : []
    if (schema.minItems && arrayValue.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items`)
    }
    if (schema.items) {
      arrayValue.forEach((item, index) => {
        validateSchema(item, schema.items as JsonSchema, `${path}[${index}]`, errors)
      })
    }
  }

  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    const objectValue = isObjectLike(value) ? value : {}
    const properties = schema.properties || {}
    const required = Array.isArray(schema.required) ? schema.required : []
    required.forEach((key) => {
      if (!(key in objectValue)) {
        errors.push(`${path}.${key}: required`)
      }
    })
    Object.keys(properties).forEach((key) => {
      if (key in objectValue) {
        validateSchema(objectValue[key], properties[key] as JsonSchema, `${path}.${key}`, errors)
      }
    })
    if (schema.additionalProperties === false) {
      Object.keys(objectValue).forEach((key) => {
        if (!(key in properties)) {
          errors.push(`${path}.${key}: additional property not allowed`)
        }
      })
    }
  }
}

export function normalizeSSEEventName(eventName: unknown): string {
  return String(eventName || '').trim()
}

export function validateSSEEventPayload(eventName: unknown, payload: unknown): SSEValidationResult {
  const normalizedEventName = normalizeSSEEventName(eventName)
  const schema = SSE_EVENT_SCHEMAS[normalizedEventName as keyof typeof SSE_EVENT_SCHEMAS]
  if (!schema) {
    return {
      ok: true,
      event: normalizedEventName,
      errors: [],
      skipped: true
    }
  }

  const errors: string[] = []
  validateSchema(payload, schema, '$', errors)

  return {
    ok: errors.length === 0,
    event: normalizedEventName,
    errors
  }
}
