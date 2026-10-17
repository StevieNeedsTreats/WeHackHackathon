import { cookies } from "next/headers";
import { AuthGate } from "@/components/AuthGate";
import Home from "@/components/Home";
import { LAYOUT_COOKIE, parseLayout } from "@/lib/layout-cookie";

// Read the saved panel layout on the server so the first paint already has the user's sizes.
export default async function Page() {
  const jar = await cookies();
  return (
    <AuthGate>
      <Home defaultLayout={parseLayout(jar.get(LAYOUT_COOKIE)?.value)} />
    </AuthGate>
  );
}
