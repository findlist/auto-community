import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Search, X, Loader2 } from 'lucide-react';
import { geocode, regeo } from '@/api/emergency';

interface LocationPickerProps {
  // 初始位置
  initialLocation?: { lng: number; lat: number };
  // 初始地址
  initialAddress?: string;
  // 位置变化回调
  onLocationChange?: (location: { lng: number; lat: number }, address: string) => void;
  // 是否显示搜索框
  showSearch?: boolean;
  // 地图高度
  height?: number;
}

export default function LocationPicker({
  initialLocation,
  initialAddress,
  onLocationChange,
  showSearch = true,
  height = 300,
}: LocationPickerProps) {
  const [location, setLocation] = useState<{ lng: number; lat: number } | null>(initialLocation || null);
  const [address, setAddress] = useState<string>(initialAddress || '');
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapRef = useRef<AMapMap | null>(null);
  const markerRef = useRef<AMapMarker | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 加载高德地图 SDK
  useEffect(() => {
    const loadAMap = () => {
      if (window.AMap) {
        setMapLoaded(true);
        return;
      }

      // 动态加载高德地图 JS SDK
      const script = document.createElement('script');
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${window._AMAP_KEY || ''}`;
      script.onload = () => {
        setMapLoaded(true);
      };
      script.onerror = () => {
        setError('地图加载失败，请检查网络连接');
      };
      document.head.appendChild(script);
    };

    loadAMap();
  }, []);

  // 初始化地图
  useEffect(() => {
    if (!mapLoaded || !containerRef.current || !window.AMap) return;

    // 创建地图实例
    const map = new window.AMap.Map(containerRef.current, {
      zoom: 15,
      center: location ? [location.lng, location.lat] : [116.397428, 39.90923], // 默认北京
    });

    // 创建标记点
    const marker = new window.AMap.Marker({
      position: location ? [location.lng, location.lat] : map.getCenter(),
      draggable: true,
    });

    marker.setMap(map);
    mapRef.current = map;
    markerRef.current = marker;

    // 监听标记点拖拽结束事件
    marker.on('dragend', async () => {
      const pos = marker.getPosition();
      const newLocation = { lng: pos.lng, lat: pos.lat };
      setLocation(newLocation);

      // 获取拖拽后的地址
      setLoading(true);
      try {
        const res = await regeo(newLocation.lng, newLocation.lat);
        const newAddress = res.data || '';
        setAddress(newAddress);
        onLocationChange?.(newLocation, newAddress);
      } finally {
        setLoading(false);
      }
    });

    // 如果没有初始位置，尝试获取当前位置
    if (!initialLocation) {
      map.plugin('AMap.Geolocation', () => {
        const geolocation = new window.AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
        });
        geolocation.getCurrentPosition(async (status: string, result: { position: AMapLngLat }) => {
          if (status === 'complete') {
            const pos = result.position;
            const newLocation = { lng: pos.lng, lat: pos.lat };
            setLocation(newLocation);
            marker.setPosition([pos.lng, pos.lat]);
            map.setCenter([pos.lng, pos.lat]);

            // 获取地址
            try {
              const res = await regeo(newLocation.lng, newLocation.lat);
              const newAddress = res.data || '';
              setAddress(newAddress);
              onLocationChange?.(newLocation, newAddress);
            } catch {
              // 忽略逆向地理编码失败，保持地址为空
            }
          }
        });
      });
    }

    return () => {
      map.destroy();
    };
  }, [mapLoaded]);

  // 搜索地址
  const handleSearch = useCallback(async () => {
    if (!searchText.trim() || !mapRef.current || !markerRef.current) return;

    setSearching(true);
    setError(null);
    try {
      const res = await geocode(searchText.trim());
      if (res.data) {
        const newLocation = res.data;
        setLocation(newLocation);
        setAddress(searchText.trim());
        markerRef.current.setPosition([newLocation.lng, newLocation.lat]);
        mapRef.current.setCenter([newLocation.lng, newLocation.lat]);
        onLocationChange?.(newLocation, searchText.trim());
      } else {
        setError('未找到该地址');
      }
    } catch {
      setError('搜索失败，请重试');
    } finally {
      setSearching(false);
    }
  }, [searchText, onLocationChange]);

  return (
    <div className="space-y-3">
      {/* 搜索框 */}
      {showSearch && (
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索地址..."
              className="flex-1 text-sm focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            {searchText && (
              <button onClick={() => setSearchText('')}>
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !searchText.trim()}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : '搜索'}
          </button>
        </div>
      )}

      {/* 地图容器 */}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full rounded-lg border border-gray-200 bg-gray-100"
      >
        {!mapLoaded && (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          </div>
        )}
        {error && !mapLoaded && (
          <div className="h-full flex items-center justify-center text-red-500 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* 当前位置信息 */}
      <div className="p-3 bg-gray-50 rounded-lg space-y-1">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <MapPin className="w-4 h-4 text-emerald-500" />
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <span className="font-medium">
              {location ? `${location.lng.toFixed(6)}, ${location.lat.toFixed(6)}` : '未选择位置'}
            </span>
          )}
        </div>
        {address && (
          <p className="text-xs text-gray-500 pl-6">{address}</p>
        )}
        {error && (
          <p className="text-xs text-red-500 pl-6">{error}</p>
        )}
      </div>

      {/* 提示 */}
      <p className="text-xs text-gray-400 text-center">拖拽地图上的标记点选择位置</p>
    </div>
  );
}