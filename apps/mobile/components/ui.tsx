import { ReactNode, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, space, font } from "../theme";
import { PitchLines } from "./pitch-lines";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: space(6), gap: space(5) }}>{children}</ScrollView>
    </SafeAreaView>
  );
}

/** Auth chrome: green bloom off the top edge, centered column. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <PitchLines />
      <LinearGradient
        colors={[colors.glow, "rgba(140,198,63,0.12)", "rgba(11,15,10,0)"]}
        locations={[0, 0.45, 1]}
        style={{ position: "absolute", top: -160, left: -80, right: -80, height: 520, borderBottomLeftRadius: 400, borderBottomRightRadius: 400 }}
      />
      <ScrollView contentContainerStyle={{ padding: space(6), gap: space(4), flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Wordmark() {
  return (
    <View style={{ alignItems: "center", marginBottom: space(4) }}>
      <Text style={{ fontFamily: font.display, fontSize: 34, color: colors.ink, letterSpacing: 1 }}>
        FOOTY<Text style={{ color: colors.accent }}>LOCAL</Text>
      </Text>
    </View>
  );
}

/** Centered heading + one line of supporting copy, per the reference. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ alignItems: "center", gap: space(2), marginBottom: space(2) }}>
      <Text style={{ fontFamily: font.bodySemibold, fontSize: 26, color: colors.ink, textAlign: "center" }}>{title}</Text>
      <Text style={{ fontFamily: font.body, fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 }}>{subtitle}</Text>
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: font.display, fontSize: 44, color: colors.ink, textTransform: "uppercase" }}>{children}</Text>;
}

export function Badge({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "accent" }) {
  const bg = tone === "accent" ? colors.accent : colors.gray;
  const fg = tone === "accent" ? colors.onAccent : colors.ink;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1.5), alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontFamily: font.bodySemibold, fontSize: 12, textTransform: "uppercase" }}>{children}</Text>
    </View>
  );
}

export function Button({ label, onPress, variant = "primary", disabled }: { label: string; onPress?: () => void; variant?: "primary" | "accent" | "outline"; disabled?: boolean }) {
  const s = variant === "accent"
    ? { bg: colors.accent, fg: colors.onAccent, border: colors.accent }
    : variant === "outline"
      ? { bg: "transparent", fg: colors.ink, border: colors.border }
      : { bg: colors.ink, fg: colors.surface, border: colors.ink };
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={{ backgroundColor: s.bg, borderColor: s.border, borderWidth: variant === "outline" ? 1 : 0, borderRadius: radius.pill, paddingVertical: space(4), paddingHorizontal: space(8), alignItems: "center", opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: s.fg, fontFamily: font.bodySemibold, fontSize: 14, textTransform: "uppercase" }}>{label}</Text>
    </Pressable>
  );
}

/** The reference's primary CTA: full-width lime gradient pill. */
export function GradientButton({ label, onPress, disabled }: { label: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        opacity: disabled ? 0.45 : 1,
        borderRadius: radius.pill,
        // Lime bloom under the pill so the CTA reads as lit, not painted.
        shadowColor: colors.accent,
        shadowOpacity: disabled ? 0 : 0.65,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        elevation: 10,
      }}
    >
      <LinearGradient
        colors={[colors.accentBright, colors.accent, colors.accentDeep]}
        locations={[0, 0.42, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.pill, paddingVertical: space(4), alignItems: "center" }}
      >
        <Text style={{ color: colors.onAccent, fontFamily: font.bodySemibold, fontSize: 15, letterSpacing: 0.3 }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

/** Dark pill input. The label lives inside as placeholder text, per the reference. */
export function PillField({ secureToggle, ...props }: TextInputProps & { secureToggle?: boolean }) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ justifyContent: "center" }}>
      <TextInput
        placeholderTextColor={colors.muted}
        secureTextEntry={secureToggle ? hidden : props.secureTextEntry}
        style={{
          backgroundColor: colors.gray, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
          paddingVertical: space(4), paddingLeft: space(5), paddingRight: secureToggle ? space(12) : space(5),
          fontFamily: font.body, fontSize: 15, color: colors.ink,
        }}
        {...props}
      />
      {secureToggle && (
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={12} style={{ position: "absolute", right: space(5) }}>
          <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

export function Checkbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", gap: space(3) }} hitSlop={8}>
      <View style={{
        width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
        borderColor: checked ? colors.accent : colors.border,
        backgroundColor: checked ? colors.accent : "transparent",
        alignItems: "center", justifyContent: "center",
      }}>
        {checked && <Text style={{ color: colors.onAccent, fontSize: 13, fontWeight: "900" }}>✓</Text>}
      </View>
      <Text style={{ color: colors.ink, fontFamily: font.body, fontSize: 14, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

/** Footer link line, e.g. "Already have an account? Sign in". */
export function AuthFooterLink({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: "center", marginTop: space(2) }} hitSlop={8}>
      <Text style={{ color: colors.muted, fontFamily: font.body, fontSize: 14 }}>
        {prompt} <Text style={{ color: colors.accent, fontFamily: font.bodySemibold }}>{action}</Text>
      </Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: space(1) }}>
      <Text style={{ fontSize: 12, textTransform: "uppercase", color: colors.muted, fontFamily: font.bodySemibold }}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.gray, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: space(3), fontFamily: font.body, color: colors.ink }}
        {...rest} />
    </View>
  );
}

/** Scoreboard cell: big lit numeral over a small engraved label. */
export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={{ backgroundColor: "#0A0D08", borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, paddingVertical: space(4), paddingHorizontal: space(2), alignItems: "center", flex: 1 }}>
      <Text style={{ fontFamily: font.display, fontSize: 30, color: colors.accent, letterSpacing: 1 }}>{value}</Text>
      <View style={{ height: 1, alignSelf: "stretch", backgroundColor: colors.border, marginVertical: space(1.5) }} />
      <Text style={{ fontSize: 10, textTransform: "uppercase", color: colors.muted, fontFamily: font.bodySemibold, letterSpacing: 0.6 }}>{label}</Text>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.muted, fontFamily: font.body }}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.error, fontFamily: font.body }}>{children}</Text>;
}
