package expo.modules.screenaudio

import android.os.Build
import com.facebook.react.bridge.ReactContext
import com.oney.WebRTCModule.AbstractVideoCaptureController
import com.oney.WebRTCModule.WebRTCModule
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.webrtc.ScreenCapturerAndroid

class ScreenAudioException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class ScreenAudioModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScreenAudio")

    Function("isAvailable") { DeviceAudioMixer.isInstalled }

    // Starts mixing device playback into the outgoing microphone audio, using the
    // MediaProjection react-native-webrtc opened for the given screen video track.
    AsyncFunction("start") { screenTrackId: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !DeviceAudioMixer.isInstalled) {
        throw ScreenAudioException("Device audio needs Android 10 or newer")
      }
      val projection = findMediaProjection(screenTrackId)
      try {
        DeviceAudioMixer.startCapture(projection)
      } catch (t: Throwable) {
        throw ScreenAudioException("Could not capture device audio: ${t.message}", t)
      }
    }

    Function("stop") { DeviceAudioMixer.stopCapture() }

    Function("setMicMuted") { muted: Boolean -> DeviceAudioMixer.micMuted = muted }

    OnDestroy {
      DeviceAudioMixer.stopCapture()
      DeviceAudioMixer.micMuted = false
    }
  }

  // The consent Intent can only be turned into a MediaProjection once (Android 14+ enforces
  // this), so reuse the projection held by react-native-webrtc's ScreenCapturerAndroid:
  // WebRTCModule.getUserMediaImpl.tracks[trackId].videoCaptureController.videoCapturer.
  private fun findMediaProjection(trackId: String): android.media.projection.MediaProjection {
    val reactContext = appContext.reactContext as? ReactContext
      ?: throw ScreenAudioException("React context is not available")
    val webrtc = reactContext.getNativeModule(WebRTCModule::class.java)
      ?: throw ScreenAudioException("WebRTCModule is not loaded")
    try {
      val gum = DeviceAudioMixer.readField(webrtc, "getUserMediaImpl")!!
      val tracks = DeviceAudioMixer.readField(gum, "tracks") as Map<*, *>
      val track = tracks[trackId] ?: throw ScreenAudioException("No local track $trackId")
      val controller = DeviceAudioMixer.readField(track, "videoCaptureController") as? AbstractVideoCaptureController
      val capturer = controller?.let { DeviceAudioMixer.readField(it, "videoCapturer") } as? ScreenCapturerAndroid
        ?: throw ScreenAudioException("Track $trackId is not a screen capture")
      return capturer.mediaProjection ?: throw ScreenAudioException("Screen capture has no MediaProjection yet")
    } catch (e: ScreenAudioException) {
      throw e
    } catch (t: Throwable) {
      throw ScreenAudioException("Could not reach react-native-webrtc's MediaProjection", t)
    }
  }
}
