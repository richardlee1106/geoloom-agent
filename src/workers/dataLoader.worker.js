// Web Worker 用于从后端 API 加载 POI 数据
self.onmessage = async (e) => {
  const {
    category,
    categories,
    name,
    bounds,
    geometry,
    limit = 500000,
    baseUrl = ''
  } = e.data;

  try {
    // 灵活处理：如果是旧逻辑传了数组 categories，就用数组
    // 如果是新逻辑传了单个 category，就把它放进数组传给后端 
    // (因为后端的 findPOIsFiltered 目前设计是接受数组，但用模糊匹配)
    // 或者直接修改后端 /spatial/fetch 接口来支持单参。
    // 这里最简单的做法是：无论单数数，都传给后端，后端兼容性更好。
    const finalCategories = categories || (category ? [category] : []);
    
    // ߣú findPOIsWithinRadius ߼ǰ뾶ѣȫûĵfetch
    // 关键：后端 /fetch 路由是用 findPOIsFiltered(req.body)
    // 而 services/database.js 的 findPOIsFiltered 是接受 { categories: [] } 的。
    // ֻҪ "в" һ ["в"] ȥ
    // 后端就会生成 ILIKE '%中餐厅%' 的 SQL，这正是我们想要的！

    const response = await fetch(`${baseUrl}/api/spatial/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: finalCategories, 
        bounds,
        geometry,
        limit
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }

    // 将结果传回主线程
    self.postMessage({
      success: true,
      name,
      features: data.features
    });
  } catch (error) {
    self.postMessage({
      success: false,
      name,
      error: error.message
    });
  }
};
