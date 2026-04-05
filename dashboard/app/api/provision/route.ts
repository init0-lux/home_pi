import { NextResponse } from "next/server";

import type { ProvisionRequest } from "@/lib/contracts";
import { ContractError, registerDevice } from "@/lib/server/hub-store";

export async function POST(request: Request) {
  const payload = (await request.json()) as ProvisionRequest;

  try {
    if (!payload.name || !payload.password || !payload.roomId || !payload.ssid) {
      return NextResponse.json(
        {
          error: "INVALID_PROVISION_REQUEST",
          message: "SSID, password, room, and device name are required",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(registerDevice(payload));
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json(error.payload, { status: error.status });
    }

    return NextResponse.json(
      {
        error: "UNKNOWN_ERROR",
        message: "Unexpected error",
      },
      { status: 500 },
    );
  }
}
