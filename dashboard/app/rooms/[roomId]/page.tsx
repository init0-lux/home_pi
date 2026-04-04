import { RoomScreen } from "@/components/room-screen";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return <RoomScreen roomId={roomId} />;
}
