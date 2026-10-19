import { requireOptionalNativeModule } from "expo";

type ScreenAudioNative = {
  isAvailable(): boolean;
  start(screenTrackId: string): Promise<void>;
  stop(): void;
  setMicMuted(muted: boolean): void;
};

// Android only. Device audio rides on the microphone track (see DeviceAudioMixer.kt), so while it
// runs, mute the mic with setMicMuted instead of disabling the track.
const native = requireOptionalNativeModule<ScreenAudioNative>("ScreenAudio");

export const isDeviceAudioAvailable = (): boolean => native?.isAvailable() ?? false;

/** Mix device media/game playback into the outgoing mic audio while `screenTrackId` is shared. */
export async function startDeviceAudio(screenTrackId: string): Promise<void> {
  if (!native) throw new Error("Device audio isn't supported on this platform");
  await native.start(screenTrackId);
}

export function stopDeviceAudio(): void {
  native?.stop();
  native?.setMicMuted(false);
}

export function setDeviceAudioMicMuted(muted: boolean): void {
  native?.setMicMuted(muted);
}
