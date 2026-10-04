package com.gunakarna.jazzwhatsapp;

import android.app.*;
import android.content.*;
import android.media.*;
import android.os.*;
import android.telecom.*;
import org.json.*;

public final class Notifications {

  static String ringingId = "";
  static Ringtone ringtone;

  public static void channels(Context c) {
    NotificationManager n = c.getSystemService(NotificationManager.class);
    n.createNotificationChannel(
      new NotificationChannel(
        "connection",
        "Jazz connection",
        NotificationManager.IMPORTANCE_LOW
      )
    );
    n.createNotificationChannel(
      new NotificationChannel(
        "messages",
        "Jazz messages",
        NotificationManager.IMPORTANCE_HIGH
      )
    );
    NotificationChannel calls = new NotificationChannel(
      "calls",
      "Jazz incoming calls",
      NotificationManager.IMPORTANCE_HIGH
    );
    calls.setSound(null, null);
    n.createNotificationChannel(calls);
    n.createNotificationChannel(
      new NotificationChannel(
        "voice",
        "Jazz ongoing call",
        NotificationManager.IMPORTANCE_LOW
      )
    );
  }

  static PendingIntent open(Context c) {
    return PendingIntent.getActivity(
      c,
      0,
      new Intent(c, MainActivity.class),
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
  }

  static PendingIntent action(Context c, String id, String action) {
    return PendingIntent.getBroadcast(
      c,
      (id + action).hashCode(),
      new Intent(c, CallActionReceiver.class)
        .putExtra("id", id)
        .putExtra("action", action),
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
  }

  public static PhoneAccountHandle account(Context c) {
    return new PhoneAccountHandle(
      new ComponentName(c, JazzConnectionService.class),
      "jazz"
    );
  }

  public static void register(Context c) {
    c.getSystemService(TelecomManager.class).registerPhoneAccount(
      PhoneAccount.builder(account(c), "Jazz AI")
        .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
        .addSupportedUriScheme(PhoneAccount.SCHEME_SIP)
        .build()
    );
  }

  static void incoming(Context c, JSONObject call) {
    String id = call.optString("id");
    if (id.equals(ringingId)) return;
    ringingId = id;
    try {
      register(c);
      Bundle extras = new Bundle();
      extras.putString("call", call.toString());
      c.getSystemService(TelecomManager.class).addNewIncomingCall(
        account(c),
        extras
      );
    } catch (Exception e) {
      showIncoming(c, call);
    }
  }

  static void showIncoming(Context c, JSONObject call) {
    channels(c);
    String id = call.optString("id");
    Intent intent = new Intent(c, CallActivity.class)
      .putExtra("call", call.toString())
      .addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
      );
    PendingIntent show = PendingIntent.getActivity(
      c,
      id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    Notification.Builder b = new Notification.Builder(c, "calls")
      .setSmallIcon(R.drawable.jazz_icon)
      .setContentTitle("Jazz AI")
      .setContentText("Incoming voice call")
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
      .setContentIntent(show)
      .setFullScreenIntent(show, true)
      .setTimeoutAfter(45000);
    PendingIntent decline = action(c, id, "decline");
    PendingIntent answer = PendingIntent.getActivity(
      c,
      (id + "answer").hashCode(),
      new Intent(c, CallActivity.class)
        .putExtra("call", call.toString())
        .putExtra("answer", true),
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    if (Build.VERSION.SDK_INT >= 31) b.setStyle(
      Notification.CallStyle.forIncomingCall(
        new Person.Builder().setName("Jazz AI").setImportant(true).build(),
        decline,
        answer
      )
    );
    else b.addAction(0, "Decline", decline).addAction(0, "Answer", answer);
    c.getSystemService(NotificationManager.class).notify(2, b.build());
    if (ringtone == null) {
      ringtone = RingtoneManager.getRingtone(
        c,
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      );
      if (ringtone != null) {
        if (Build.VERSION.SDK_INT >= 28) ringtone.setLooping(true);
        ringtone.play();
      }
    }
    new Handler(Looper.getMainLooper()).postDelayed(
      () -> cancelIncoming(c, id),
      45000
    );
  }

  static void cancelIncoming(Context c, String id) {
    stopRinging(c, id, true);
  }

  static void stopRinging(Context c, String id, boolean finish) {
    if (!id.equals(ringingId)) return;
    ringingId = "";
    c.getSystemService(NotificationManager.class).cancel(2);
    if (ringtone != null) {
      ringtone.stop();
      ringtone = null;
    }
    if (finish) JazzConnectionService.finish(id);
  }

  static void message(Context c, JSONObject msg) {
    channels(c);
    c.getSystemService(NotificationManager.class).notify(
      msg.optString("id").hashCode(),
      new Notification.Builder(c, "messages")
        .setSmallIcon(R.drawable.jazz_icon)
        .setContentTitle("Jazz AI")
        .setContentText(msg.optString("text"))
        .setStyle(
          new Notification.BigTextStyle().bigText(msg.optString("text"))
        )
        .setAutoCancel(true)
        .setContentIntent(open(c))
        .build()
    );
  }
}
