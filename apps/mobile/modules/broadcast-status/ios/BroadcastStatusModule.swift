import ExpoModulesCore

/// Relays the Darwin notifications the broadcast extension posts
/// (plugins/broadcast-extension/SampleHandler.swift) to JS: `broadcast.started` from broadcastStarted
/// as `onBroadcastStarted`, and `broadcast.finished` as the extension ends as `onBroadcastFinished`.
public class BroadcastStatusModule: Module {
  private static let notifications = [
    "onBroadcastStarted": "broadcast.started",
    "onBroadcastFinished": "broadcast.finished",
  ]

  private var observed = Set<String>()

  public func definition() -> ModuleDefinition {
    Name("BroadcastStatus")

    Events("onBroadcastStarted", "onBroadcastFinished")

    OnStartObserving("onBroadcastStarted") {
      self.startObserving("onBroadcastStarted")
    }

    OnStopObserving("onBroadcastStarted") {
      self.stopObserving("onBroadcastStarted")
    }

    OnStartObserving("onBroadcastFinished") {
      self.startObserving("onBroadcastFinished")
    }

    OnStopObserving("onBroadcastFinished") {
      self.stopObserving("onBroadcastFinished")
    }

    OnDestroy {
      for event in self.observed { self.stopObserving(event) }
    }
  }

  private func notificationName(_ event: String) -> CFNotificationName? {
    guard let groupId = Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") as? String,
      let suffix = Self.notifications[event]
    else {
      return nil
    }
    return CFNotificationName("\(groupId).\(suffix)" as CFString)
  }

  private func startObserving(_ event: String) {
    guard !observed.contains(event), let name = notificationName(event) else { return }
    observed.insert(event)
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      { _, observer, name, _, _ in
        guard let observer, let name else { return }
        let module = Unmanaged<BroadcastStatusModule>.fromOpaque(observer).takeUnretainedValue()
        let posted = name.rawValue as String
        if let event = BroadcastStatusModule.notifications.first(where: { posted.hasSuffix(".\($0.value)") })?.key {
          module.sendEvent(event)
        }
      },
      name.rawValue, nil, .deliverImmediately)
  }

  private func stopObserving(_ event: String) {
    guard observed.contains(event), let name = notificationName(event) else { return }
    observed.remove(event)
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(),
      CFNotificationName(rawValue: name.rawValue), nil)
  }
}
