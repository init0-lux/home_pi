import Link from "next/link";
import type { Room } from "@/lib/contracts";
import { countActiveDevices } from "@/lib/utils";

type RoomCardProps = {
  room: Room;
};

export function RoomCard({ room }: RoomCardProps) {
  const activeDevices = countActiveDevices(room.devices);
  const total = room.devices.length;
  const isActive = activeDevices > 0;

  return (
    <Link
      href={`/rooms/${room.roomId}`}
      className={`min-h-[140px] relative group flex flex-col justify-between cursor-pointer overflow-hidden rounded-xl px-5 py-4 transition-all duration-300 active:scale-[0.98] ${
        isActive ? "bg-surface-container-low hardware-gradient" : "bg-surface-container-low opacity-80"
      }`}
    >
      <div className={`absolute top-0 right-0 p-4 transition-opacity ${isActive ? "opacity-10" : "opacity-5"}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16 text-white">
          <path d="M21 11V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h6v-2H5V5h14v6h2zM19 15v8l3-3-3-3v8"/>
        </svg>
      </div>
      
      <div className="relative z-10 h-full flex flex-col justify-between">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-xl font-headline font-semibold text-white mb-0.5">{room.name}</h3>
            <p className={`text-[11px] font-label font-medium ${isActive ? "text-primary-container" : "text-neutral-500"}`}>
              {isActive ? `${activeDevices}/${total} devices ON` : "All devices OFF"}
            </p>
          </div>
          <div className={`w-9 h-9 rounded-full glass-card flex items-center justify-center ${isActive ? "text-primary-container" : "text-neutral-500"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 ml-0.5">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        
        <div className="flex gap-2">
          {room.devices.map((device) => (
            <div 
              key={device.deviceId} 
              className={`w-1.5 h-1.5 rounded-full ${device.state === "ON" ? "bg-primary-container" : "bg-neutral-600"}`} 
            />
          ))}
        </div>
      </div>
    </Link>
  );
}
