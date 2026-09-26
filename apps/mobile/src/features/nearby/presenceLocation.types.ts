export type PresencePoint = {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
};

export type PresenceWatch = { remove: () => void };
