import { useCallback, useState } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { toGamesNearFilters, roundPublicDistance, GAME_BANDS, type DiscoverFilters, type GameBand } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Title, Badge, Muted } from "../../components/ui";
import { colors, radius, space, font } from "../../theme";
import { SafeAreaView } from "react-native-safe-area-context";

type Row = {
  id: string; title: string; skill_band: string; format: string; price_cents: number;
  starts_at: string; is_women_only: boolean; max_players: number; joined_count: number;
  host_name: string | null; distance_meters: number;
};

export default function Discover() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<DiscoverFilters>({ radiusMeters: 20000 });
  const [status, setStatus] = useState<string>("Finding games near you…");

  const load = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") { setStatus("Location permission needed to find nearby games."); return; }
    const pos = await Location.getCurrentPositionAsync({});
    const { data, error } = await supabase.rpc("games_near", {
      lat: pos.coords.latitude, lng: pos.coords.longitude,
      radius_meters: filters.radiusMeters, filters: toGamesNearFilters(filters),
    });
    if (error) { setStatus("Couldn't load games."); return; }
    const list = (data ?? []) as Row[];
    setRows(list); setStatus(list.length ? "" : "No games nearby. Widen your search.");
  }, [filters]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ padding: space(6), gap: space(4), flex: 1 }}>
        <Title>Discover</Title>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          {(["", ...GAME_BANDS] as (GameBand | "")[]).map((b) => {
            const active = (filters.skillBand ?? "") === b;
            return (
              <Pressable key={b || "all"} onPress={() => setFilters({ ...filters, skillBand: (b || undefined) as GameBand | undefined })}
                style={{ backgroundColor: active ? colors.ink : colors.gray, borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1.5) }}>
                <Text style={{ color: active ? colors.surface : colors.ink, fontSize: 11, textTransform: "uppercase", fontFamily: font.bodySemibold }}>{b || "All"}</Text>
              </Pressable>
            );
          })}
        </View>
        {status ? <Muted>{status}</Muted> : null}
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: space(3), paddingBottom: space(10) }}
          renderItem={({ item }) => {
            const spots = item.max_players - Number(item.joined_count);
            return (
              <Pressable onPress={() => router.push(`/game/${item.id}`)}
                style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(4), gap: space(1) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontFamily: font.display, fontSize: 22, color: colors.ink }}>{item.title}</Text>
                  <Badge tone="accent">{item.skill_band}</Badge>
                </View>
                <Muted>{item.host_name ?? "—"} · {roundPublicDistance(item.distance_meters)} away</Muted>
                <Muted>{spots} of {item.max_players} spots · {item.price_cents > 0 ? `$${(item.price_cents / 100).toFixed(0)}` : "Free"}</Muted>
              </Pressable>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}
