/**
 * useRegions - 多选区管理 Composable
 * 
 * 支持最多 6 个选区的绘制、管理和查询
 */

import { ref, computed } from 'vue'
import { ElNotification } from 'element-plus'

// 最大选区数量
export const MAX_REGIONS = 6

// 选区颜色方案
export const REGION_COLORS = [
  { fill: 'rgba(52,152,219,0.2)', stroke: '#3498db', text: '#2980b9' },   // 蓝色
  { fill: 'rgba(231,76,60,0.2)', stroke: '#e74c3c', text: '#c0392b' },    // 红色
  { fill: 'rgba(46,204,113,0.2)', stroke: '#2ecc71', text: '#27ae60' },   // 绿色
  { fill: 'rgba(155,89,182,0.2)', stroke: '#9b59b6', text: '#8e44ad' },   // 紫色
  { fill: 'rgba(241,196,15,0.2)', stroke: '#f1c40f', text: '#f39c12' },   // 黄色
  { fill: 'rgba(230,126,34,0.2)', stroke: '#e67e22', text: '#d35400' },   // 橙色
]

/**
 * 选区数据结构
 * @typedef {Object} Region
 * @property {number} id - 选区编号 (1-6)
 * @property {string} name - ѡ ("ѡ1", "ѡ2"...)
 * @property {'Polygon'|'Circle'} type - 几何类型
 * @property {Object} geometry - GeoJSON 几何对象 (WGS84)
 * @property {[number, number]} center - 中心点 [lon, lat]
 * @property {string} boundaryWKT - PostGIS 查询用的 WKT 字符串
 * @property {Array} pois - 选区内的 POI 缓存
 * @property {Object} olFeature - OpenLayers Feature 对象引用
 * @property {Object} stats - 选区统计信息
 */

// 全局选区状态 (单例)
const regions = ref([])
const activeRegionId = ref(null)

export function useRegions() {
  
  /**
   * 获取下一个可用的选区 ID
   */
  const getNextRegionId = () => {
    const usedIds = new Set(regions.value.map(r => r.id))
    for (let i = 1; i <= MAX_REGIONS; i++) {
      if (!usedIds.has(i)) return i
    }
    return null
  }
  
  /**
   * 检查是否可以添加新选区
   */
  const canAddRegion = computed(() => regions.value.length < MAX_REGIONS)
  
  /**
   * 添加新选区
   * @param {Object} regionData - 选区数据
   * @returns {Region|null} - 添加的选区对象，如果失败返回 null
   */
  const addRegion = (regionData) => {
    if (regions.value.length >= MAX_REGIONS) {
      ElNotification({
        title: 'ѡѴ',
        message: `ֻܻ ${MAX_REGIONS} ѡɾѡӡ`,
        type: 'warning',
        duration: 4000
      })
      return null
    }
    
    const id = getNextRegionId()
    if (id === null) return null
    
    const region = {
      id,
      name: `选区${id}`,
      type: regionData.type || 'Polygon',
      geometry: regionData.geometry,
      center: regionData.center,
      boundaryWKT: regionData.boundaryWKT,
      pois: regionData.pois || [],
      olFeature: regionData.olFeature || null,
      labelFeature: null,  // 标签 Feature 引用
      stats: null,
      color: REGION_COLORS[id - 1],
      createdAt: new Date()
    }
    
    regions.value.push(region)
    activeRegionId.value = id
    
    console.log(`[Regions] 添加选区: ${region.name}, 当前共 ${regions.value.length} 个选区`)
    
    return region
  }
  
  /**
   * 删除指定选区
   * @param {number} regionId - 选区 ID
   */
  const removeRegion = (regionId) => {
    const index = regions.value.findIndex(r => r.id === regionId)
    if (index !== -1) {
      const removed = regions.value.splice(index, 1)[0]
      console.log(`[Regions] 删除选区: ${removed.name}`)
      
      // 如果删除的是当前激活的选区，清空激活状态
      if (activeRegionId.value === regionId) {
        activeRegionId.value = regions.value.length > 0 ? regions.value[0].id : null
      }
      
      return removed
    }
    return null
  }
  
  /**
   * 清空所有选区
   */
  const clearAllRegions = () => {
    const count = regions.value.length
    regions.value = []
    activeRegionId.value = null
    console.log(`[Regions] 清空所有选区 (共 ${count} 个)`)
    return count
  }
  
  /**
   * 获取指定选区
   * @param {number} regionId - 选区 ID
   */
  const getRegion = (regionId) => {
    return regions.value.find(r => r.id === regionId) || null
  }
  
  /**
   * 获取多个选区
   * @param {number[]} regionIds - 选区 ID 数组
   */
  const getRegions = (regionIds) => {
    return regions.value.filter(r => regionIds.includes(r.id))
  }
  
  /**
   * 更新选区的 POI 数据
   * @param {number} regionId - 选区 ID
   * @param {Array} pois - POI 数组
   */
  const updateRegionPois = (regionId, pois) => {
    const region = getRegion(regionId)
    if (region) {
      region.pois = pois
      // 计算基础统计
      region.stats = calculateRegionStats(pois)
    }
  }
  
  /**
   * 计算选区统计信息
   * @param {Array} pois - POI 数组
   */
  const calculateRegionStats = (pois) => {
    if (!pois || pois.length === 0) {
      return { poiCount: 0, categories: {}, topCategories: [] }
    }
    
    const categories = {}
    pois.forEach(poi => {
      const props = poi.properties || poi
      const cat = props['小类'] || props['中类'] || props['大类'] || props.category || '未分类'
      categories[cat] = (categories[cat] || 0) + 1
    })
    
    const topCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }))
    
    return {
      poiCount: pois.length,
      categories,
      topCategories
    }
  }
  
  /**
   * 获取用于 AI 对话的选区上下文
   */
  const getRegionsContext = () => {
    return regions.value.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      boundaryWKT: r.boundaryWKT,
      center: r.center,
      poiCount: r.pois?.length || 0,
      stats: r.stats
    }))
  }
  
  /**
   * ûȡѡ
   * @param {string} question - 用户问题
   * @returns {number[]} - 提取到的选区 ID 数组
   */
  const extractRegionReferences = (question) => {
    const references = []
    
    // ƥ "ѡ1""ѡ 2""3"" 4" ģʽ
    const patterns = [
      /选区\s*(\d+)/g,
      /区域\s*(\d+)/g,
      /\s*(\d+)\s*?ѡ/g,
      /第\s*(\d+)\s*个?区域/g,
      /region\s*(\d+)/gi
    ]
    
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(question)) !== null) {
        const id = parseInt(match[1])
        if (id >= 1 && id <= MAX_REGIONS && !references.includes(id)) {
          references.push(id)
        }
      }
    }
    
    return references.sort((a, b) => a - b)
  }
  
  return {
    // 状态
    regions,
    activeRegionId,
    canAddRegion,
    
    // 方法
    addRegion,
    removeRegion,
    clearAllRegions,
    getRegion,
    getRegions,
    updateRegionPois,
    getRegionsContext,
    extractRegionReferences,
    
    // 常量
    MAX_REGIONS,
    REGION_COLORS
  }
}
