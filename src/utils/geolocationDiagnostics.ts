type BrowserBrand = 'edge' | 'chrome' | 'firefox' | 'safari' | 'other'

interface CoarseLocationBrowserHintArgs {
  browserBrand?: BrowserBrand
  accuracyM?: unknown
  permissionState?: unknown
}

function toRoundedAccuracyText(accuracyM: unknown): string {
  const numeric = Number(accuracyM)
  return Number.isFinite(numeric) ? `当前精度约 ${Math.round(numeric)} 米` : '当前精度偏粗'
}

function toPermissionLabel(permissionState: unknown): string {
  switch (String(permissionState || '').trim().toLowerCase()) {
    case 'granted':
      return '权限已授权'
    case 'prompt':
      return '权限仍待确认'
    case 'denied':
      return '权限已拒绝'
    default:
      return ''
  }
}

export function detectBrowserBrand(userAgent = ''): BrowserBrand {
  const normalized = String(userAgent || '')
  if (/Edg\//i.test(normalized)) return 'edge'
  if (/Chrome\//i.test(normalized) && !/Edg\//i.test(normalized)) return 'chrome'
  if (/Firefox\//i.test(normalized)) return 'firefox'
  if (/Safari\//i.test(normalized) && !/Chrome\//i.test(normalized)) return 'safari'
  return 'other'
}

export function buildCoarseLocationBrowserHint({
  browserBrand = 'other',
  accuracyM = null,
  permissionState = 'unknown'
}: CoarseLocationBrowserHintArgs = {}): string {
  const accuracyText = toRoundedAccuracyText(accuracyM)
  const permissionLabel = toPermissionLabel(permissionState)
  const permissionSuffix = permissionLabel ? `，${permissionLabel}` : ''

  if (browserBrand === 'chrome') {
    return `Chrome 这次更像只拿到了网络级粗定位（${accuracyText}${permissionSuffix}），还没有真正拿到设备级位置。同机 Edge 能定位时，通常更像是 Chrome 当前定位源或精确位置能力没有生效。`
  }

  return `浏览器这次返回的位置精度仍然偏粗（${accuracyText}${permissionSuffix}），更像是网络级粗定位，还没稳定到可用的设备位置。`
}
