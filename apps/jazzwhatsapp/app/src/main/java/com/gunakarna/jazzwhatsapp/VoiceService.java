package com.gunakarna.jazzwhatsapp;

import android.app.*;
import android.content.*;
import android.media.*;
import android.os.*;
import android.speech.*;
import android.speech.tts.*;
import java.io.*;
import java.nio.*;
import java.util.*;
import okhttp3.*;
import org.json.*;

public class VoiceService extends Service {

  public static volatile VoiceService instance;
  private Handler h = new Handler(Looper.getMainLooper());
  private SpeechRecognizer recognizer;
  private TextToSpeech tts;
  private MediaPlayer player;
  private AudioRecord recorder;
  private volatile boolean running, muted;
  private boolean speaking, ttsReady;
  private String callJson = "{}";
  public static String activeCall() {
    VoiceService service = instance;
    return service != null && service.running ? service.callJson : null;
  }
  private String callId = "",
    opening = "";
  private long epoch = 0;
  private final java.util.concurrent.ExecutorService audioThread =
    java.util.concurrent.Executors.newSingleThreadExecutor();

  void emit(String state, double level, String text) {
    if (!running) return;
    JSONObject event = Api.json(
      "type",
      "voice",
      "status",
      state,
      "text",
      text == null ? "" : text
    );
    try {
      event.put("level", Math.max(0, Math.min(1, level)));
    } catch (Exception ignored) {}
    RealtimeService.event(this, event);
  }

  public void onCreate() {
    super.onCreate();
    instance = this;
    Notifications.channels(this);
    AudioManager a = getSystemService(AudioManager.class);
    a.setMode(AudioManager.MODE_IN_COMMUNICATION);
    a.setSpeakerphoneOn(true);
    tts = new TextToSpeech(this, status -> {
      ttsReady = status == TextToSpeech.SUCCESS;
      if (ttsReady) tts.setLanguage(Locale.ENGLISH);
    });
    tts.setOnUtteranceProgressListener(
      new UtteranceProgressListener() {
        public void onStart(String id) {}

        public void onDone(String id) {
          h.post(() -> {
            speaking = false;
            h.postDelayed(VoiceService.this::listen, 650);
          });
        }

        public void onError(String id) {
          h.post(() -> {
            speaking = false;
            emit("Speech unavailable", 0, "");
            listen();
          });
        }

        public void onRangeStart(String id, int start, int end, int frame) {
          emit("Speaking", .35, "");
        }
      }
    );
  }

  public int onStartCommand(Intent i, int flags, int id) {
    if (i == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    if (running && callId.equals(i.getStringExtra("id"))) return START_NOT_STICKY;
    callId = i.getStringExtra("id");
    callJson = i.getStringExtra("call");
    if (callJson == null) callJson = Api.json("id", callId, "status", "active").toString();
    opening = i.getStringExtra("opening");
    running = true;
    startForeground(
      3,
      new Notification.Builder(this, "voice")
        .setSmallIcon(R.drawable.jazz_icon)
        .setContentTitle("Jazz AI • voice call")
        .setContentText("Tap to return to your call")
        .setContentIntent(PendingIntent.getActivity(this, callId.hashCode(),
          new Intent(this, CallActivity.class).putExtra("call", callJson)
            .setAction("resume:" + callId).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
        .setOngoing(true)
        .addAction(0, "End call", Notifications.action(this, callId, "end"))
        .build()
    );
    h.postDelayed(
      () -> speak(opening == null ? "Hey Mama. I'm listening." : opening),
      500
    );
    return START_NOT_STICKY;
  }

  public void mute(boolean value) {
    muted = value;
    epoch++;
    if (recorder != null) try {
      recorder.stop();
    } catch (Exception ignored) {}
    if (recognizer != null) recognizer.cancel();
    if (!value && !speaking) listen();
    else emit("Muted", 0, "");
  }

  public void speaker(boolean value) {
    getSystemService(AudioManager.class).setSpeakerphoneOn(value);
  }

  public void interrupt() {
    epoch++;
    if (tts != null) tts.stop();
    if (player != null) {
      player.release();
      player = null;
    }
    speaking = false;
    listen();
  }

  private void listen() {
    if (!running || muted || speaking) return;
    emit("Listening", 0, "");
    if (Api.prefs(this).getString("stt", "local").equals("android")) {
      androidListen();
      return;
    }
    long generation = ++epoch;
    audioThread.execute(() -> record(generation));
  }

  private void record(long generation) {
    if (
      checkSelfPermission("android.permission.RECORD_AUDIO") !=
      android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
      emit("Microphone permission required", 0, "");
      return;
    }
    ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    try {
      int size = Math.max(
        4096,
        AudioRecord.getMinBufferSize(
          16000,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT
        )
      );
      recorder = new AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        16000,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        size
      );
      if (
        recorder.getState() != AudioRecord.STATE_INITIALIZED
      ) throw new IOException("Microphone unavailable");
      recorder.startRecording();
      short[] buffer = new short[1024];
      boolean heard = false;
      long start = System.currentTimeMillis(),
        lastVoice = start;
      while (
        running &&
        !muted &&
        generation == epoch &&
        System.currentTimeMillis() - start < 20000
      ) {
        int count = recorder.read(buffer, 0, buffer.length);
        if (count <= 0) break;
        double energy = 0;
        for (int n = 0; n < count; n++) energy +=
          (double) buffer[n] * buffer[n];
        double rms = Math.sqrt(energy / count) / 32768.0;
        emit("Listening", Math.min(1, rms * 10), "");
        if (rms > .018) {
          heard = true;
          lastVoice = System.currentTimeMillis();
        }
        for (int n = 0; n < count; n++) {
          pcm.write(buffer[n] & 255);
          pcm.write((buffer[n] >> 8) & 255);
        }
        if (heard && System.currentTimeMillis() - lastVoice > 850) break;
        if (!heard && System.currentTimeMillis() - start > 8000) break;
      }
      recorder.stop();
      recorder.release();
      recorder = null;
      if (!running || muted || generation != epoch) return;
      if (!heard) {
        h.postDelayed(VoiceService.this::listen, 200);
        return;
      }
      byte[] bytes = pcm.toByteArray();
      ByteBuffer wav = ByteBuffer.allocate(44 + bytes.length).order(
        ByteOrder.LITTLE_ENDIAN
      );
      wav
        .put("RIFF".getBytes())
        .putInt(36 + bytes.length)
        .put("WAVEfmt ".getBytes())
        .putInt(16)
        .putShort((short) 1)
        .putShort((short) 1)
        .putInt(16000)
        .putInt(32000)
        .putShort((short) 2)
        .putShort((short) 16)
        .put("data".getBytes())
        .putInt(bytes.length)
        .put(bytes);
      emit("Transcribing", 0, "");
      JSONObject body = Api.json(
        "audio",
        android.util.Base64.encodeToString(
          wav.array(),
          android.util.Base64.NO_WRAP
        )
      );
      Api.call(this, "/stt", body, (data, error) ->
        h.post(() -> {
          if (!running || generation != epoch) return;
          if (error != null) {
            emit(
              "Local speech unavailable. Choose Android speech in Settings.",
              0,
              ""
            );
            h.postDelayed(VoiceService.this::listen, 3000);
          } else send(data.optString("text"));
        })
      );
    } catch (Exception e) {
      h.post(() -> {
        emit("Microphone unavailable", 0, "");
        if (running && !muted) h.postDelayed(VoiceService.this::listen, 3000);
      });
    } finally {
      if (recorder != null) {
        try {
          recorder.release();
        } catch (Exception ignored) {}
        recorder = null;
      }
    }
  }

  private void androidListen() {
    if (!running || muted || speaking) return;
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      emit("Install an Android speech service or use local STT", 0, "");
      return;
    }
    if (recognizer == null) {
      recognizer =
        Build.VERSION.SDK_INT >= 31 &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
          ? SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
          : SpeechRecognizer.createSpeechRecognizer(this);
      recognizer.setRecognitionListener(
        new RecognitionListener() {
          public void onReadyForSpeech(Bundle b) {
            emit("Listening", 0, "");
          }

          public void onBeginningOfSpeech() {}

          public void onRmsChanged(float rms) {
            emit("Listening", Math.min(1, Math.max(0, rms) / 12), "");
          }

          public void onBufferReceived(byte[] b) {}

          public void onEndOfSpeech() {
            emit("Thinking", 0, "");
          }

          public void onError(int e) {
            if (running && !muted && !speaking) h.postDelayed(
              () -> androidListen(),
              1000
            );
          }

          public void onResults(Bundle b) {
            ArrayList<String> words = b.getStringArrayList(
              SpeechRecognizer.RESULTS_RECOGNITION
            );
            if (words != null && !words.isEmpty()) send(words.get(0));
            else listen();
          }

          public void onPartialResults(Bundle b) {}

          public void onEvent(int i, Bundle b) {}
        }
      );
    }
    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(
        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
      )
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
      .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
    recognizer.startListening(i);
  }

  private void send(String text) {
    if (!running) return;
    if (text.isBlank() || text.matches("(?i)^[\\s\\p{Punct}]*(sound|noise|music|silence|inaudible|blank audio)[\\s\\p{Punct}]*$")) {
      listen();
      return;
    }
    final long generation = epoch;
    emit("Thinking", 0, text);
    JSONObject body = Api.json(
      "text",
      text,
      "source",
      "voice",
      "callId",
      callId,
      "clientId",
      UUID.randomUUID().toString()
    );
    Api.call(this, "/message", body, (data, error) ->
      h.post(() -> {
        if (!running || generation != epoch) return;
        if (error != null) {
          emit(error, 0, "");
          h.postDelayed(VoiceService.this::listen, 1000);
        } else {
          if (data.optBoolean("ignored")) { h.postDelayed(VoiceService.this::listen, 700); return; }
          JSONObject answer = data.optJSONObject("assistant");
          speak(
            answer == null
              ? "I received your message."
              : answer.optString("text")
          );
        }
      })
    );
  }

  private void speak(String text) {
    if (!running) return;
    speaking = true;
    emit("Speaking", .4, text);
    long generation = epoch;
    try {
      Request request = Api.request(this, "/tts")
        .post(
          RequestBody.create(
            Api.json("text", text).toString(),
            MediaType.get("application/json")
          )
        )
        .build();
      Api.client.newCall(request).enqueue(
        new Callback() {
          public void onFailure(Call c, IOException e) {
            h.post(() -> fallback(text, generation));
          }

          public void onResponse(Call c, Response response) {
            try (response) {
              if (!response.isSuccessful()) {
                h.post(() -> fallback(text, generation));
                return;
              }
              byte[] audio = response.body().bytes();
              File f = new File(getCacheDir(), "speech.wav");
              try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(audio);
              }
              h.post(() -> {
                if (!running || generation != epoch) return;
                try {
                  player = new MediaPlayer();
                  player.setAudioAttributes(
                    new AudioAttributes.Builder()
                      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                      .build()
                  );
                  player.setDataSource(f.getAbsolutePath());
                  player.setOnCompletionListener(p -> {
                    p.release();
                    player = null;
                    speaking = false;
                    h.postDelayed(VoiceService.this::listen, 650);
                  });
                  player.prepare();
                  player.start();
                  animatePlayback(audio);
                } catch (Exception e) {
                  fallback(text, generation);
                }
              });
            } catch (Exception e) {
              h.post(() -> fallback(text, generation));
            }
          }
        }
      );
    } catch (Exception e) {
      fallback(text, generation);
    }
  }

  private void animatePlayback(byte[] wav) {
    try {
      ByteBuffer header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
      int rate = header.getInt(24),
        channels = header.getShort(22),
        offset = 12;
      while (offset + 8 < wav.length) {
        int length = header.getInt(offset + 4);
        if (new String(wav, offset, 4).equals("data")) {
          offset += 8;
          break;
        }
        offset += 8 + length + (length & 1);
      }
      final int dataOffset = offset,
        sampleRate = rate,
        channelCount = channels;
      Runnable update = new Runnable() {
        public void run() {
          if (!running || player == null || !speaking) return;
          try {
            int position =
              dataOffset +
              (int) (((long) player.getCurrentPosition() *
                sampleRate *
                channelCount *
                2) /
                1000);
            double sum = 0;
            int count = 0;
            for (
              int i = position;
              i + 1 < Math.min(position + 2048, wav.length);
              i += 2
            ) {
              short sample = (short) ((wav[i] & 255) | (wav[i + 1] << 8));
              sum += (double) sample * sample;
              count++;
            }
            emit(
              "Speaking",
              count == 0 ? 0 : Math.min(1, Math.sqrt(sum / count) / 8000),
              ""
            );
            h.postDelayed(this, 80);
          } catch (Exception ignored) {}
        }
      };
      h.post(update);
    } catch (Exception ignored) {}
  }

  private void fallback(String text, long generation) {
    if (!running || generation != epoch) return;
    if (ttsReady) {
      tts.speak(
        text.replaceAll("[*#`]", ""),
        TextToSpeech.QUEUE_FLUSH,
        null,
        "jazz"
      );
    } else {
      emit("Text-to-speech unavailable", 0, text);
      speaking = false;
      h.postDelayed(VoiceService.this::listen, 1000);
    }
  }

  public void onDestroy() {
    running = false;
    Api.prefs(this).edit().putString("pendingEnd:" + callId, "end").apply();
    JazzConnectionService.finish(callId);
    RealtimeService.event(this, Api.json("type", "call.localEnded", "id", callId));
    getSystemService(NotificationManager.class).cancel(3);
    epoch++;
    instance = null;
    h.removeCallbacksAndMessages(null);
    if (recognizer != null) recognizer.destroy();
    if (tts != null) tts.shutdown();
    if (player != null) player.release();
    if (recorder != null) try {
      recorder.stop();
    } catch (Exception ignored) {}
    audioThread.shutdownNow();
    AudioManager audio = getSystemService(AudioManager.class);
    audio.setSpeakerphoneOn(false);
    audio.setMode(AudioManager.MODE_NORMAL);
    super.onDestroy();
  }

  public IBinder onBind(Intent i) {
    return null;
  }
}
