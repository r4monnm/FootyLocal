import { useCallback, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Badge, Muted } from "../../components/ui";
import { colors, radius, space, font } from "../../theme";

type Row = { id: string; title: string; starts_at: string; venue_name: string; is_past: boolean; status: string; player_status: string };

export default function MyGames() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  useFocusEffect(useCallback(() => {
    supabase.rpc("my_games").then(({ data }) => setRows((data ?? []) as Row[]));
  }, []));
  const upcoming = rows.filter((r) => !r.is_past);
  const past = rows.filter((r) => r.is_past);
  const Card = (r: Row) => (
    <Pressable key={r.id} onPress={() => router.push(`/game/${r.id}`)}
      style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(4), gap: space(1) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: font.display, fontSize: 20, color: colors.ink }}>{r.title}</Text>
        <Badge tone={r.status === "confirmed" ? "accent" : "ink"}>{r.player_status === "waitlisted" ? "waitlist" : r.status}</Badge>
      </View>
      <Muted>{r.venue_name} · {new Date(r.starts_at).toLocaleString()}</Muted>
    </Pressable>
  );
  return (
    <Screen>
      <Title>My Games</Title>
      <Muted>Upcoming</Muted>
      {upcoming.length ? upcoming.map(Card) : <Muted>Nothing upcoming.</Muted>}
      <Muted>Past</Muted>
      {past.length ? past.map(Card) : <Muted>No past games yet.</Muted>}
    </Screen>
  );
}
