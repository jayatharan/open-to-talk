# open2talk mobile (Expo)

The Android and iOS app. It uses `react-native-webrtc`, so it needs a **development build**; Expo Go won't work.

```bash
pnpm --filter @open2talk/mobile ios
```

```bash
pnpm --filter @open2talk/mobile android
```

On first launch, set the **server host** (e.g. `192.168.1.20:3000` for a dev server on your LAN, or `https://talk.example.com`).

Notes:

- If port 8081 is taken, start Metro on another port with `npx expo start --dev-client --port 8082`. Then point the dev build at it: open the dev menu and choose "Configure bundler", or run `xcrun simctl spawn booted defaults write org.open2talk.app RCT_jsLocation "127.0.0.1:8082"` on the iOS simulator.
- CocoaPods needs a UTF-8 locale. Run `export LANG=en_US.UTF-8` if `pod install` fails with `Unicode Normalization not appropriate for ASCII-8BIT`.
- `ios.usePrecompiledModules` is off in `app.json`. SDK 58's prebuilt ExpoFileSystem binary didn't match the prebuilt ExpoModulesCore and crashed at launch.
- Screen sharing on Android uses MediaProjection (`plugins/withScreenShare.js`). On Android 10+ it also sends device audio: the local module `modules/screen-audio` records other apps' media, game and unknown-usage playback with `AudioPlaybackCaptureConfiguration` on react-native-webrtc's MediaProjection and mixes it into the microphone samples. libwebrtc gives every audio track the same `AudioDeviceModule` and no hook to edit recorded PCM, so a separate screen-audio track isn't possible without a native fork. Instead the module installs its own `JavaAudioDeviceModule` through `WebRTCModuleOptions` at app start and, when recording starts, swaps libwebrtc's private `AudioRecord` for a mixing subclass (reflection on `WebRtcAudioRecord.audioRecord`). The trade-offs: device audio rides the mic track, so it goes through WebRTC's voice processing (noise suppression can soften music), it needs a microphone track (so microphone permission), and while sharing, the mic button mutes only your voice in the mixer and leaves device audio flowing. Apps that opt out of playback capture (`allowAudioPlaybackCapture="false"`, or most DRM video) stay silent.
- iOS screen sharing (ReplayKit broadcast extension) isn't implemented yet; see the root README.
