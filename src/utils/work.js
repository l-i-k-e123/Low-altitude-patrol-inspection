/**
 * work.js — Web Worker：小地图地铁线路着色匹配（已停用）
 *
 * 作用：在后台线程中批量匹配 GeoJSON 实体名称与地铁线路配色表，
 *       将 index + lineKey 回传主线程，避免大量线路着色阻塞 UI。
 *       对应 Enhanced3DMap.vue 中已注释的 mininitCesium / worker 逻辑。
 *
 * 主要导出：无（Worker 脚本，通过 postMessage 通信）
 *
 * 被谁使用：当前未启用（Enhanced3DMap.vue 中小地图相关代码已注释）
 */
const SUBWAY_LINE_COLORS = {
  "成都地铁1号线": true,
  "成都地铁2号线": true,
  "成都地铁3号线": true,
  "成都地铁4号线": true,
  "成都地铁5号线": true,
  "成都地铁6号线": true,
  "成都地铁7号线": true,
  "成都地铁8号线": true,
  "成都地铁9号线": true,
  "成都地铁10号线": true,

  
  "成都地铁17号线": true,
  "成都地铁18号线": true,
  "成都地铁19号线": true,
};
self.onmessage = (e) => {
  const dataList = e.data;
  dataList.forEach((item) => {
    if (!item.name || !item.hasPolyline) return;
    const lineKey = Object.keys(SUBWAY_LINE_COLORS).find(key =>
      item.name.includes(key)
    );
    if (!lineKey) return;
    self.postMessage({
      index: item.index,
      lineKey: lineKey
    });
  });
};