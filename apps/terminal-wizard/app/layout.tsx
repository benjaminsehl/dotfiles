import type { Metadata } from "next";
import "@wterm/react/css";
import "./globals.css";

const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

export const metadata: Metadata = {
  metadataBase: new URL(deploymentHost ? `https://${deploymentHost}` : "http://127.0.0.1:4317"),
  title: "Terminal Tutor · Own your Mac CLI",
  description: "An interactive field guide to Benjamin’s Ghostty, zsh, Herdr, OMP, and modern developer toolchain.",
  applicationName: "Terminal Tutor",
  openGraph: {
    title: "Terminal Tutor",
    description: "Own your terminal. Practice safely in the browser, then graduate to the local Mac app.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
