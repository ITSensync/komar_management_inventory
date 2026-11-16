"use client";

import { useParams } from "next/navigation";
import { SessionDetailPage } from "@/components/session-detail";

export default function Page() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionDetailPage sessionId={sessionId}/>;
}
