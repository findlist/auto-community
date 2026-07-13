import { env } from '../config/env';
import { logger } from '../utils/logger';

// 高德地图 API 响应结构
interface AmapGeocodeResponse {
  status: string;
  info: string;
  infocode: string;
  geocodes?: Array<{
    formatted_address: string;
    location: string;
    level: string;
  }>;
}

interface AmapRegeoResponse {
  status: string;
  info: string;
  infocode: string;
  regeocode?: {
    formatted_address: string;
    addressComponent: {
      province: string;
      city: string;
      district: string;
      township: string;
      street: string;
      streetNumber: string;
    };
  };
}

/**
 * 地理编码：将地址转换为经纬度坐标
 * @param address 地址字符串
 * @returns 经纬度坐标或 null（失败时）
 */
export async function geocode(address: string): Promise<{ lng: number; lat: number } | null> {
  if (!env.AMAP_KEY) {
    logger.warn('AMAP_KEY 未配置，地理编码功能不可用');
    return null;
  }

  if (!address || address.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL('https://restapi.amap.com/v3/geocode/geo');
    url.searchParams.set('key', env.AMAP_KEY);
    url.searchParams.set('address', address.trim());
    url.searchParams.set('output', 'JSON');

    // 5 秒超时，避免高德 API 挂起导致请求线程长时间占用
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      const data = await response.json() as AmapGeocodeResponse;

      if (data.status !== '1' || !data.geocodes || data.geocodes.length === 0) {
        logger.warn({ address, status: data.status, info: data.info }, '地理编码失败');
        return null;
      }

      const location = data.geocodes[0].location;
      const [lng, lat] = location.split(',').map(Number);

      if (!lng || !lat) {
        return null;
      }

      return { lng, lat };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    logger.error({ address, error }, '地理编码请求异常');
    return null;
  }
}

/**
 * 逆地理编码：将经纬度坐标转换为地址描述
 * @param lng 经度
 * @param lat 纬度
 * @returns 地址描述字符串或 null（失败时）
 */
export async function regeo(lng: number, lat: number): Promise<string | null> {
  if (!env.AMAP_KEY) {
    logger.warn('AMAP_KEY 未配置，逆地理编码功能不可用');
    return null;
  }

  if (!lng || !lat) {
    return null;
  }

  try {
    const url = new URL('https://restapi.amap.com/v3/regeo');
    url.searchParams.set('key', env.AMAP_KEY);
    url.searchParams.set('location', `${lng},${lat}`);
    url.searchParams.set('output', 'JSON');
    url.searchParams.set('radius', '1000');
    url.searchParams.set('extensions', 'base');

    // 5 秒超时，避免高德 API 挂起导致请求线程长时间占用
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      const data = await response.json() as AmapRegeoResponse;

      if (data.status !== '1' || !data.regeocode) {
        logger.warn({ lng, lat, status: data.status, info: data.info }, '逆地理编码失败');
        return null;
      }

      return data.regeocode.formatted_address;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    logger.error({ lng, lat, error }, '逆地理编码请求异常');
    return null;
  }
}

/**
 * 计算两点之间的距离（米）
 * 使用 Haversine 公式计算球面距离
 */
export function calculateDistance(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const R = 6371000; // 地球半径（米）
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const mapService = {
  geocode,
  regeo,
  calculateDistance,
};