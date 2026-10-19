package expo.modules.screenaudio

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

// Installs the mixing audio device module before react-native-webrtc builds its
// PeerConnectionFactory (that happens lazily, when JS first touches WebRTCModule).
class ScreenAudioPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        DeviceAudioMixer.install(application)
      }
    })
}
