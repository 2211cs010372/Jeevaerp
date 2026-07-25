import type { Metadata } from "next";
import { NotFoundPanel } from "@/components/marketing/not-found-panel";

export const metadata: Metadata = { title: "Page not found" };

/** Catches notFound() from the public pages - keeps the navbar and footer. */
export default function PublicNotFound() {
  return <NotFoundPanel />;
}
