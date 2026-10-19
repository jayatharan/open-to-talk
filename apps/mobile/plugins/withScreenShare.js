// Enables Android screen sharing through react-native-webrtc's MediaProjection foreground
// service (required on Android 10+, and with the typed permission on Android 14+).
const { AndroidConfig, withMainApplication } = require("expo/config-plugins");

function withScreenSharePermissions(config) {
  return AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.POST_NOTIFICATIONS",
  ]);
}

function withMediaProjectionService(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("enableMediaProjectionService")) return cfg;
    const isKotlin = cfg.modResults.language === "kt";
    const importLine = isKotlin
      ? "import com.oney.WebRTCModule.WebRTCModuleOptions"
      : "import com.oney.WebRTCModule.WebRTCModuleOptions;";
    const enableLine = isKotlin
      ? "    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true"
      : "    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true;";
    src = src.replace(/^(package .*)$/m, `$1\n\n${importLine}`);
    src = src.replace(/(super\.onCreate\(\)\;?)/, `$1\n${enableLine}`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withScreenShare(config) {
  config = withScreenSharePermissions(config);
  return withMediaProjectionService(config);
};
