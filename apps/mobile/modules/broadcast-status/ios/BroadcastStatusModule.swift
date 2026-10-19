import ExpoModulesCore

/// Relays the Darwin notification the broadcast extension posts in broadcastStarted
/// (plugins/broadcast-extension/SampleHandler.swift) to JS as `onBroadcastStarted`.
public class BroadcastStatusModule: Module {
  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("BroadcastStatus")

    Events("onBroadcastStarted")

    OnStartObserving("onBroadcastStarted") {
      self.startObserving()
    }

    OnStopObserving("onBroadcastStarted") {
      self.stopObserving()
    }

    OnDestroy {
      self.stopObserving()
    }
  }

  private var notificationName: CFNotificationName? {
    guard let groupId = Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") as? String else {
      return nil
    }
    return CFNotificationName("\(groupId).broadcast.started" as CFString)
  }

  private func startObserving() {
    guard !observing, let name = notificationName else { return }
    observing = true
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      { _, observer, _, _, _ in
        guard let observer else { return }
        Unmanaged<BroadcastStatusModule>.fromOpaque(observer).takeUnretainedValue()
          .sendEvent("onBroadcastStarted")
      },
      name.rawValue, nil, .deliverImmediately)
  }

  private func stopObserving() {
    guard observing else { return }
    observing = false
    CFNotificationCenterRemoveEveryObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
  }
}
