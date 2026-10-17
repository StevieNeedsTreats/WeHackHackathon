import { cookies } from "next/headers";
import Home from "@/components/Home";
import { LAYOUT_COOKIE, parseLayout } from "@/lib/layout-cookie";

// Read the saved panel layout on the server so the first paint already has the user's sizes.
export default async function Page() {
  const jar = await cookies();
  return <Home defaultLayout={parseLayout(jar.get(LAYOUT_COOKIE)?.value)} />;
}
