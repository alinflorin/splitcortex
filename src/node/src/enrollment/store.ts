import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'sc-enrollment';

export interface StoredEnrollment {
  nodeId: string;
  fingerprint: string;
  approved: boolean;
  /** Control plane URL it enrolled against. */
  enrollmentUrl: string;
  /** Pinned gateway identity; null if the platform had none yet at enrollment. */
  /** `nextKeys`: keys the gateway announced for a key rotation (signed by the current one); trusted alongside it. */
  gateway: { publicKey: string; url: string; nextKeys?: string[] } | null;
  /** What the device joined (from the enrollment response, refreshed from the control plane while approved). */
  orgName?: string;
  poolName?: string;
  /** The device's name in the web app. */
  deviceName?: string;
  enrolledAt: string;
}

export async function loadEnrollment(): Promise<StoredEnrollment | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as StoredEnrollment) : null;
}
export const saveEnrollment = (e: StoredEnrollment) => AsyncStorage.setItem(KEY, JSON.stringify(e));
export const clearEnrollment = () => AsyncStorage.removeItem(KEY);

/** The stored enrollment (undefined while loading, null when not enrolled); call `reload` after changing it. */
export function useEnrollment() {
  const [enrollment, setEnrollment] = useState<StoredEnrollment | null | undefined>(undefined);
  const reload = useCallback(() => void loadEnrollment().then(setEnrollment), []);
  useEffect(reload, [reload]);
  return { enrollment, reload };
}
