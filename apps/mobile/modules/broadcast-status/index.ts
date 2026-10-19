import { type EventSubscription, NativeModule, requireOptionalNativeModule } from "expo";

type BroadcastStatusEvents = { onBroadcastStarted: () => void; onBroadcastFinished: () => void };

declare class BroadcastStatusModule extends NativeModule<BroadcastStatusEvents> {}

// iOS only: reports the open2talk broadcast extension's lifecycle
// (see plugins/broadcast-extension/SampleHandler.swift).
const native = requireOptionalNativeModule<BroadcastStatusModule>("BroadcastStatus");

/** Fires when the user taps "Start Broadcast" in the system picker and the extension starts. */
export function addBroadcastStartedListener(listener: () => void): EventSubscription | null {
  return native?.addListener("onBroadcastStarted", listener) ?? null;
}

/** Fires when the extension ends, however it was stopped. */
export function addBroadcastFinishedListener(listener: () => void): EventSubscription | null {
  return native?.addListener("onBroadcastFinished", listener) ?? null;
}
