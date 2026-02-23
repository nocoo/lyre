import type { Metadata } from "next";

export const metadata: Metadata = { title: "Storage" };

export default function StorageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
