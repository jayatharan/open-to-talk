import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, ui } from "@/lib/theme";

export function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={ui.card}>
      <Text style={ui.title}>{title}</Text>
      {subtitle ? <Text style={ui.muted}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={ui.input}
        {...props}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  primary,
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        ui.button,
        primary && ui.buttonPrimary,
        { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={colors.text} /> : <Text style={ui.buttonText}>{title}</Text>}
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <Text style={ui.error}>{children}</Text> : null;
}
