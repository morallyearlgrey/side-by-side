export type BleStatus =
  | 'idle'
  | 'starting'
  | 'live'
  | 'poweredOff'
  | 'unauthorized'
  | 'unsupported'
  | 'background'
  | 'unavailable'
  | 'error';

export type BleState = {
  available: boolean;
  live: boolean;
  status: BleStatus;
  scanning: boolean;
  advertising: boolean;
  message?: string;
};

export type BleEncounter = {
  token: string;
  rssi: number | null;
  /** A local Core Bluetooth identifier; never an account ID or durable identity. */
  identifier: string;
  observedAt: string;
};

export type BleEvents = {
  onStateChanged: (state: BleState) => void;
  onEncounter: (encounter: BleEncounter) => void;
};

export type BleSubscription = { remove: () => void };
