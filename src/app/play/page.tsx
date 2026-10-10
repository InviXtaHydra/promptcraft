import type { Metadata } from "next";
import { SessionsHub } from "@/components/game/sessions-hub";

export const metadata: Metadata = { title: "Your investigations" };

export default function PlayPage() {
  return <SessionsHub />;
}
