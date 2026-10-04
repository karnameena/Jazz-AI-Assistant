package com.gunakarna.jazzwhatsapp;

import android.app.*;
import android.content.*;
import android.os.*;
import okhttp3.*;
import org.json.*;

public class RealtimeService extends Service {

  private WebSocket socket;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private boolean stopped;
  private int retry = 0;
  public static volatile String status = "Disconnected";
  public static final String EVENT = "com.gunakarna.jazzwhatsapp.EVENT";

  public static void event(Context c, JSONObject data) {
    c.sendBroadcast(
      new Intent(EVENT)
        .setPackage(c.getPackageName())
        .putExtra("data", data.toString())
    );
  }

  public static void connected(Context c, String state) {
    status = state;
    event(c, Api.json("type", "connection", "status", state));
  }

  public void onCreate() {
    super.onCreate();
    Notifications.channels(this);
    startForeground(
      1,
      new Notification.Builder(this, "connection")
        .setSmallIcon(R.drawable.jazz_icon)
        .setContentTitle("Jazz Ai")
        .setContentText("Listening for Jazz messages and calls")
        .setContentIntent(Notifications.open(this))
        .setOngoing(true)
        .build()
    );
    connect();
  }

  private void connect() {
    if (stopped || Api.token(this).isEmpty()) return;
    connected(this, "Connecting");
    try {
      socket = Api.client.newWebSocket(
        Api.request(this, "/socket")
          .url(
            Api.base(this).replaceFirst("^http", "ws") +
              "/api/jazzwhatsapp/socket"
          )
          .build(),
        new WebSocketListener() {
          public void onOpen(WebSocket ws, Response response) {
            retry = 0;
            connected(RealtimeService.this, "Connected");
          }

          public void onMessage(WebSocket ws, String text) {
            try {
              JSONObject data = new JSONObject(text);
              event(RealtimeService.this, data);
              String type = data.optString("type");
              if (type.equals("call.incoming")) Notifications.incoming(
                RealtimeService.this,
                data.getJSONObject("call")
              );
              if (type.equals("sync")) {
                JSONArray calls = data.optJSONArray("calls");
                if (calls != null) for (int i = 0; i < calls.length(); i++) if (
                  calls.getJSONObject(i).optString("status").equals("ringing")
                ) Notifications.incoming(
                  RealtimeService.this,
                  calls.getJSONObject(i)
                );
              }
              if (
                type.equals("message.new") &&
                data.getJSONObject("message").optString("sender").equals("jazz")
              ) Notifications.message(
                RealtimeService.this,
                data.getJSONObject("message")
              );
              if (type.equals("call.ended") || type.equals("call.updated")) {
                JSONObject call = data.optJSONObject("call");
                String active = VoiceService.activeCall();
                if (call != null && active != null && call.optString("id").equals(new JSONObject(active).optString("id")) &&
                    java.util.Arrays.asList("ended", "cancelled", "missed", "declined").contains(call.optString("status")))
                  stopService(new Intent(RealtimeService.this, VoiceService.class));
                if (
                  call != null && !call.optString("status").equals("ringing")
                ) Notifications.stopRinging(
                  RealtimeService.this,
                  call.optString("id"),
                  !call.optString("status").equals("active")
                );
              }
            } catch (Exception ignored) {}
          }

          public void onFailure(WebSocket ws, Throwable e, Response r) {
            if (r != null && r.code() == 401) {
              connected(RealtimeService.this, "Sign in again");
              return;
            }
            reconnect();
          }

          public void onClosed(WebSocket ws, int code, String reason) {
            reconnect();
          }
        }
      );
    } catch (Exception e) {
      reconnect();
    }
  }

  private void reconnect() {
    connected(this, "Disconnected — reconnecting");
    if (!stopped) handler.postDelayed(
      this::connect,
      Math.min(30000, 1000L << Math.min(retry++, 5))
    );
  }

  public int onStartCommand(Intent intent, int flags, int id) {
    return START_STICKY;
  }

  public void onDestroy() {
    stopped = true;
    handler.removeCallbacksAndMessages(null);
    if (socket != null) socket.close(1000, "Stopped");
    connected(this, "Disconnected");
    super.onDestroy();
  }

  public IBinder onBind(Intent intent) {
    return null;
  }
}
