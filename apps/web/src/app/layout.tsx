import type { Metadata } from "next";
import { Inter, DM_Sans } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXTAUTH_URL || "http://localhost:7016",
  ),
  title: {
    default: "Lyre - Audio Transcription Manager",
    template: "%s - Lyre",
  },
  description:
    "Upload, transcribe, and explore your audio recordings with word-level precision. Powered by ASR with karaoke playback, full-text search, and smart organization.",
  openGraph: {
    title: "Lyre - Audio Transcription Manager",
    description:
      "Upload, transcribe, and explore your audio recordings with word-level precision.",
    siteName: "Lyre",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking script: apply dark class before first paint to prevent FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme:dark)").matches;if(s==="dark"||(s!=="light"&&d))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${dmSans.variable} antialiased`}>
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
