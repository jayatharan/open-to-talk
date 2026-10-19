import CoreImage
import Foundation
import ReplayKit

/// Serialises ReplayKit video frames into the framing react-native-webrtc's ScreenCapturer.m expects:
/// an HTTP response whose body is a JPEG, with Content-Length, Buffer-Width, Buffer-Height and
/// Buffer-Orientation headers. Frames that arrive while the previous one is still being written are
/// dropped, which keeps the extension well under its ~50 MB memory limit.
final class SampleUploader {
  private static let imageContext = CIContext(options: nil)
  private static let downscale: CGFloat = 0.5
  private static let jpegQuality: Float = 0.8

  private let connection: SocketConnection
  private let queue = DispatchQueue(label: "org.open2talk.broadcast.uploader")
  private var isReady = false
  private var pending: Data?
  private var byteIndex = 0

  init(connection: SocketConnection) {
    self.connection = connection
    connection.didOpen = { [weak self] in self?.queue.async { self?.isReady = true } }
    connection.streamHasSpaceAvailable = { [weak self] in
      self?.queue.async {
        guard let self else { return }
        self.isReady = !self.sendChunk()
      }
    }
  }

  func send(_ sampleBuffer: CMSampleBuffer) {
    let ready = queue.sync { () -> Bool in
      guard isReady else { return false }
      isReady = false
      return true
    }
    guard ready else { return }
    let data = Self.serialize(sampleBuffer)
    queue.async {
      self.pending = data
      self.byteIndex = 0
      self.isReady = !self.sendChunk()
    }
  }

  /// Writes as much of the pending frame as the socket accepts. Returns true while bytes remain.
  private func sendChunk() -> Bool {
    guard let data = pending else { return false }
    let remaining = data.count - byteIndex
    guard remaining > 0 else {
      pending = nil
      return false
    }
    let written = data.withUnsafeBytes { raw -> Int in
      guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
      return connection.write(base + byteIndex, maxLength: min(remaining, 10 * 1024))
    }
    if written > 0 { byteIndex += written }
    if byteIndex >= data.count {
      pending = nil
      return false
    }
    return written >= 0
  }

  private static func serialize(_ sampleBuffer: CMSampleBuffer) -> Data? {
    guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
    CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

    let width = Int(CGFloat(CVPixelBufferGetWidth(imageBuffer)) * downscale)
    let height = Int(CGFloat(CVPixelBufferGetHeight(imageBuffer)) * downscale)
    let orientation =
      (CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?
      .uint32Value ?? CGImagePropertyOrientation.up.rawValue

    let image = CIImage(cvPixelBuffer: imageBuffer)
      .transformed(by: CGAffineTransform(scaleX: downscale, y: downscale))
    let options = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: jpegQuality]
    guard
      let jpeg = imageContext.jpegRepresentation(
        of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: options)
    else { return nil }

    let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(message, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Width" as CFString, String(width) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Height" as CFString, String(height) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(message, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data?
  }
}
