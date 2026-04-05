export const queryKeys = {
  devices: ["devices"] as const,
  room: (roomId: string) => ["rooms", roomId] as const,
  rooms: ["rooms"] as const,
};
