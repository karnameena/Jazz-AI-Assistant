package com.gunakarna.jazzwhatsapp;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;

/** Active notification snapshot only; never claims access to app inbox databases. */
public class MessageNotificationListener extends NotificationListenerService {
  private static volatile MessageNotificationListener instance;
  public static void refresh() { if (instance != null) instance.schedule(); }
  private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
  private final Runnable upload = this::publish;
  public void onListenerConnected() { instance = this; schedule(); }
  public void onNotificationPosted(StatusBarNotification notification) { schedule(); }
  public void onNotificationRemoved(StatusBarNotification notification) { schedule(); }
  private void schedule() { handler.removeCallbacks(upload); handler.postDelayed(upload, 400); }
  private void publish() {
    if (Api.token(this).isEmpty()) return;
    JSONArray items = new JSONArray();
    try {
      for (StatusBarNotification sbn : getActiveNotifications()) {
        String pkg = sbn.getPackageName();
        boolean allowed = pkg.equals("com.whatsapp") || pkg.equals("com.whatsapp.w4b") || pkg.equals("com.instagram.android") || pkg.equals("com.google.android.apps.messaging") || pkg.equals("com.android.mms") || pkg.equals("com.samsung.android.messaging");
        Notification n = sbn.getNotification();
        if (!allowed || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0 || (n.flags & Notification.FLAG_ONGOING_EVENT) != 0) continue;
        Bundle extras = n.extras;
        String title = String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE, ""));
        String text = String.valueOf(extras.getCharSequence(Notification.EXTRA_TEXT, ""));
        android.os.Parcelable[] messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        int count = messages == null ? Math.max(1, n.number) : Math.max(1, messages.length);
        items.put(Api.json("key", sbn.getKey(), "app", pkg.contains("whatsapp") ? "WhatsApp" : pkg.contains("instagram") ? "Instagram" : "SMS", "title", title, "text", text, "count", String.valueOf(count)));
        if (items.length() >= 100) break;
      }
      JSONObject body = Api.json("deviceId", Api.prefs(this).getString("notificationDevice", ""));
      body.put("items", items);
      if (body.optString("deviceId").isEmpty()) {
        String id = java.util.UUID.randomUUID().toString();
        Api.prefs(this).edit().putString("notificationDevice", id).apply(); body.put("deviceId", id);
      }
      Api.call(this, "/notifications", body, (data, error) -> {});
    } catch (Exception ignored) { /* Notification access can be revoked at any time. */ }
  }
  public void onDestroy() { instance = null; handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
