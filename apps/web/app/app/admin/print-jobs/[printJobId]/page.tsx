"use client";

import { useParams } from "next/navigation";
import { PrintJobPage } from "@/components/print-job-page";

export default function Page() {
  const { printJobId } = useParams<{ printJobId: string }>();
  return <PrintJobPage printJobId={printJobId}/>;
}
