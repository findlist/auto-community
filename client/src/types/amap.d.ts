/**
 * 高德地图 Web JS SDK 全局类型声明（最小化覆盖项目实际使用的 API）
 *
 * 设计原因：高德官方未提供 @types/amap 包，原代码使用 window.AMap: any
 * 与 useRef<any> 规避类型检查，导致 SDK API 误用无法在编译期发现。
 * 本文件为 ambient 声明（无 import/export），所有接口自动全局可用，
 * 仅声明项目当前真实使用的 API 子集，避免维护全套 SDK 类型负担，
 * 后续如使用更多 API，按需扩展对应接口即可。
 */

// 高德地图经纬度坐标
interface AMapLngLat {
  lng: number;
  lat: number;
}

// 像素偏移量
interface AMapPixel {
  x: number;
  y: number;
}

// Marker 构造参数：项目仅用到 position/content/offset/zIndex/draggable/title
interface AMapMarkerOptions {
  position: [number, number] | AMapLngLat;
  content?: string;
  offset?: AMapPixel;
  zIndex?: number;
  draggable?: boolean;
  title?: string;
}

// 地图实例方法集（项目实际使用部分）
interface AMapMap {
  destroy(): void;
  remove(marker: AMapMarker): void;
  setFitView(positions: AMapLngLat[] | AMapMarker[]): void;
  setCenter(position: [number, number]): void;
  getCenter(): AMapLngLat;
  setZoomAndCenter(zoom: number, center: [number, number]): void;
  plugin(name: string, callback: () => void): void;
}

// 标记实例方法集（项目实际使用部分）
interface AMapMarker {
  setMap(map: AMapMap | null): void;
  setPosition(position: [number, number] | AMapLngLat): void;
  getPosition(): AMapLngLat;
  on(event: string, handler: () => void): void;
}

// 信息窗体实例方法集
interface AMapInfoWindow {
  setContent(content: string): void;
  open(map: AMapMap, position: AMapLngLat): void;
}

// InfoWindow 构造参数
interface AMapInfoWindowOptions {
  offset?: AMapPixel;
  closeWhenClickMap?: boolean;
}

// 地图构造参数
interface AMapMapOptions {
  zoom?: number;
  center?: [number, number];
}

// Geolocation 构造参数
interface AMapGeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
}

// Geolocation 实例：调用回调时传入完成状态与结果对象
interface AMapGeolocation {
  getCurrentPosition(
    callback: (status: string, result: { position: AMapLngLat }) => void,
  ): void;
}

// 高德地图 SDK 命名空间：作为 window.AMap 暴露的全局对象
interface AMapStatic {
  Map: new (container: HTMLElement, options?: AMapMapOptions) => AMapMap;
  Marker: new (options: AMapMarkerOptions) => AMapMarker;
  InfoWindow: new (options?: AMapInfoWindowOptions) => AMapInfoWindow;
  Pixel: new (x: number, y: number) => AMapPixel;
  LngLat: new (lng: number, lat: number) => AMapLngLat;
  Geolocation: new (options?: AMapGeolocationOptions) => AMapGeolocation;
}

// 扩展全局 window 接口，注入高德 SDK 与 Key 配置
interface Window {
  AMap: AMapStatic;
  _AMAP_KEY: string;
}
