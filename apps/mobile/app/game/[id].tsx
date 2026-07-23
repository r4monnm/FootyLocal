import { useCallback, useState } from "react";
import { View, Text, Linking } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Link } from "expo-router";
import MapView, { Marker } from "react-native-maps";
import { computeTier, verificationSummary, googleDirectionsUrl, friendlyGameError, type SkillBand } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Badge, Button, Muted, ErrorText } from "../../components/ui";
import { MapSkin } from "../../components/map-skin";
import { mapProviderProps, needsSkin } from "../../components/map-provider";
import { GamePin } from "../../components/game-pin";
import { colors, radius, space, font } from "../../theme";

type Detail = {
  id: string; title: string; description: string | null; skill_band: string; format: string;
  price_cents: number; starts_at: string; ends_at: string; status: string; max_players: number;
  min_players_to_confirm: number; host_id: string; host_name: string | null;
  venue_name: string; venue_address: string; surface_type: string; joined_count: number;
  viewer_joined: boolean; viewer_status: string | null;
  precise_lat: number | null; precise_lng: number | null;
  roster: { player_id: string; name: string | null; role: string }[] | null;
};
const VERIF_LABEL: Record<"phone" | "photo" | "id", string> = { phone: "Phone ✓", photo: "Photo ✓", id: "ID ✓" };

export default function GameDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [game, setGame] = useState<Detail | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [hostBand, setHostBand] = useState<string>("");
  const [hostBadges, setHostBadges] = useState<("phone" | "photo" | "id")[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("game_detail", { p_game_id: id });
    const g = (data?.[0] ?? null) as Detail | null;
    setGame(g);
    if (!g) return;
    const { data: { user } } = await supabase.auth.getUser();
    setViewerId(user?.id ?? null);
    if (user) {
      const { data: me } = await supabase.from("profiles").select("phone_verified").eq("id", user.id).single();
      setPhoneVerified(me?.phone_verified ?? false);
    }
    const [{ data: s }, { data: hp }] = await Promise.all([
      supabase.rpc("profile_stats", { p_user_id: g.host_id }),
      supabase.from("profiles").select("self_reported_skill, phone_verified, photo_verified, id_verified").eq("id", g.host_id).single(),
    ]);
    const stat = s?.[0];
    setHostBand(computeTier(stat?.avg_skill != null ? Number(stat.avg_skill) : null, stat ? Number(stat.ratings_count) : 0, (hp?.self_reported_skill ?? null) as SkillBand | null).band);
    setHostBadges(verificationSummary({ phone_verified: hp?.phone_verified ?? false, photo_verified: hp?.photo_verified ?? false, id_verified: hp?.id_verified ?? false }).badges);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function join() {
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("join_game", { p_game_id: id });
    setBusy(false);
    if (error) setError(friendlyGameError(error.message));
    else if (typeof data === "string" && !["joined", "waitlisted"].includes(data)) setError(friendlyGameError(data));
    else load();
  }
  async function leave() {
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("leave_game", { p_game_id: id });
    setBusy(false);
    if (error) setError(friendlyGameError(error.message)); else load();
  }

  if (!game) return <Screen><Muted>Game not found.</Muted></Screen>;
  const spots = game.max_players - Number(game.joined_count);
  const isPaid = game.price_cents > 0;
  const isCancelled = game.status === "cancelled";
  const isWaitlisted = game.viewer_status === "waitlisted";
  const isHost = viewerId != null && viewerId === game.host_id;

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Title>{game.title}</Title>
        <Badge tone="accent">{game.skill_band}</Badge>
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Muted>{game.venue_name}</Muted>
      <Muted>Kick off · {new Date(game.starts_at).toLocaleString()}</Muted>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
        <Muted>Host: {game.host_name ?? "—"} · {hostBand.toUpperCase()}</Muted>
        {hostBadges.map((b) => <Badge key={b} tone="accent">{VERIF_LABEL[b]}</Badge>)}
      </View>
      <Muted>{spots} of {game.max_players} spots · {isPaid ? `$${(game.price_cents / 100).toFixed(0)}` : "Free"}</Muted>
      {game.status === "confirmed" && <Badge tone="accent">confirmed</Badge>}
      {isCancelled && <ErrorText>This game was cancelled.</ErrorText>}
      {game.description ? <Text style={{ color: colors.ink, fontFamily: font.body }}>{game.description}</Text> : null}

      {game.viewer_joined ? (
        <View style={{ gap: space(3) }}>
          <Text style={{ fontFamily: font.display, fontSize: 24, color: colors.ink }}>YOU'RE IN</Text>
          <Muted>{game.venue_address}</Muted>
          {/* Reveal map: precise pitch. game_detail returns NULL coordinates
              off-roster, so this whole block renders nothing until you join. */}
          {game.precise_lat != null && game.precise_lng != null && (
            <>
              <View style={{ height: 180, borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                <MapView
                  style={{ flex: 1 }}
                  initialRegion={{ latitude: game.precise_lat, longitude: game.precise_lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }}
                  {...mapProviderProps}
                  mapType="standard"
                  userInterfaceStyle="dark"
                  showsCompass={false}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  toolbarEnabled={false}
                >
                  <Marker coordinate={{ latitude: game.precise_lat, longitude: game.precise_lng }} title={game.venue_name} tracksViewChanges={false}>
                    <GamePin selected />
                  </Marker>
                </MapView>
                {needsSkin ? <MapSkin /> : null}
              </View>
              <Button label="Open in Maps" variant="outline" onPress={() => Linking.openURL(googleDirectionsUrl(game.precise_lat!, game.precise_lng!))} />
            </>
          )}
          <View style={{ gap: space(1) }}>
            <Muted>Squad</Muted>
            {(game.roster ?? []).map((r) => (
              <Text key={r.player_id} style={{ color: colors.ink, fontFamily: font.body }}>{r.name ?? "Player"}{r.role === "host" ? " · host" : ""}</Text>
            ))}
          </View>
          {isHost
            ? <Muted>You're hosting this game.</Muted>
            : <Button label={busy ? "…" : "Leave game"} variant="outline" onPress={leave} disabled={busy} />}
        </View>
      ) : (
        <View style={{ gap: space(3) }}>
          <Muted>Approximate area only. The exact pitch appears once you join.</Muted>
          {isCancelled ? null : isWaitlisted ? (
            <Button label={busy ? "…" : "Leave waitlist"} variant="outline" onPress={leave} disabled={busy} />
          ) : !phoneVerified ? (
            <Link href="/(auth)/verify-phone"><Text style={{ color: colors.ink, fontFamily: font.bodySemibold, textTransform: "uppercase" }}>Verify your phone to join →</Text></Link>
          ) : isPaid ? (
            <Button label="Paid join — coming to mobile" variant="accent" disabled />
          ) : (
            <Button label={busy ? "…" : spots > 0 ? "Join game" : "Join waitlist"} variant="accent" onPress={join} disabled={busy} />
          )}
        </View>
      )}
    </Screen>
  );
}
