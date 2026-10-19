import ReplayKit

/// ReplayKit Broadcast Upload Extension for open2talk. It forwards screen frames to the app over the
/// Unix socket react-native-webrtc opens in the shared App Group container (`rtc_SSFD`); the app turns
/// them into the video track returned by mediaDevices.getDisplayMedia().
///
/// App audio (`.audioApp`) is not forwarded: react-native-webrtc's socket protocol and
/// getDisplayMedia() only carry a video track, and the WebRTC iOS SDK has no API for pushing PCM into
/// an audio track from outside its audio device module.
final class SampleHandler: RPBroadcastSampleHandler {
  private static let socketFileName = "rtc_SSFD"
  private static let connectTimeout: TimeInterval = 15

  private var connection: SocketConnection?
  private var uploader: SampleUploader?
  private var connectTimer: DispatchSourceTimer?
  private var groupId: String?
  private var postedFinished = false

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    guard let groupId = Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId)
    else {
      finish(reason: "open2talk is missing its App Group configuration.")
      return
    }
    self.groupId = groupId
    let connection = SocketConnection(filePath: container.appendingPathComponent(Self.socketFileName).path)
    connection.didClose = { [weak self] _ in self?.finish(reason: "Screen sharing stopped.") }
    self.connection = connection
    uploader = SampleUploader(connection: connection)
    connect(connection)
    // Tell the app the user started the broadcast (modules/broadcast-status); until then it holds
    // back the screen track getDisplayMedia() returned, since the user may dismiss the picker.
    post("broadcast.started")
  }

  private func post(_ event: String) {
    guard let groupId else { return }
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName("\(groupId).\(event)" as CFString), nil, nil, true)
  }

  /// Tells the app the extension is ending, so a re-share it starts right after an in-app stop waits
  /// for this broadcast to go away instead of opening a picker that still shows it running.
  private func postFinished() {
    guard !postedFinished else { return }
    postedFinished = true
    post("broadcast.finished")
  }

  /// The app only starts listening once JS calls getDisplayMedia(), so retry for a while.
  private func connect(_ connection: SocketConnection) {
    let deadline = Date().addingTimeInterval(Self.connectTimeout)
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "org.open2talk.broadcast.connect"))
    timer.schedule(deadline: .now(), repeating: .milliseconds(100))
    timer.setEventHandler { [weak self] in
      if connection.open() {
        self?.connectTimer?.cancel()
      } else if Date() > deadline {
        self?.connectTimer?.cancel()
        self?.finish(reason: "Start screen sharing from inside an open2talk call.")
      }
    }
    connectTimer = timer
    timer.resume()
  }

  private func finish(reason: String) {
    connectTimer?.cancel()
    connection?.didClose = nil
    connection?.close()
    postFinished()
    finishBroadcastWithError(
      NSError(domain: RPRecordingErrorDomain, code: 10001, userInfo: [NSLocalizedDescriptionKey: reason]))
  }

  override func broadcastFinished() {
    connectTimer?.cancel()
    connection?.didClose = nil
    connection?.close()
    postFinished()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    if sampleBufferType == .video { uploader?.send(sampleBuffer) }
  }
}
