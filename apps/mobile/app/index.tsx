import { Redirect } from "expo-router";
import { useSession } from "../lib/session";

// Cold start lands on "/" — without this route expo-router renders +not-found
// and the Gate's redirect never takes effect.
export default function Index() {
  const { session, loading } = useSession();
  if (loading) return null;
  return <Redirect href={session ? "/(tabs)/discover" : "/(auth)/sign-in"} />;
}
