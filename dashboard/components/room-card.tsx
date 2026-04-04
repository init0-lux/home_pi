import Link from "next/link";

import type { Room } from "@/lib/contracts";
import {
  countActiveDevices,
  countOnlineDevices,
  formatEpochRelative,
} from "@/lib/utils";

type RoomCardProps = {
  room: Room;
};

export function RoomCard({ room }: RoomCardProps) {
  const onlineDevices = countOnlineDevices(room.devices);
  const activeDevices = countActiveDevices(room.devices);
  const freshestDevice = room.devices.toSorted(
    (left, right) => right.lastSeen - left.lastSeen,
  )[0];

  return (
    <Link
      className="group rounded-[32px] border border-white/10 bg-slate-950/35 p-5 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/8"
      href={`/rooms/${room.roomId}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
            Room Control
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{room.name}</h2>
        </div>
        <div className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-semibold text-slate-200">
          {onlineDevices}/{room.devices.length} online
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/8 bg-white/6 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Active</p>
          <p className="mt-2 text-3xl font-semibold text-white">{activeDevices}</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/6 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Freshest ping</p>
          <p className="mt-2 text-lg font-semibold text-white">
            {freshestDevice ? formatEpochRelative(freshestDevice.lastSeen) : "No data"}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {room.devices.map((device) => (
          <span
            key={device.deviceId}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              device.state === "ON"
                ? "bg-amber-200 text-slate-950"
                : "bg-white/10 text-slate-200"
            }`}
          >
            {device.name}
          </span>
        ))}
      </div>
    </Link>
  );
}
