import type { Metadata } from "next";

export const metadata: Metadata = { title: "Recordings" };

export default function RecordingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
