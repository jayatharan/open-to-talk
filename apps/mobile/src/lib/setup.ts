// Wire platform implementations into the shared, platform-agnostic core.
import { setCryptoProvider, type CryptoProvider, type EventSourceFactory, type EventSourceLike, type RtcImpl } from "@open2talk/core";
import QuickCrypto from "react-native-quick-crypto";
import EventSource from "react-native-sse";
import { MediaStream, RTCPeerConnection, registerGlobals } from "react-native-webrtc";

registerGlobals();
setCryptoProvider(QuickCrypto as unknown as CryptoProvider);

export const rtc: RtcImpl = {
  RTCPeerConnection: RTCPeerConnection as unknown as RtcImpl["RTCPeerConnection"],
  MediaStream: MediaStream as unknown as NonNullable<RtcImpl["MediaStream"]>,
};

/** react-native-sse with its own polling disabled: the core SignalingClient handles reconnects. */
export const eventSource: EventSourceFactory = (url) =>
  new EventSource(url, { pollingInterval: 0 }) as unknown as EventSourceLike;
