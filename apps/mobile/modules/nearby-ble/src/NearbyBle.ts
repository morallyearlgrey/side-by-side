import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { BleEncounter, BleEvents, BleState, BleSubscription } from './NearbyBle.types';

declare class NearbyBleNativeModule extends NativeModule<BleEvents> {
  start(token: string): Promise<BleState>;
  stop(): Promise<BleState>;
  getState(): Promise<BleState>;
}

const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<NearbyBleNativeModule>('NearbyBle')
  : null;

export const unavailableState: BleState = {
  available: false,
  live: false,
  status: 'unavailable',
  scanning: false,
  advertising: false,
  message: 'Bluetooth discovery needs the SidebySide iPhone development build. It is unavailable in Expo Go and on web.',
};

/** Repeating start with a freshly registered token rotates the GATT value. */
export async function start(token: string): Promise<BleState> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new Error('Invalid phone discovery token.');
  }
  return native ? native.start(token) : unavailableState;
}

export async function stop(): Promise<BleState> {
  return native ? native.stop() : unavailableState;
}

/** Reading state does not construct Bluetooth managers or ask for permission. */
export async function getState(): Promise<BleState> {
  return native ? native.getState() : unavailableState;
}

export function addStateListener(listener: (state: BleState) => void): BleSubscription {
  return native?.addListener('onStateChanged', listener) ?? { remove() {} };
}

export function addEncounterListener(listener: (encounter: BleEncounter) => void): BleSubscription {
  return native?.addListener('onEncounter', listener) ?? { remove() {} };
}
