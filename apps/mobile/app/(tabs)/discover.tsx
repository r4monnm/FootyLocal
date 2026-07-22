import { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import MapView, { Marker, type Region } from "react-native-maps";
import { toGamesNearFilters, roundPublicDistance, GAME_BANDS, type DiscoverFilters, type GameBand } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Title, Badge, Muted } from "../../components/ui";
import { MapSkin } from "../../components/map-skin";
import { colors, radius, space, font } from "../../theme";
import { SafeAreaView } from "react-native-safe-area-context";

/** One games_near row, as Discover uses it.
 *
 * SAFETY: precise_lat/precise_lng are deliberately NOT part of this type. The
 * RPC does return them for games the viewer is on, but Discover must never
 * plot them — the exact pitch is revealed only on the game detail screen,
 * behind the join gate. Keeping them out of the type keeps them un-plottable. */
type Row = {
  id: string; title: string; skill_band: string; format: string; price_cents: number;
  starts_at: string; is_women_only: boolean; max_players: number; joined_count: number;
  host_name: string | null; distance_meters: number;
  public_lat: number; public_lng: number;
};

const DEFAULT_DELTA = 0.28;

export default function Discover() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<DiscoverFilters>({ radiusMeters: 20000 });
  const [status, setStatus] = useState<string>("Finding games near you…");
  const [region, setRegion] = useState<Region | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<Row>>(null);

  const load = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") { setStatus("Location permission needed to find nearby games."); return; }
    const pos = await Location.getCurrentPositionAsync({});
    setRegion((r) => r ?? {
      latitude: pos.coords.latitude, longitude: pos.coords.longitude,
      latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA,
    });
    const { data, error } = await supabase.rpc("games_near", {
      lat: pos.coords.latitude, lng: pos.coords.longitude,
      radius_meters: filters.radiusMeters, filters: toGamesNearFilters(filters),
    });
    if (error) { setStatus("Couldn't load games."); return; }
    const list = (data ?? []) as Row[];
    setRows(list); setStatus(list.length ? "" : "No games nearby. Widen your search.");
  }, [filters]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function select(g: Row, from: "pin" | "card") {
    setSelectedId(g.id);
    if (from === "pin") {
      const i = rows.findIndex((r) => r.id === g.id);
      if (i >= 0) listRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.2 });
    } else {
      mapRef.current?.animateToRegion({
        latitude: g.public_lat, longitude: g.public_lng,
        latitudeDelta: DEFAULT_DELTA / 3, longitudeDelta: DEFAULT_DELTA / 3,
      }, 300);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingHorizontal: space(6), paddingTop: space(2), gap: space(3) }}>
        <Title>Discover</Title>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          {(["", ...GAME_BANDS] as (GameBand | "")[]).map((b) => {
            const active = (filters.skillBand ?? "") === b;
            return (
              <Pressable key={b || "all"} onPress={() => setFilters({ ...filters, skillBand: (b || undefined) as GameBand | undefined })}
                style={{ backgroundColor: active ? colors.accent : colors.gray, borderWidth: 1, borderColor: active ? colors.accent : colors.border, borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1.5) }}>
                <Text style={{ color: active ? colors.onAccent : colors.ink, fontSize: 11, textTransform: "uppercase", fontFamily: font.bodySemibold }}>{b || "All"}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Upper pane: fuzzed pins only. */}
      <View style={{ height: "38%", marginTop: space(3), marginHorizontal: space(4), borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
        {region ? (
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={region}
            // Recolored to the app palette by <MapSkin/> below — see that file
            // for why a truly designed basemap needs a development build.
            mapType="standard"
            // Not honored in Expo Go (native build-time setting); kept so a
            // dev/production build renders the dark basemap.
            userInterfaceStyle="dark"
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
            showsPointsOfInterests={false}
            toolbarEnabled={false}
          >
            {rows.map((g) => (
              <Marker
                key={g.id}
                coordinate={{ latitude: g.public_lat, longitude: g.public_lng }}
                // The MapSkin `color` blend keeps only luminance, so pins must
                // be bright to survive it. Selected goes to white = brightest.
                pinColor={g.id === selectedId ? "#FFFFFF" : "#CCFF00"}
                title={g.title}
                description={`${roundPublicDistance(g.distance_meters)} · approximate area`}
                onPress={() => select(g, "pin")}
              />
            ))}
          </MapView>
        ) : null}
        {region ? (
          <MapSkin />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.gray }}>
            <Muted>Locating…</Muted>
          </View>
        )}
      </View>
      <Text style={{ color: colors.muted, fontFamily: font.body, fontSize: 11, paddingHorizontal: space(6), paddingTop: space(2) }}>
        Pins show the approximate area. The exact pitch appears once you join.
      </Text>

      {/* Lower pane: the same rows as a list. */}
      <View style={{ flex: 1, paddingHorizontal: space(6), paddingTop: space(3) }}>
        {status ? <Muted>{status}</Muted> : null}
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: space(3), paddingBottom: space(10) }}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item }) => {
            const spots = item.max_players - Number(item.joined_count);
            const active = item.id === selectedId;
            return (
              <Pressable
                onPress={() => select(item, "card")}
                onLongPress={() => router.push(`/game/${item.id}`)}
                style={{ backgroundColor: colors.gray, borderRadius: radius.card, borderWidth: 1, borderColor: active ? colors.accent : colors.border, padding: space(4), gap: space(1) }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontFamily: font.display, fontSize: 22, color: colors.ink }}>{item.title}</Text>
                  <Badge tone="accent">{item.skill_band}</Badge>
                </View>
                <Muted>{item.host_name ?? "—"} · {roundPublicDistance(item.distance_meters)}</Muted>
                <Muted>{spots} of {item.max_players} spots · {item.price_cents > 0 ? `$${(item.price_cents / 100).toFixed(0)}` : "Free"}</Muted>
                <Pressable onPress={() => router.push(`/game/${item.id}`)} hitSlop={6} style={{ alignSelf: "flex-start", marginTop: space(1) }}>
                  <Text style={{ color: colors.accent, fontFamily: font.bodySemibold, fontSize: 12, textTransform: "uppercase" }}>View game →</Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}
