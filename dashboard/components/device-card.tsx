import type { Device } from "@/lib/contracts";
import { formatEpochRelative } from "@/lib/utils";

type DeviceCardProps = {
  busy?: boolean;
  device: Device;
  disabled?: boolean;
  onToggle: (device: Device) => void | Promise<void>;
};

function DeviceGlyph({ type }: Pick<Device, "type">) {
  if (type === "light") {
    return (
      <svg fill="none" viewBox="0 0 24 24" className="h-6 w-6" stroke="currentColor">
        <path d="M12 3a6 6 0 0 0-3.84 10.61c.54.45.84 1.15.84 1.85V17h6v-1.54c0-.7.3-1.4.84-1.85A6 6 0 0 0 12 3Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M10 21h4M10 19h4" strokeLinecap="round" strokeWidth="1.5" />
      </svg>
    );
  }

  if (type === "fan") {
    return (
      <svg fill="none" viewBox="0 0 24 24" className="h-6 w-6" stroke="currentColor">
        <path d="M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0" strokeWidth="1.5" />
        <path d="M12.7 6.5c2.5-2 5.7-.8 5.7 1.5 0 2.3-2.2 3.1-4.2 3.4M7.2 9.2c-3-.7-4.4-3.8-3-5.6 1.3-1.8 3.6-1.3 5.2 0M9.2 16.8c-1.6 2.6-4.9 3-6.2 1.1-1.2-1.8 0-3.8 2-4.8M16.3 14.7c2.6.7 4.1 3.5 2.9 5.3-1.3 1.8-3.7 1.5-5.3-.2" strokeLinecap="round" strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <svg fill="none" viewBox="0 0 24 24" className="h-6 w-6" stroke="currentColor">
      <path d="M7 9V7a5 5 0 0 1 10 0v2M6 10h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8Z" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M10 13h4M12 13v4" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

const typeMap = {
  light: { base: "primary", color: "text-primary-container", bgVar: "bg-primary-container", bg20: "bg-primary-container/20", glow: "active-glow-primary", shadow: "shadow-[0_10px_30px_-10px_rgba(255,215,0,0.2)]" },
  fan: { base: "secondary", color: "text-secondary-container", bgVar: "bg-secondary-container", bg20: "bg-secondary-container/20", glow: "active-glow-secondary", shadow: "shadow-[0_10px_30px_-10px_rgba(54,148,236,0.2)]" },
  ac: { base: "tertiary", color: "text-tertiary-container", bgVar: "bg-tertiary-container", bg20: "bg-tertiary-container/20", glow: "active-glow-secondary", shadow: "shadow-[0_10px_30px_-10px_rgba(114,235,255,0.2)]" },
};

export function DeviceCard({ busy = false, device, disabled = false, onToggle }: DeviceCardProps) {
  const active = device.state === "ON";
  const mapped = device.type in typeMap ? typeMap[device.type as keyof typeof typeMap] : typeMap.light;

  if (!active) {
    return (
      <button
        onClick={() => onToggle(device)}
        disabled={disabled || busy}
        className="w-full text-left bg-surface-container-low rounded-lg p-6 flex flex-col justify-between aspect-square border border-outline-variant/5 active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex justify-between items-start opacity-40">
          <div className="p-3 rounded-full bg-[#353534]">
            <span className="text-[#d0c6ab]">
              <DeviceGlyph type={device.type} />
            </span>
          </div>
          <div className="w-8 h-4 bg-[#353534] rounded-full relative">
            <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-[#d0c6ab] rounded-full"></div>
          </div>
        </div>
        <div>
          <span className="font-label text-[10px] uppercase tracking-widest text-[#d0c6ab]/40 mb-1 flex items-center justify-between">
            {device.type} {!device.online && "• Offline"}
          </span>
          <h3 className="font-headline text-lg font-bold text-[#e5e2e1]/40">{device.name}</h3>
          <p className="font-label text-xs text-[#d0c6ab]/40 font-medium mt-1">OFF • {formatEpochRelative(device.lastSeen)}</p>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => onToggle(device)}
      disabled={disabled || busy}
      className={`w-full text-left ${mapped.glow} surface-container-high rounded-lg p-6 flex flex-col justify-between aspect-square border border-outline-variant/10 active:scale-95 transition-all duration-300 ${mapped.shadow} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div className="flex justify-between items-start">
        <div className={`p-3 rounded-full ${mapped.bg20}`}>
          <span className={mapped.color}><DeviceGlyph type={device.type} /></span>
        </div>
        <div className={`w-8 h-4 ${mapped.bgVar}/30 rounded-full relative`}>
          <div className={`absolute right-0.5 top-0.5 w-3 h-3 ${mapped.bgVar} rounded-full shadow-lg`}></div>
        </div>
      </div>
      <div>
        <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-1 flex items-center justify-between">
          <span>{device.type}</span> {!device.online && "• Offline"}
        </span>
        <h3 className="font-headline text-lg font-bold text-on-surface">{device.name}</h3>
        <p className={`font-label text-xs ${mapped.color} font-semibold mt-1 flex items-center justify-between`}>
          <span>ON</span>
          <span className="text-[10px] font-normal">{formatEpochRelative(device.lastSeen)}</span>
        </p>
      </div>
    </button>
  );
}
