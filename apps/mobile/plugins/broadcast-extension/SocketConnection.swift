import Foundation

/// Client side of the Unix domain socket that react-native-webrtc's `SocketConnection` (in the app)
/// listens on. The socket file lives in the shared App Group container.
final class SocketConnection: NSObject {
  var didOpen: (() -> Void)?
  var didClose: ((Error?) -> Void)?
  var streamHasSpaceAvailable: (() -> Void)?

  private let filePath: String
  private var inputStream: InputStream?
  private var outputStream: OutputStream?
  private var networkThread: Thread?

  init(filePath: String) {
    self.filePath = filePath
    super.init()
  }

  /// Tries to connect once. Returns false while the app isn't listening yet (it starts listening
  /// when JS calls getDisplayMedia), so the caller retries.
  func open() -> Bool {
    guard FileManager.default.fileExists(atPath: filePath) else { return false }
    let handle = socket(AF_UNIX, SOCK_STREAM, 0)
    guard handle >= 0 else { return false }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let maxLength = MemoryLayout.size(ofValue: addr.sun_path)
    guard filePath.utf8.count < maxLength else {
      close(handle)
      return false
    }
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
      ptr.withMemoryRebound(to: CChar.self, capacity: maxLength) { strncpy($0, filePath, maxLength - 1) }
    }
    let status = withUnsafePointer(to: &addr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        connect(handle, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard status == 0 else {
      close(handle)
      return false
    }

    var readStream: Unmanaged<CFReadStream>?
    var writeStream: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, handle, &readStream, &writeStream)
    guard let input = readStream?.takeRetainedValue() as InputStream?,
      let output = writeStream?.takeRetainedValue() as OutputStream?
    else {
      close(handle)
      return false
    }
    input.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    output.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    input.delegate = self
    output.delegate = self
    inputStream = input
    outputStream = output

    let thread = Thread { [weak self] in
      guard let self else { return }
      input.schedule(in: .current, forMode: .default)
      output.schedule(in: .current, forMode: .default)
      input.open()
      output.open()
      while !Thread.current.isCancelled, self.outputStream != nil {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.5))
      }
    }
    thread.qualityOfService = .userInitiated
    networkThread = thread
    thread.start()
    return true
  }

  func close() {
    inputStream?.delegate = nil
    outputStream?.delegate = nil
    inputStream?.close()
    outputStream?.close()
    inputStream = nil
    outputStream = nil
    networkThread?.cancel()
    networkThread = nil
  }

  func write(_ buffer: UnsafePointer<UInt8>, maxLength: Int) -> Int {
    outputStream?.write(buffer, maxLength: maxLength) ?? -1
  }
}

extension SocketConnection: StreamDelegate {
  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    switch eventCode {
    case .openCompleted:
      if aStream == outputStream { didOpen?() }
    case .hasSpaceAvailable:
      if aStream == outputStream { streamHasSpaceAvailable?() }
    case .endEncountered:
      // The app stopped capturing (track.stop() or the call ended).
      close()
      didClose?(nil)
    case .errorOccurred:
      let error = aStream.streamError
      close()
      didClose?(error)
    default:
      break
    }
  }
}
