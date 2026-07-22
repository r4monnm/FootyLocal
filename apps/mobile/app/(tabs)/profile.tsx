import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { computeTier, verificationSummary, type SkillBand } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Badge, Button, Muted, StatTile } from "../../components/ui";
import { space } from "../../theme";

const VERIF_LABEL: Record<"phone" | "photo" | "id", string> = { phone: "Phone ✓", photo: "Photo ✓", id: "ID ✓" };

export default function Profile() {
  const [name, setName] = useState<string | null>(null);
  const [band, setBand] = useState("beginner");
  const [source, setSource] = useState<"peer" | "self">("self");
  const [badges, setBadges] = useState<("phone" | "photo" | "id")[]>([]);
  const [stats, setStats] = useState({ karma: 0, games_played: 0, avg_skill: null as number | null, no_shows: 0, reliability: null as number | null });

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("profiles").select("display_name, self_reported_skill, phone_verified, photo_verified, id_verified").eq("id", user.id).single(),
        supabase.rpc("profile_stats", { p_user_id: user.id }),
      ]);
      setName(p?.display_name ?? null);
      const stat = s?.[0];
      if (stat) setStats(stat);
      const t = computeTier(stat?.avg_skill != null ? Number(stat.avg_skill) : null, stat ? Number(stat.ratings_count) : 0, (p?.self_reported_skill ?? null) as SkillBand | null);
      setBand(t.band); setSource(t.source);
      setBadges(verificationSummary({ phone_verified: p?.phone_verified ?? false, photo_verified: p?.photo_verified ?? false, id_verified: p?.id_verified ?? false }).badges);
    })();
  }, []));

  return (
    <Screen>
      <Title>{name ?? "Profile"}</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
        {badges.length ? badges.map((b) => <Badge key={b} tone="accent">{VERIF_LABEL[b]}</Badge>) : <Badge>unverified</Badge>}
        <Badge tone="accent">{band}</Badge>
        <Muted>{source === "peer" ? "peer-rated" : "self-rated"}</Muted>
      </View>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <StatTile label="Karma" value={Number(stats.karma)} />
        <StatTile label="Games" value={Number(stats.games_played)} />
        <StatTile label="Avg skill" value={stats.avg_skill != null ? Number(stats.avg_skill).toFixed(1) : "—"} />
      </View>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <StatTile label="No-shows" value={Number(stats.no_shows)} />
        <StatTile label="Reliability" value={stats.reliability != null ? `${Math.round(Number(stats.reliability) * 100)}%` : "—"} />
      </View>
      <Button label="Sign out" variant="outline" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
