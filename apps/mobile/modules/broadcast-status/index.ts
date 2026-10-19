import { type EventSubscription, NativeModule, requireOptionalNativeModule } from "expo";

type BroadcastStatusEvents = { onBroadcastStarted: () => void };

declare class BroadcastStatusModule extends NativeModule<BroadcastStatusEvents> {}

// iOS only: fires when the user taps "Start Broadcast" in the system picker and the open2talk
// broadcast extension starts (see plugins/broadcast-extension/SampleHandler.swift).
const native = requireOptionalNativeModule<BroadcastStatusModule>("BroadcastStatus");

export function addBroadcastStartedListener(listener: () => void): EventSubscription | null {
  return native?.addListener("onBroadcastStarted", listener) ?? null;
}
