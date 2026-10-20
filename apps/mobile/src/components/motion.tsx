import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { motion } from "@/lib/theme";

/**
 * Fade + rise (or scale) on mount, driven by a plain animated style rather than Reanimated's
 * layout-animation system (`entering` / `layout`). On Android, layout animations that are still
 * running when a screen is popped can leave a null child in the view tree and crash when the
 * previous screen is re-attached, so screens that come and go quickly use this instead.
 */
export function useEnter({ delay = 0, rise = motion.rise, scale = 1, duration = motion.enter } = {}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.set(withDelay(delay, withTiming(1, { duration, easing: motion.easeOut })));
  }, [delay, duration, progress, reduced]);
  return useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * rise }, { scale: scale + (1 - scale) * p }],
    };
  });
}

type EnterOptions = NonNullable<Parameters<typeof useEnter>[0]>;

/** `useEnter` as a wrapper, for lists and conditional elements. */
export function Enter({
  children,
  style,
  pointerEvents,
  ...options
}: EnterOptions & { children?: ReactNode; style?: StyleProp<ViewStyle>; pointerEvents?: "none" | "auto" | "box-none" | "box-only" }) {
  const enter = useEnter(options);
  return (
    <Animated.View style={[style, enter]} pointerEvents={pointerEvents}>
      {children}
    </Animated.View>
  );
}
