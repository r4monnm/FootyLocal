import { ReactNode } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, space, font } from "../theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: space(6), gap: space(5) }}>{children}</ScrollView>
    </SafeAreaView>
  );
}
export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: font.display, fontSize: 44, color: colors.ink, textTransform: "uppercase" }}>{children}</Text>;
}
export function Badge({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "accent" }) {
  const bg = tone === "accent" ? colors.accent : colors.ink;
  const fg = tone === "accent" ? colors.ink : colors.surface;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1.5), alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontFamily: font.bodySemibold, fontSize: 12, textTransform: "uppercase" }}>{children}</Text>
    </View>
  );
}
export function Button({ label, onPress, variant = "primary", disabled }: { label: string; onPress?: () => void; variant?: "primary" | "accent" | "outline"; disabled?: boolean }) {
  const styles = variant === "accent" ? { bg: colors.ink, fg: colors.accent } : variant === "outline" ? { bg: colors.surface, fg: colors.ink } : { bg: colors.ink, fg: colors.surface };
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={{ backgroundColor: styles.bg, borderColor: colors.ink, borderWidth: variant === "outline" ? 1 : 0, borderRadius: radius.pill, paddingVertical: space(4), paddingHorizontal: space(8), alignItems: "center", opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: styles.fg, fontFamily: font.bodySemibold, fontSize: 14, textTransform: "uppercase" }}>{label}</Text>
    </Pressable>
  );
}
export function Field(props: TextInputProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: space(1) }}>
      <Text style={{ fontSize: 12, textTransform: "uppercase", color: colors.muted, fontFamily: font.bodySemibold }}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(3), fontFamily: font.body, color: colors.ink }} {...rest} />
    </View>
  );
}
export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(4), alignItems: "center", flex: 1 }}>
      <Text style={{ fontFamily: font.display, fontSize: 28, color: colors.ink }}>{value}</Text>
      <Text style={{ fontSize: 11, textTransform: "uppercase", color: colors.muted }}>{label}</Text>
    </View>
  );
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.muted, fontFamily: font.body }}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.error, fontFamily: font.body }}>{children}</Text>;
}
const _s = StyleSheet.create({});
