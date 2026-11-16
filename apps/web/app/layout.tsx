import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KOMAR Inventory", template: "%s · KOMAR" },
  description: "Dashboard admin untuk Session PO, RFID, dan label.",
  metadataBase: new URL("https://komar.local"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
