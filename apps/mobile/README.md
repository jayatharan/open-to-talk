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
- Screen sharing on Android uses MediaProjection (`plugins/withScreenShare.js`). Sending device audio and iOS screen sharing (ReplayKit broadcast extension) aren't implemented yet; see the root README.
