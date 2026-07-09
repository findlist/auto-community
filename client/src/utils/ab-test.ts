import { assignVariant, recordEvent } from '@/api/ab-test';

const CACHE_PREFIX = 'ab_variant_';
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface CachedVariant {
  variant: string;
  timestamp: number;
}

function getCachedVariant(testName: string): string | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${testName}`);
    if (!raw) return null;

    const cached: CachedVariant = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      localStorage.removeItem(`${CACHE_PREFIX}${testName}`);
      return null;
    }

    return cached.variant;
  } catch {
    return null;
  }
}

function setCachedVariant(testName: string, variant: string): void {
  try {
    const cached: CachedVariant = { variant, timestamp: Date.now() };
    localStorage.setItem(`${CACHE_PREFIX}${testName}`, JSON.stringify(cached));
  } catch {
    // localStorage 不可用时静默失败
  }
}

export async function getVariant(testName: string): Promise<string> {
  const cached = getCachedVariant(testName);
  if (cached) return cached;

  const result = await assignVariant(testName);
  setCachedVariant(testName, result.data.variant);
  return result.data.variant;
}

export async function trackEvent(
  testName: string,
  eventType: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const variant = await getVariant(testName);
  await recordEvent(testName, eventType, variant, metadata);
}

export function clearVariantCache(testName?: string): void {
  if (testName) {
    localStorage.removeItem(`${CACHE_PREFIX}${testName}`);
    return;
  }

  const keys = Object.keys(localStorage).filter((key) => key.startsWith(CACHE_PREFIX));
  keys.forEach((key) => localStorage.removeItem(key));
}
