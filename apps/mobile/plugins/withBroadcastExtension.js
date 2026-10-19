// Enables iOS screen sharing: adds a ReplayKit Broadcast Upload Extension target, an App Group
// shared by the app and the extension, and the Info.plist keys react-native-webrtc reads
// (RTCAppGroupIdentifier for the socket path, RTCScreenSharingExtension for the picker).
// The Swift sources live in ./broadcast-extension and are copied into ios/ on prebuild.
const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");
const plist = require("@expo/plist").default;

const EXTENSION_NAME = "BroadcastExtension";
const SOURCES = ["SampleHandler.swift", "SampleUploader.swift", "SocketConnection.swift"];
const SOURCE_DIR = path.join(__dirname, "broadcast-extension");

function ids(config) {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error("withBroadcastExtension: ios.bundleIdentifier is required");
  return { appGroup: `group.${bundleId}`, extensionBundleId: `${bundleId}.${EXTENSION_NAME}` };
}

function addAppGroup(entitlements, appGroup) {
  const key = "com.apple.security.application-groups";
  entitlements[key] = Array.from(new Set([...(entitlements[key] ?? []), appGroup]));
  return entitlements;
}

function withAppConfig(config) {
  const { appGroup, extensionBundleId } = ids(config);
  config = withEntitlementsPlist(config, (cfg) => {
    addAppGroup(cfg.modResults, appGroup);
    return cfg;
  });
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.RTCAppGroupIdentifier = appGroup;
    cfg.modResults.RTCScreenSharingExtension = extensionBundleId;
    return cfg;
  });
}

function withExtensionFiles(config) {
  const { appGroup } = ids(config);
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, EXTENSION_NAME);
      fs.mkdirSync(dir, { recursive: true });
      for (const file of SOURCES) fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(dir, file));
      fs.writeFileSync(
        path.join(dir, "Info.plist"),
        plist.build({
          CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
          CFBundleDisplayName: cfg.name,
          CFBundleExecutable: "$(EXECUTABLE_NAME)",
          CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
          CFBundleInfoDictionaryVersion: "6.0",
          CFBundleName: "$(PRODUCT_NAME)",
          CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
          CFBundleShortVersionString: "$(MARKETING_VERSION)",
          CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
          RTCAppGroupIdentifier: appGroup,
          NSExtension: {
            NSExtensionPointIdentifier: "com.apple.broadcast-services-upload",
            NSExtensionPrincipalClass: "$(PRODUCT_MODULE_NAME).SampleHandler",
            RPBroadcastProcessMode: "RPBroadcastProcessModeSampleBuffer",
          },
        }),
      );
      fs.writeFileSync(
        path.join(dir, `${EXTENSION_NAME}.entitlements`),
        plist.build(addAppGroup({}, appGroup)),
      );
      return cfg;
    },
  ]);
}

function withExtensionTarget(config) {
  const { extensionBundleId } = ids(config);
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(EXTENSION_NAME)) return cfg;

    // Inherit version, deployment target and team from the app target so the two stay in sync.
    const appTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName: cfg.modRequest.projectName,
    });
    const appConfigRefs =
      project.pbxXCConfigurationList()[appTarget.target.buildConfigurationList].buildConfigurations;
    const appSettings = project.pbxXCBuildConfigurationSection()[appConfigRefs[0].value].buildSettings;

    const target = project.addTarget(EXTENSION_NAME, "app_extension", EXTENSION_NAME, extensionBundleId);

    // addTarget names the embed phase "Copy Files" with the plugins destination; give it Xcode's usual name.
    const copyPhases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {};
    for (const [key, phase] of Object.entries(copyPhases)) {
      if (typeof phase === "object" && phase.name === '"Copy Files"' && phase.dstSubfolderSpec === 13) {
        phase.name = '"Embed Foundation Extensions"';
        copyPhases[`${key}_comment`] = "Embed Foundation Extensions";
      }
    }

    // Build the extension before the app embeds it.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    project.addTargetDependency(appTarget.uuid, [target.uuid]);

    const group = project.addPbxGroup(
      [...SOURCES, "Info.plist", `${EXTENSION_NAME}.entitlements`],
      EXTENSION_NAME,
      EXTENSION_NAME,
    );
    const mainGroupId = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroupId);

    project.addBuildPhase(SOURCES, "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    // ReplayKit is auto-linked through Swift's `import ReplayKit`.
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    const configurations = project.pbxXCBuildConfigurationSection();
    const listId = target.pbxNativeTarget.buildConfigurationList;
    for (const ref of project.pbxXCConfigurationList()[listId].buildConfigurations) {
      const settings = configurations[ref.value].buildSettings;
      Object.assign(settings, {
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CLANG_ENABLE_MODULES: "YES",
        CODE_SIGN_ENTITLEMENTS: `${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements`,
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: appSettings.CURRENT_PROJECT_VERSION ?? "1",
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${EXTENSION_NAME}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: appSettings.IPHONEOS_DEPLOYMENT_TARGET ?? "16.4",
        MARKETING_VERSION: appSettings.MARKETING_VERSION ?? "1.0",
        PRODUCT_BUNDLE_IDENTIFIER: extensionBundleId,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        SDKROOT: "iphoneos",
        SKIP_INSTALL: "YES",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: '"1,2"',
      });
      const team = cfg.ios?.appleTeamId ?? appSettings.DEVELOPMENT_TEAM;
      if (team) settings.DEVELOPMENT_TEAM = team;
    }
    return cfg;
  });
}

module.exports = function withBroadcastExtension(config) {
  config = withAppConfig(config);
  config = withExtensionFiles(config);
  return withExtensionTarget(config);
};
