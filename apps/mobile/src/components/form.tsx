import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type LayoutChangeEvent, type TextInputProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, motion, ui } from "@/lib/theme";
import { Enter } from "./motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Glass panel. `index` staggers several cards on one screen so they arrive in reading order. */
export function Card({ title, subtitle, children, index = 0 }: { title?: string; subtitle?: string; children: ReactNode; index?: number }) {
  return (
    <Enter style={ui.card} delay={index * motion.stagger}>
      {title ? <Text style={ui.title}>{title}</Text> : null}
      {subtitle ? <Text style={ui.muted}>{subtitle}</Text> : null}
      {children}
    </Enter>
  );
}

export function Field({ label, style, onFocus, onBlur, editable, ...props }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ opacity: editable === false ? 0.45 : 1 }}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        placeholderTextColor="rgba(148,163,184,0.6)"
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
        style={[ui.input, focused && ui.inputFocused, style]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
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
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy }}
      onPress={onPress}
      onPressIn={() => scale.set(withTiming(0.98, { duration: motion.micro, easing: motion.easeOut }))}
      onPressOut={() => scale.set(withTiming(1, { duration: motion.ui, easing: motion.easeOut }))}
      disabled={disabled || busy}
      style={[ui.button, primary && ui.buttonPrimary, { opacity: disabled ? 0.45 : 1 }, pressStyle]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.accentText : colors.text} />
      ) : (
        <Text style={[ui.buttonText, primary && ui.buttonTextPrimary]}>{title}</Text>
      )}
    </AnimatedPressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <Enter rise={0} duration={motion.pop}>
      <Text style={ui.error} accessibilityLiveRegion="polite">
        {children}
      </Text>
    </Enter>
  ) : null;
}

/** Segmented tabs; the selected pill slides between options instead of jumping. */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const segment = width / options.length;
  const indicator = useAnimatedStyle(() => ({
    width: segment,
    transform: [{ translateX: withTiming(index * segment, { duration: motion.pop, easing: motion.easeOut }) }],
  }));
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 8)}
      style={{
        flexDirection: "row",
        padding: 4,
        borderRadius: 14,
        backgroundColor: colors.field,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 4,
              bottom: 4,
              left: 4,
              borderRadius: 10,
              backgroundColor: colors.surface2,
              borderTopWidth: 1,
              borderTopColor: "rgba(255,255,255,0.08)",
            },
            indicator,
          ]}
        />
      )}
      {options.map((o) => (
        <Pressable
          key={o.id}
          accessibilityRole="tab"
          accessibilityState={{ selected: o.id === value }}
          onPress={() => onChange(o.id)}
          style={{ flex: 1, paddingVertical: 10, alignItems: "center" }}
        >
          <Text style={{ color: o.id === value ? colors.text : colors.muted, fontWeight: "600", fontSize: 15 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
