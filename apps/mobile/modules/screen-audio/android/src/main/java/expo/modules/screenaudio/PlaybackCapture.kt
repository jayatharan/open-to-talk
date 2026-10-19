package expo.modules.screenaudio

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Process
import android.util.Log
import androidx.annotation.RequiresApi

/** Reads other apps' media/game playback through the screen-share MediaProjection into [ring]. */
@RequiresApi(Build.VERSION_CODES.Q)
internal class PlaybackCapture(
  projection: MediaProjection,
  private val sampleRate: Int,
  private val channels: Int,
  private val ring: PcmRing,
) {
  private val record: AudioRecord
  @Volatile private var running = false
  private var thread: Thread? = null

  init {
    val config = AudioPlaybackCaptureConfiguration.Builder(projection)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
      .addMatchingUsage(AudioAttributes.USAGE_GAME)
      .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
      .build()
    val mask = if (channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(sampleRate)
      .setChannelMask(mask)
      .build()
    val minBuffer = AudioRecord.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
    record = buildRecord(config, format, maxOf(minBuffer, sampleRate * channels * 2 / 10))
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw IllegalStateException("Playback capture AudioRecord did not initialize")
    }
  }

  // RECORD_AUDIO is a runtime permission the app already asked for to join with the microphone.
  @SuppressLint("MissingPermission")
  private fun buildRecord(config: AudioPlaybackCaptureConfiguration, format: AudioFormat, bufferBytes: Int) =
    AudioRecord.Builder()
      .setAudioFormat(format)
      .setBufferSizeInBytes(bufferBytes)
      .setAudioPlaybackCaptureConfig(config)
      .build()

  fun start() {
    record.startRecording()
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      record.release()
      throw IllegalStateException("Playback capture did not start")
    }
    running = true
    thread = Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      val chunk = ShortArray(sampleRate / 100 * channels)
      while (running) {
        val n = record.read(chunk, 0, chunk.size)
        if (n < 0) {
          Log.w("ScreenAudio", "Playback capture read failed: $n")
          break
        }
        if (n > 0) ring.write(chunk, n)
      }
    }, "ScreenAudioCapture").also { it.start() }
  }

  fun stop() {
    running = false
    try {
      record.stop()
    } catch (_: IllegalStateException) {
    }
    thread?.join(500)
    thread = null
    record.release()
  }
}
