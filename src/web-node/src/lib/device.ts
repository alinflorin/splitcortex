import type { DeviceInfo } from '../enrollment/client';

interface UaData {
  platform?: string;
  brands?: { brand: string; version: string }[];
}
interface BrowserNav {
  userAgentData?: UaData;
  deviceMemory?: number;
}

/** A readable browser name from the user agent (the enrolled device is shown to admins under it). */
export function browserName(ua = navigator.userAgent): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function osName(ua: string, nav: BrowserNav): string {
  if (nav.userAgentData?.platform) return nav.userAgentData.platform;
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return '';
}

/** What this browser tells the platform about itself at enrollment. Nothing identifying beyond browser and OS. */
export function webDeviceInfo(version?: string): DeviceInfo {
  const nav = navigator as unknown as BrowserNav;
  const os = osName(navigator.userAgent, nav);
  const browser = browserName();
  return {
    name: `Web node (${browser}${os ? ` on ${os}` : ''})`,
    platform: 'web',
    deviceModel: browser,
    osVersion: os || undefined,
    appVersion: version,
    cpuCores: navigator.hardwareConcurrency || undefined,
    // Chromium reports RAM rounded down and capped at 8 GB; other browsers do not report it at all.
    memoryTotalMb: nav.deviceMemory ? Math.round(nav.deviceMemory * 1024) : undefined,
  };
}
