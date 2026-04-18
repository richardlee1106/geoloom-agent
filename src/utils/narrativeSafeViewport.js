function asPositiveNumber(value, fallback) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : fallback
}

export function clampOverlayRect(rect, mapWidth, mapHeight) {
  if (!rect || typeof rect !== 'object') return null
  const left = Math.max(0, Math.min(mapWidth, Number(rect.left)))
  const top = Math.max(0, Math.min(mapHeight, Number(rect.top)))
  const right = Math.max(0, Math.min(mapWidth, Number(rect.right)))
  const bottom = Math.max(0, Math.min(mapHeight, Number(rect.bottom)))
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null
  }
  if (right - left < 1 || bottom - top < 1) return null
  return { left, top, right, bottom }
}

function inflateOverlayRect(rect, gap, mapWidth, mapHeight) {
  return clampOverlayRect({
    left: rect.left - gap,
    top: rect.top - gap,
    right: rect.right + gap,
    bottom: rect.bottom + gap,
  }, mapWidth, mapHeight)
}

function intersects(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
}

export function buildNarrativeSafePixelBounds(input = {}) {
  const mapWidth = asPositiveNumber(input.mapWidth, 0)
  const mapHeight = asPositiveNumber(input.mapHeight, 0)
  if (!mapWidth || !mapHeight) return null

  const padding = asPositiveNumber(input.padding, 24)
  const gap = asPositiveNumber(input.gap, 20)
  const minWidth = asPositiveNumber(input.minWidth, 320)
  const minHeight = asPositiveNumber(input.minHeight, 240)
  const overlays = Array.isArray(input.overlays) ? input.overlays : []

  const basePaddingX = Math.min(padding, Math.max(8, Math.floor(mapWidth * 0.08)))
  const basePaddingY = Math.min(padding, Math.max(8, Math.floor(mapHeight * 0.08)))
  const base = {
    left: basePaddingX,
    top: basePaddingY,
    right: Math.max(basePaddingX + 1, mapWidth - basePaddingX),
    bottom: Math.max(basePaddingY + 1, mapHeight - basePaddingY),
  }

  const blocked = overlays
    .map((rawRect) => clampOverlayRect(rawRect, mapWidth, mapHeight))
    .filter(Boolean)
    .map((rect) => inflateOverlayRect(rect, gap, mapWidth, mapHeight))
    .filter(Boolean)

  if (blocked.length === 0) return base

  const candidateX = new Set([base.left, base.right])
  const candidateY = new Set([base.top, base.bottom])
  for (const rect of blocked) {
    const left = Math.max(base.left, rect.left)
    const right = Math.min(base.right, rect.right)
    const top = Math.max(base.top, rect.top)
    const bottom = Math.min(base.bottom, rect.bottom)
    if (right - left < 1 || bottom - top < 1) continue
    candidateX.add(left)
    candidateX.add(right)
    candidateY.add(top)
    candidateY.add(bottom)
  }

  const xValues = [...candidateX].sort((left, right) => left - right)
  const yValues = [...candidateY].sort((left, right) => left - right)

  let best = null
  for (let leftIndex = 0; leftIndex < xValues.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < xValues.length; rightIndex += 1) {
      const left = xValues[leftIndex]
      const right = xValues[rightIndex]
      const width = right - left
      if (width < minWidth) continue

      for (let topIndex = 0; topIndex < yValues.length - 1; topIndex += 1) {
        for (let bottomIndex = topIndex + 1; bottomIndex < yValues.length; bottomIndex += 1) {
          const top = yValues[topIndex]
          const bottom = yValues[bottomIndex]
          const height = bottom - top
          if (height < minHeight) continue

          const rect = { left, top, right, bottom }
          if (blocked.some((item) => intersects(rect, item))) continue

          const area = width * height
          const bestArea = best ? (best.right - best.left) * (best.bottom - best.top) : 0
          const bestWidth = best ? (best.right - best.left) : 0
          const bestHeight = best ? (best.bottom - best.top) : 0
          if (!best
            || area > bestArea
            || (area === bestArea && width > bestWidth)
            || (area === bestArea && width === bestWidth && height > bestHeight)) {
            best = rect
          }
        }
      }
    }
  }

  if (best) return best

  return base
}
