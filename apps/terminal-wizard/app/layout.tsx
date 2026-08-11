import type { Metadata } from "next";
import "@wterm/react/css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://127.0.0.1:4317"),
  title: "Terminal Wizard · Own your Mac CLI",
  description: "A private, interactive field guide to Benjamin’s Ghostty, zsh, Herdr, OMP, and modern developer toolchain.",
  applicationName: "Terminal Wizard",
  openGraph: {
    title: "Terminal Wizard",
    description: "Own your terminal. Practice safely, then graduate to the real Mac.",
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
