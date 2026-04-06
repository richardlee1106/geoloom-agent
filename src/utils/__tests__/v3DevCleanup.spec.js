import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SPATIAL_ENCODER_PORT,
  DEFAULT_V3_BACKEND_PORT,
  buildTrackedV3DevPorts,
  selectStaleV3ProcessPids
} from '../../../scripts/lib/v3DevCleanup.js'

describe('buildTrackedV3DevPorts', () => {
  it('tracks both the V3 backend port and the spatial encoder port by default', () => {
    expect(buildTrackedV3DevPorts()).toEqual([
      DEFAULT_V3_BACKEND_PORT,
      DEFAULT_SPATIAL_ENCODER_PORT
    ])
  })
})

describe('selectStaleV3ProcessPids', () => {
  it('kills stale V3 dev trees while preserving the current startup lineage', () => {
    const processes = [
      { pid: 1, parentPid: 0, name: 'powershell.exe', commandLine: 'powershell.exe' },
      { pid: 10, parentPid: 1, name: 'node.exe', commandLine: 'node npm-cli.js run dev:V3' },
      { pid: 11, parentPid: 10, name: 'node.exe', commandLine: 'node scripts/cleanup-v3-dev.js' },
      { pid: 20, parentPid: 1, name: 'node.exe', commandLine: 'node npm-cli.js run dev:V3' },
      { pid: 21, parentPid: 20, name: 'node.exe', commandLine: 'node concurrently -n front,v3 -c cyan,magenta' },
      { pid: 22, parentPid: 21, name: 'node.exe', commandLine: 'node vite --mode v3' },
      {
        pid: 23,
        parentPid: 21,
        name: 'node.exe',
        commandLine: 'node --watch D:\\AAA_Edu\\TagCloud\\vite-project\\V3-GeoEncoder-RAG\\server.js'
      },
      {
        pid: 24,
        parentPid: 23,
        name: 'node.exe',
        commandLine: 'node D:\\AAA_Edu\\TagCloud\\vite-project\\V3-GeoEncoder-RAG\\server.js'
      },
      {
        pid: 30,
        parentPid: 1,
        name: 'node.exe',
        commandLine: 'node --watch D:\\AAA_Edu\\TagCloud\\vite-project\\V3-GeoEncoder-RAG\\server.js'
      },
      {
        pid: 31,
        parentPid: 30,
        name: 'node.exe',
        commandLine: 'node D:\\AAA_Edu\\TagCloud\\vite-project\\V3-GeoEncoder-RAG\\server.js'
      },
      {
        pid: 40,
        parentPid: 1,
        name: 'node.exe',
        commandLine: 'node --watch D:\\AAA_Edu\\TagCloud\\vite-project\\V1-fastify-backend\\server.js'
      }
    ]

    expect(
      selectStaleV3ProcessPids({
        processes,
        portOwners: [24],
        currentPid: 11
      })
    ).toEqual([20, 21, 22, 23, 24, 30, 31])
  })

  it('kills the current 3300 listener even when its command line is not obviously V3-specific', () => {
    expect(
      selectStaleV3ProcessPids({
        processes: [
          { pid: 1, parentPid: 0, name: 'powershell.exe', commandLine: 'powershell.exe' },
          { pid: 10, parentPid: 1, name: 'node.exe', commandLine: 'node npm-cli.js run dev:V3' },
          { pid: 11, parentPid: 10, name: 'node.exe', commandLine: 'node scripts/cleanup-v3-dev.js' },
          { pid: 50, parentPid: 1, name: 'node.exe', commandLine: 'node random-service.js' }
        ],
        portOwners: [50],
        currentPid: 11
      })
    ).toEqual([50])
  })

  it('kills stale spatial encoder listeners on 8100 alongside the old V3 backend tree', () => {
    expect(
      selectStaleV3ProcessPids({
        processes: [
          { pid: 1, parentPid: 0, name: 'powershell.exe', commandLine: 'powershell.exe' },
          { pid: 10, parentPid: 1, name: 'node.exe', commandLine: 'node npm-cli.js run dev:V3' },
          { pid: 11, parentPid: 10, name: 'node.exe', commandLine: 'node scripts/cleanup-v3-dev.js' },
          {
            pid: 50,
            parentPid: 1,
            name: 'node.exe',
            commandLine: 'node --watch D:\\AAA_Edu\\TagCloud\\vite-project\\V3-GeoEncoder-RAG\\server.js'
          },
          {
            pid: 60,
            parentPid: 1,
            name: 'python.exe',
            commandLine: 'python D:\\AAA_Edu\\TagCloud\\vite-project\\V3-GeoEncoder-RAG\\services\\spatialEncoderService.py --port 8100'
          }
        ],
        portOwners: [50, 60],
        currentPid: 11
      })
    ).toEqual([50, 60])
  })
})
