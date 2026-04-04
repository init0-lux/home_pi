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
      <svg fill="none" viewBox="0 0 24 24" className="h-6 w-6">
        <path
          d="M12 3a6 6 0 0 0-3.84 10.61c.54.45.84 1.15.84 1.85V17h6v-1.54c0-.7.3-1.4.84-1.85A6 6 0 0 0 12 3Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M10 21h4M10 19h4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  if (type === "fan") {
    return (
      <svg fill="none" viewBox="0 0 24 24" className="h-6 w-6">
        <path
          d="M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M12.7 6.5c2.5-2 5.7-.8 5.7 1.5 0 2.3-2.2 3.1-4.2 3.4M7.2 9.2c-3-.7-4.4-3.8-3-5.6 1.3-1.8 3.6-1.3 5.2 0M9.2 16.8c-1.6 2.6-4.9 3-6.2 1.1-1.2-1.8 0-3.8 2-4.8M16.3 14.7c2.6.7 4.1 3.5 2.9 5.3-1.3 1.8-3.7 1.5-5.3-.2"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  return (
    <svg fill="none" viewBox="0 0 24 24" className="h-6 w-6">
      <path
        d="M7 9V7a5 5 0 0 1 10 0v2M6 10h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M10 13h4M12 13v4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function DeviceCard({
  busy = false,
  device,
  disabled = false,
  onToggle,
}: DeviceCardProps) {
  const active = device.state === "ON";

  return (
    <article
      className={`group rounded-[32px] border p-5 transition ${
        active
          ? "border-white/20 bg-white/12 shadow-[0_20px_80px_rgba(247,201,132,0.22)]"
          : "border-white/10 bg-slate-950/35"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div
            className={`inline-flex rounded-2xl p-3 ${
              active
                ? "bg-[linear-gradient(135deg,#f7c984,#f08f66)] text-slate-950"
                : "bg-white/8 text-slate-200"
            }`}
          >
            <DeviceGlyph type={device.type} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-white">{device.name}</h3>
          <p className="mt-1 text-sm text-slate-300">
            {device.type.toUpperCase()} • {device.state}
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-200">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              device.online ? "bg-emerald-300" : "bg-rose-300"
            }`}
          />
          <span>{device.online ? "Online" : "Offline"}</span>
        </div>
      </div>

      <p className="mt-5 text-sm text-slate-400">
        Last seen {formatEpochRelative(device.lastSeen)}
      </p>

      <button
        className={`mt-6 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold transition ${
          active
            ? "bg-slate-950 text-white hover:bg-slate-900"
            : "bg-white text-slate-950 hover:bg-slate-100"
        } disabled:cursor-not-allowed disabled:opacity-60`}
        disabled={disabled || busy}
        onClick={() => onToggle(device)}
        type="button"
      >
        <span>{busy ? "Syncing..." : active ? "Turn Off" : "Turn On"}</span>
        <span className="text-xs uppercase tracking-[0.18em]">
          {busy ? "MQTT" : "Tap"}
        </span>
      </button>
    </article>
  );
}
