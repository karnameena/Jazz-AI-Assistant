package com.gunakarna.jazzwhatsapp;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.speech.*;
import android.webkit.*;
import java.io.*;
import org.json.*;

public class MainActivity extends Activity {

  protected WebView web;
  private String photoTarget = "user";
  private byte[] downloadBytes;
  private boolean loaded = false;
  private SpeechRecognizer dictation;
  protected JSONObject call;
  protected boolean autoAnswer;
  private final BroadcastReceiver events = new BroadcastReceiver() {
    public void onReceive(Context c, Intent i) {
      String data = i.getStringExtra("data");
      if (data != null) dispatch(data);
    }
  };

  @android.annotation.SuppressLint("SetJavaScriptEnabled")
  public void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    web.setBackgroundColor(0xff0b141a);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    web.addJavascriptInterface(new Bridge(), "Native");
    web.setWebViewClient(
      new WebViewClient() {
        public boolean shouldOverrideUrlLoading(
          WebView v,
          WebResourceRequest request
        ) {
          return true;
        }

        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
          Uri uri = request.getUrl();
          String asset = uri.getPath() == null ? "" : uri.getPath().substring(1);
          if ("https".equals(uri.getScheme()) && "jazz.invalid".equals(uri.getHost()) &&
              java.util.Arrays.asList("index.html", "app.js", "app.css", "wallpaper.svg").contains(asset)) {
            try { return new WebResourceResponse(asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : "text/html", "UTF-8", getAssets().open(asset)); } catch (IOException ignored) {}
          }
          return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
        }
        public void onPageFinished(WebView v, String url) {
          loaded = true;
        }
      }
    );
    web.setWebChromeClient(new WebChromeClient() {
      public void onPermissionRequest(PermissionRequest request) {
        runOnUiThread(() -> {
          if ("https".equals(request.getOrigin().getScheme()) && "jazz.invalid".equals(request.getOrigin().getHost()) && request.getOrigin().getPort() == -1 &&
              checkSelfPermission("android.permission.CAMERA") == PackageManager.PERMISSION_GRANTED &&
              java.util.Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            request.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
          else request.deny();
        });
      }
    });
    setContentView(web);
    web.loadUrl("https://jazz.invalid/index.html");
    androidx.core.content.ContextCompat.registerReceiver(
      this,
      events,
      new IntentFilter(RealtimeService.EVENT),
      androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED
    );
    readIntent(getIntent());
    if (
      Build.VERSION.SDK_INT >= 33 &&
      checkSelfPermission("android.permission.POST_NOTIFICATIONS") !=
        PackageManager.PERMISSION_GRANTED
    ) requestPermissions(
      new String[] { "android.permission.POST_NOTIFICATIONS" },
      41
    );
  }

  protected void readIntent(Intent i) {
    try {
      if (i.hasExtra("call")) call = new JSONObject(i.getStringExtra("call"));
      autoAnswer = i.getBooleanExtra("answer", false);
      if (loaded && call != null) dispatch(
        Api.json(
          "type",
          "openCall",
          "call",
          call.toString(),
          "answer",
          String.valueOf(autoAnswer)
        ).toString()
      );
    } catch (Exception ignored) {}
  }

  protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    setIntent(i);
    readIntent(i);
  }

  protected void dispatch(String json) {
    runOnUiThread(() ->
      web.evaluateJavascript(
        "window.onNativeEvent(" + JSONObject.quote(json) + ")",
        null
      )
    );
  }

  void callback(String id, JSONObject data, String error) {
    runOnUiThread(() ->
      web.evaluateJavascript(
        "window.nativeResult(" +
          JSONObject.quote(id) +
          "," +
          (data == null ? "null" : data.toString()) +
          "," +
          (error == null ? "null" : JSONObject.quote(error)) +
          ")",
        null
      )
    );
  }

  void startConnection() {
    if (!Api.token(this).isEmpty()) startForegroundService(
      new Intent(this, RealtimeService.class)
    );
  }

  public class Bridge {

    @JavascriptInterface
    public String boot() {
      JSONObject o = Api.json(
        "base",
        Api.base(MainActivity.this),
        "signedIn",
        String.valueOf(!Api.token(MainActivity.this).isEmpty()),
        "connection",
        RealtimeService.status,
        "stt",
        Api.prefs(MainActivity.this).getString("stt", "local")
      );
      try {
        if (call != null) {
          o.put("call", call);
          o.put("autoAnswer", autoAnswer);
        }
        String active = VoiceService.activeCall();
        o.put("voiceRunning", active != null);
        if (active != null) {
          if (call == null) o.put("activeCall", new JSONObject(active));
          else if (call.optString("id").equals(new JSONObject(active).optString("id"))) { call.put("status", "active"); o.put("call", call); o.put("autoAnswer", false); }
        }
        o.put("callMode", MainActivity.this instanceof CallActivity);
      } catch (Exception ignored) {}
      return o.toString();
    }

    @JavascriptInterface
    public void request(String id, String route, String raw) {
      runOnUiThread(() -> {
        try {
          if (!route.matches("/[a-z-]+")) throw new Exception("Invalid route");
          JSONObject body = raw.equals("null") ? null : new JSONObject(raw);
          Api.call(MainActivity.this, route, body, (data, error) -> {
            if (error == null && route.equals("/auth")) {
              Api.prefs(MainActivity.this)
                .edit()
                .putString("token", data.optString("token"))
                .apply();
              data.remove("token");
              runOnUiThread(() -> startConnection());
            }
            if (error == null && route.equals("/logout")) {
              Api.prefs(MainActivity.this).edit().remove("token").apply();
              stopService(new Intent(MainActivity.this, RealtimeService.class));
            }
            callback(id, data, error);
          });
        } catch (Exception e) {
          callback(id, null, e.getMessage());
        }
      });
    }

    @JavascriptInterface
    public void configure(String url, String stt) {
      runOnUiThread(() -> {
        try {
          Uri u = Uri.parse(url);
          if (
            !("http".equals(u.getScheme()) || "https".equals(u.getScheme())) ||
            u.getHost() == null ||
            u.getUserInfo() != null ||
            u.getQuery() != null
          ) throw new Exception();
          String clean = url.replaceAll("/+$", "");
          if (!clean.equals(Api.base(MainActivity.this))) {
            Api.prefs(MainActivity.this).edit().remove("token").apply();
            stopService(new Intent(MainActivity.this, RealtimeService.class));
          }
          Api.prefs(MainActivity.this)
            .edit()
            .putString("base", clean)
            .putString("stt", stt.equals("android") ? "android" : "local")
            .apply();
          dispatch(Api.json("type", "configured").toString());
        } catch (Exception e) {
          dispatch(
            Api.json(
              "type",
              "error",
              "error",
              "Enter a valid http:// or https:// server URL"
            ).toString()
          );
        }
      });
    }

    @JavascriptInterface
    public void connect() {
      runOnUiThread(() -> startConnection());
    }

    @JavascriptInterface
    public boolean microphone() {
      return (
        checkSelfPermission("android.permission.RECORD_AUDIO") ==
        PackageManager.PERMISSION_GRANTED
      );
    }

    @JavascriptInterface
    public void requestMicrophone() {
      runOnUiThread(() ->
        requestPermissions(
          new String[] { "android.permission.RECORD_AUDIO" },
          42
        )
      );
    }

    @JavascriptInterface
    public void voice(String raw) {
      runOnUiThread(() -> {
        try {
          JSONObject c = new JSONObject(raw);
          String active = VoiceService.activeCall();
          if (active != null && new JSONObject(active).optString("id").equals(c.optString("id"))) return;
          if (
            checkSelfPermission("android.permission.RECORD_AUDIO") !=
            PackageManager.PERMISSION_GRANTED
          ) {
            requestPermissions(
              new String[] { "android.permission.RECORD_AUDIO" },
              42
            );
            dispatch(
              Api.json(
                "type",
                "error",
                "error",
                "Allow microphone access, then tap Answer or Call again"
              ).toString()
            );
            return;
          }
          Notifications.stopRinging(
            MainActivity.this,
            c.optString("id"),
            false
          );
          JazzConnectionService.active(c.optString("id"));
          Notifications.register(MainActivity.this);
          if (c.optString("direction").equals("outgoing")) {
            Bundle outgoing = new Bundle();
            outgoing.putString("call", c.toString());
            Bundle extras = new Bundle();
            extras.putParcelable(
              android.telecom.TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE,
              Notifications.account(MainActivity.this)
            );
            extras.putBundle(
              android.telecom.TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS,
              outgoing
            );
            try {
              getSystemService(android.telecom.TelecomManager.class).placeCall(
                Uri.fromParts("sip", "jazz@local", null),
                extras
              );
            } catch (SecurityException ignored) {}
          }
          Intent voice = new Intent(MainActivity.this, VoiceService.class)
            .putExtra("id", c.optString("id"))
            .putExtra("call", c.toString())
            .putExtra(
              "opening",
              c.has("title")
                ? "Mama, I'm calling about your reminder: " +
                    c.optString("title") +
                    ". Have you done it?"
                : "Hey Mama. I'm here. What would you like to talk about?"
            );
          startForegroundService(voice);
        } catch (Exception e) {
          dispatch(
            Api.json("type", "error", "error", e.getMessage()).toString()
          );
        }
      });
    }

    @JavascriptInterface
    public void callScreen(String raw) {
      runOnUiThread(() ->
        startActivity(
          new Intent(MainActivity.this, CallActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(
            "call",
            raw
          )
        )
      );
    }

    @JavascriptInterface
    public void endVoice() {
      runOnUiThread(() -> {
        stopService(new Intent(MainActivity.this, VoiceService.class));
        if (MainActivity.this instanceof CallActivity) finish();
      });
    }

    @JavascriptInterface
    public void mute(boolean muted) {
      runOnUiThread(() -> {
        if (VoiceService.instance != null) VoiceService.instance.mute(muted);
      });
    }

    @JavascriptInterface
    public void speaker(boolean enabled) {
      runOnUiThread(() -> {
        if (VoiceService.instance != null) VoiceService.instance.speaker(
          enabled
        );
      });
    }

    @JavascriptInterface
    public void interrupt() {
      runOnUiThread(() -> {
        if (VoiceService.instance != null) VoiceService.instance.interrupt();
      });
    }

    @JavascriptInterface
    public void copy(String text) {
      runOnUiThread(() ->
        getSystemService(android.content.ClipboardManager.class).setPrimaryClip(
          ClipData.newPlainText("Jazz message", text)
        )
      );
    }

    @JavascriptInterface
    public void share(String text) {
      runOnUiThread(() ->
        startActivity(
          Intent.createChooser(
            new Intent(Intent.ACTION_SEND)
              .setType("text/plain")
              .putExtra(Intent.EXTRA_TEXT, text),
            "Share message"
          )
        )
      );
    }

    @JavascriptInterface
    public void photo(String target) {
      runOnUiThread(() -> {
        photoTarget = target;
        startActivityForResult(
          new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("image/*")
            .addCategory(Intent.CATEGORY_OPENABLE),
          50
        );
      });
    }

    @JavascriptInterface
    public boolean camera() { return checkSelfPermission("android.permission.CAMERA") == PackageManager.PERMISSION_GRANTED; }

    @JavascriptInterface
    public void requestCamera() { runOnUiThread(() -> requestPermissions(new String[] {"android.permission.CAMERA"}, 44)); }

    @JavascriptInterface
    public void downloadImage(String raw) {
      runOnUiThread(() -> {
        try {
          if (raw.length() > 1200000 || !raw.matches("data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+")) throw new Exception("Invalid image");
          String mime = raw.substring(5, raw.indexOf(";"));
          downloadBytes = android.util.Base64.decode(raw.substring(raw.indexOf(",") + 1), android.util.Base64.DEFAULT);
          startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime).putExtra(Intent.EXTRA_TITLE, "Jazz-image-" + System.currentTimeMillis() + (mime.endsWith("jpeg") ? ".jpg" : mime.endsWith("png") ? ".png" : ".webp")), 51);
        } catch (Exception e) { dispatch(Api.json("type", "error", "error", "Could not save image").toString()); }
      });
    }

    @JavascriptInterface
    public void fullScreenSettings() {
      runOnUiThread(() -> {
        if (Build.VERSION.SDK_INT >= 34) startActivity(
          new Intent(
            Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
            Uri.parse("package:" + getPackageName())
          )
        );
        else startActivity(
          new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getPackageName())
          )
        );
      });
    }

    @JavascriptInterface
    public void batterySettings() {
      runOnUiThread(() ->
        startActivity(
          new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        )
      );
    }

    @JavascriptInterface
    public void dictate() {
      runOnUiThread(() -> {
        if (
          checkSelfPermission("android.permission.RECORD_AUDIO") !=
          PackageManager.PERMISSION_GRANTED
        ) {
          requestPermissions(
            new String[] { "android.permission.RECORD_AUDIO" },
            42
          );
          return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(MainActivity.this)) {
          dispatch(
            Api.json(
              "type",
              "error",
              "error",
              "Android speech service unavailable. Use Call Jazz with local speech."
            ).toString()
          );
          return;
        }
        if (dictation != null) dictation.destroy();
        dictation =
          Build.VERSION.SDK_INT >= 31 &&
          SpeechRecognizer.isOnDeviceRecognitionAvailable(MainActivity.this)
            ? SpeechRecognizer.createOnDeviceSpeechRecognizer(MainActivity.this)
            : SpeechRecognizer.createSpeechRecognizer(MainActivity.this);
        dictation.setRecognitionListener(
          new RecognitionListener() {
            public void onReadyForSpeech(Bundle b) {
              dispatch(
                Api.json("type", "dictation", "status", "Listening").toString()
              );
            }

            public void onBeginningOfSpeech() {}

            public void onRmsChanged(float f) {}

            public void onBufferReceived(byte[] b) {}

            public void onEndOfSpeech() {}

            public void onError(int e) {
              dispatch(
                Api.json(
                  "type",
                  "error",
                  "error",
                  "Speech input stopped. Please try again."
                ).toString()
              );
            }

            public void onResults(Bundle b) {
              java.util.ArrayList<String> r = b.getStringArrayList(
                SpeechRecognizer.RESULTS_RECOGNITION
              );
              if (r != null && !r.isEmpty()) dispatch(
                Api.json("type", "dictation", "text", r.get(0)).toString()
              );
            }

            public void onPartialResults(Bundle b) {}

            public void onEvent(int i, Bundle b) {}
          }
        );
        dictation.startListening(
          new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(
              RecognizerIntent.EXTRA_LANGUAGE_MODEL,
              RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            )
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
        );
      });
    }

    @JavascriptInterface
    public void recovery() {
      runOnUiThread(() ->
        startActivity(
          new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://jazz-recovery.onrender.com")
          )
        )
      );
    }
  }

  public void onRequestPermissionsResult(
    int code,
    String[] permissions,
    int[] results
  ) {
    super.onRequestPermissionsResult(code, permissions, results);
    if (code == 44) dispatch(Api.json("type", "cameraPermission", "granted", String.valueOf(results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)).toString());
    if (code == 42) dispatch(
      Api.json(
        "type",
        "microphonePermission",
        "granted",
        String.valueOf(
          results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED
        )
      ).toString()
    );
  }

  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == 51) {
      byte[] bytes = downloadBytes; downloadBytes = null;
      if (result == RESULT_OK && data != null && bytes != null) {
        try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
          if (output == null) throw new IOException();
          output.write(bytes);
          dispatch(Api.json("type", "savedImage").toString());
        } catch (Exception e) { dispatch(Api.json("type", "error", "error", "Could not save image").toString()); }
      }
    }
    if (code == 50 && result == RESULT_OK && data != null) {
      try (
        InputStream input = getContentResolver().openInputStream(data.getData())
      ) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        try (InputStream bounds = getContentResolver().openInputStream(data.getData())) { BitmapFactory.decodeStream(bounds, null, options); }
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 2048) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        Bitmap source = BitmapFactory.decodeStream(input, null, options);
        if (source == null) throw new Exception("Unsupported image");
        int max = photoTarget.equals("message") ? 1280 : 512;
        float ratio = Math.min(
          1f,
          (float) max / Math.max(source.getWidth(), source.getHeight())
        );
        Bitmap image = Bitmap.createScaledBitmap(
          source,
          Math.max(1, (int) (source.getWidth() * ratio)),
          Math.max(1, (int) (source.getHeight() * ratio)),
          true
        );
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int quality = 85;
        do { output.reset(); image.compress(Bitmap.CompressFormat.JPEG, quality, output); quality -= 10; } while (output.size() > 850000 && quality >= 35);
        if (output.size() > 850000) throw new Exception("Image too large");
        dispatch(
          Api.json(
            "type",
            "photo",
            "target",
            photoTarget,
            "avatar",
            "data:image/jpeg;base64," +
              android.util.Base64.encodeToString(
                output.toByteArray(),
                android.util.Base64.NO_WRAP
              )
          ).toString()
        );
      } catch (Exception e) {
        dispatch(
          Api.json(
            "type",
            "error",
            "error",
            "Couldn't open that image"
          ).toString()
        );
      }
    }
  }

  public void onBackPressed() {
    web.evaluateJavascript("window.goBack()", null);
  }

  protected void onPause() {
    if (loaded) dispatch(Api.json("type", "cameraPaused").toString());
    super.onPause();
  }

  protected void onResume() {
    super.onResume();
    if (loaded) dispatch(Api.json("type", "cameraResumed").toString());
  }

  protected void onDestroy() {
    unregisterReceiver(events);
    if (dictation != null) dictation.destroy();
    web.removeJavascriptInterface("Native");
    web.destroy();
    super.onDestroy();
  }
}
