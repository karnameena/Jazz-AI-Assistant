package com.gunakarna.jazzwhatsapp;

import android.content.*;

public class CallActionReceiver extends BroadcastReceiver {

  public void onReceive(Context context, Intent intent) {
    PendingResult pending = goAsync();
    act(
      context,
      intent.getStringExtra("id"),
      intent.getStringExtra("action"),
      pending::finish
    );
  }

  static void act(Context c, String id, String action) {
    act(c, id, action, () -> {});
  }

  static void act(Context c, String id, String action, Runnable done) {
    Notifications.cancelIncoming(c, id);
    if ("end".equals(action)) c.stopService(new Intent(c, VoiceService.class));
    Api.call(
      c,
      "/call-action",
      Api.json("id", id, "action", action),
      (data, error) -> {
        RealtimeService.event(c, Api.json("type", "call.localEnded", "id", id));
        done.run();
      }
    );
  }
}
