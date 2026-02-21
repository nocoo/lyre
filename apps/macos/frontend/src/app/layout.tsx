import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lyre",
  description: "Audio recording management for macOS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
