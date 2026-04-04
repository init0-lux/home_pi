import { NextResponse } from "next/server";

import { listRooms } from "@/lib/server/hub-store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(listRooms());
}
