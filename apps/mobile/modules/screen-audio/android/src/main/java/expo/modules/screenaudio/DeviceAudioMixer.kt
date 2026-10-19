package expo.modules.screenaudio

import android.annotation.SuppressLint
import android.app.Application
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import com.oney.WebRTCModule.WebRTCModuleOptions
import org.webrtc.audio.JavaAudioDeviceModule
import java.lang.reflect.Field
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Mixes device playback (AudioPlaybackCapture) into the microphone samples WebRTC sends.
 *
 * Stock libwebrtc has no hook for editing recorded PCM, and every audio track a
 * PeerConnectionFactory makes is fed by its one AudioDeviceModule, so a separate
 * "device audio" track isn't possible without a native fork. Instead we hand
 * react-native-webrtc our own JavaAudioDeviceModule and, when it starts recording,
 * swap its private AudioRecord for a [MixingAudioRecord] whose read() adds the
 * captured playback. The swap happens in the record-start callback, which libwebrtc
 * runs on the record thread before its read loop, so it never races a read.
 */
object DeviceAudioMixer {
  private const val TAG = "ScreenAudio"

  private var webRtcRecord: Any? = null // org.webrtc.audio.WebRtcAudioRecord
  private var sampleRate = 48000
  private var channels = 1

  @Volatile var isInstalled = false
    private set

  /** Silences the microphone part of the mix while device audio keeps flowing. */
  @Volatile var micMuted = false

  private val ring = PcmRing()
  @Volatile private var capture: PlaybackCapture? = null
  private var projection: MediaProjection? = null
  private var scratch = ShortArray(960)

  fun install(app: Application) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val options = WebRTCModuleOptions.getInstance()
    if (options.audioDeviceModule != null) {
      Log.w(TAG, "An audioDeviceModule is already set; device audio is disabled")
      return
    }
    try {
      // Same configuration as react-native-webrtc's default ADM, plus the start hook.
      val adm = JavaAudioDeviceModule.builder(app)
        .setEnableVolumeLogger(false)
        .setAudioRecordStateCallback(object : JavaAudioDeviceModule.AudioRecordStateCallback {
          override fun onWebRtcAudioRecordStart() = swapInMixingRecord()
          override fun onWebRtcAudioRecordStop() {}
        })
        .createAudioDeviceModule()
      webRtcRecord = field(adm.javaClass, "audioInput").get(adm)
      sampleRate = field(adm.javaClass, "inputSampleRate").getInt(adm)
      channels = if (field(adm.javaClass, "useStereoInput").getBoolean(adm)) 2 else 1
      field(webRtcRecord!!.javaClass, "audioRecord") // fail now rather than on every call
      options.audioDeviceModule = adm
      isInstalled = true
    } catch (t: Throwable) {
      Log.w(TAG, "Could not install the mixing audio device module", t)
    }
  }

  @SuppressLint("MissingPermission") // RECORD_AUDIO is held: WebRTC just opened the mic.
  private fun swapInMixingRecord() {
    val rec = webRtcRecord ?: return
    try {
      val recordField = field(rec.javaClass, "audioRecord")
      val original = recordField.get(rec) as? AudioRecord ?: return
      if (original is MixingAudioRecord || original.audioFormat != AudioFormat.ENCODING_PCM_16BIT) return
      val mixing = MixingAudioRecord(
        original.audioSource,
        original.sampleRate,
        original.channelConfiguration,
        original.audioFormat,
        original.bufferSizeInFrames * original.channelCount * 2,
      )
      if (mixing.state != AudioRecord.STATE_INITIALIZED) {
        mixing.release()
        return
      }
      original.preferredDevice?.let { mixing.setPreferredDevice(it) }
      val effects = field(rec.javaClass, "effects").get(rec)

      original.stop()
      // Move the platform AEC/NS libwebrtc chose onto the new session.
      moveEffects(effects, mixing.audioSessionId)
      try {
        mixing.startRecording()
      } catch (e: IllegalStateException) {
        Log.w(TAG, "Mixing AudioRecord failed to start", e)
      }
      if (mixing.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
        mixing.release()
        moveEffects(effects, original.audioSessionId)
        original.startRecording()
        return
      }
      recordField.set(rec, mixing)
      original.release()
      // The ADM's configured rate isn't always what libwebrtc records at (emulators use 8 kHz).
      Thread { matchRecordFormat(mixing.sampleRate, mixing.channelCount) }.start()
      Log.d(TAG, "Mixing AudioRecord installed (${mixing.sampleRate} Hz, ${mixing.channelCount} ch)")
    } catch (t: Throwable) {
      Log.w(TAG, "Could not install the mixing AudioRecord; sending microphone only", t)
    }
  }

  private fun moveEffects(effects: Any?, sessionId: Int) {
    if (effects == null) return
    try {
      effects.javaClass.getDeclaredMethod("release").apply { isAccessible = true }.invoke(effects)
      effects.javaClass.getDeclaredMethod("enable", Int::class.javaPrimitiveType)
        .apply { isAccessible = true }
        .invoke(effects, sessionId)
    } catch (t: Throwable) {
      Log.w(TAG, "Could not move audio effects to session $sessionId", t)
    }
  }

  /** Called on libwebrtc's record thread with each freshly read 10 ms buffer (native-endian PCM16). */
  internal fun mixInto(buffer: ByteBuffer, bytes: Int) {
    val muted = micMuted
    val active = capture != null
    if (!muted && !active) return
    val samples = bytes / 2
    if (scratch.size < samples) scratch = ShortArray(samples)
    val got = if (active) ring.read(scratch, samples) else 0
    val pcm = buffer.duplicate().order(ByteOrder.nativeOrder())
    for (i in 0 until samples) {
      val mic = if (muted) 0 else pcm.getShort(i * 2).toInt()
      val device = if (i < got) scratch[i].toInt() else 0
      pcm.putShort(i * 2, (mic + device).coerceIn(-32768, 32767).toShort())
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  @Synchronized
  fun startCapture(projection: MediaProjection) {
    stopCapture()
    ring.reset(sampleRate * channels)
    val next = PlaybackCapture(projection, sampleRate, channels, ring)
    next.start()
    capture = next
    this.projection = projection
  }

  @Synchronized
  fun stopCapture() {
    capture?.stop()
    capture = null
    projection = null
  }

  @Synchronized
  private fun matchRecordFormat(rate: Int, channelCount: Int) {
    if (rate == sampleRate && channelCount == channels) return
    sampleRate = rate
    channels = channelCount
    val running = projection
    if (running != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      try {
        startCapture(running)
      } catch (t: Throwable) {
        Log.w(TAG, "Could not restart playback capture at $rate Hz", t)
        stopCapture()
      }
    }
  }

  private fun field(cls: Class<*>, name: String): Field {
    var c: Class<*>? = cls
    while (c != null) {
      try {
        return c.getDeclaredField(name).apply { isAccessible = true }
      } catch (_: NoSuchFieldException) {
        c = c.superclass
      }
    }
    throw NoSuchFieldException("${cls.name}.$name")
  }

  internal fun readField(target: Any, name: String): Any? = field(target.javaClass, name).get(target)
}

/** A real microphone AudioRecord whose reads also carry the captured device audio. */
@SuppressLint("MissingPermission")
internal class MixingAudioRecord(
  source: Int,
  sampleRate: Int,
  channelConfig: Int,
  encoding: Int,
  bufferSizeInBytes: Int,
) : AudioRecord(source, sampleRate, channelConfig, encoding, bufferSizeInBytes) {
  override fun read(audioBuffer: ByteBuffer, sizeInBytes: Int): Int {
    val n = super.read(audioBuffer, sizeInBytes)
    if (n > 0) DeviceAudioMixer.mixInto(audioBuffer, n)
    return n
  }
}

/**
 * Jitter buffer between the playback-capture thread and the WebRTC record thread.
 * Waits for [PRIME_MS] before playing, and trims back when latency drifts past [MAX_MS].
 */
internal class PcmRing {
  private var buf = ShortArray(0)
  private var start = 0
  private var size = 0
  private var primed = false
  private var samplesPerMs = 48

  @Synchronized
  fun reset(samplesPerSecond: Int) {
    samplesPerMs = samplesPerSecond / 1000
    buf = ShortArray(samplesPerMs * CAPACITY_MS)
    start = 0
    size = 0
    primed = false
  }

  @Synchronized
  fun write(src: ShortArray, count: Int) {
    if (buf.isEmpty()) return
    for (i in 0 until count) {
      if (size == buf.size) {
        start = (start + 1) % buf.size
        size--
      }
      buf[(start + size) % buf.size] = src[i]
      size++
    }
    if (size > samplesPerMs * MAX_MS) drop(size - samplesPerMs * TRIM_TO_MS)
  }

  @Synchronized
  fun read(dst: ShortArray, count: Int): Int {
    if (buf.isEmpty()) return 0
    if (!primed) {
      if (size < samplesPerMs * PRIME_MS) return 0
      primed = true
    }
    val n = minOf(count, size)
    for (i in 0 until n) dst[i] = buf[(start + i) % buf.size]
    drop(n)
    if (n < count) primed = false
    return n
  }

  private fun drop(n: Int) {
    start = (start + n) % buf.size
    size -= n
  }

  private companion object {
    const val CAPACITY_MS = 500
    const val PRIME_MS = 40
    const val MAX_MS = 200
    const val TRIM_TO_MS = 60
  }
}
