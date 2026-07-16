import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MergeProof | Evidence-backed merge decisions",
  description: "Turn pull request intent into an explainable merge decision.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
