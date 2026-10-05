package com.gunakarna.jazzwhatsapp;
import android.content.Context;
import org.json.*;

/** Persists queued text independently of the WebView so the connection service can deliver it. */
public final class Outbox {
  private static boolean busy;
  private static String key(Context c) { return "outbox:" + Api.base(c); }
  private static JSONArray read(Context c) { try { return new JSONArray(Api.prefs(c).getString(key(c), "[]")); } catch (Exception e) { return new JSONArray(); } }
  public static synchronized void enqueue(Context c, String raw) {
    try {
      JSONObject body = new JSONObject(raw);
      JSONArray list = read(c);
      for (int i=0;i<list.length();i++) if (list.getJSONObject(i).optString("clientId").equals(body.optString("clientId"))) return;
      list.put(body); Api.prefs(c).edit().putString(key(c),list.toString()).commit();
    } catch (Exception ignored) {}
    flush(c.getApplicationContext());
  }
  public static synchronized void clear(Context c) { Api.prefs(c).edit().remove(key(c)).apply(); }
  public static synchronized void flush(Context c) {
    if (busy || Api.token(c).isEmpty() || !RealtimeService.status.equals("Connected")) return;
    JSONArray list = read(c); if (list.length()==0) return;
    JSONObject body = list.optJSONObject(0); if (body==null) return;
    final String queueKey=key(c), token=Api.token(c), clientId=body.optString("clientId");
    busy=true;
    Api.call(c,"/message",body,(data,error)-> {
      synchronized(Outbox.class) {
        busy=false;
        if (error!=null || !queueKey.equals(key(c)) || !token.equals(Api.token(c))) return;
        JSONArray current=read(c), remaining=new JSONArray();
        for(int i=0;i<current.length();i++) { JSONObject item=current.optJSONObject(i); if(item!=null && !item.optString("clientId").equals(clientId)) remaining.put(item); }
        Api.prefs(c).edit().putString(queueKey,remaining.toString()).apply();
      }
      if(data.optJSONObject("message")!=null) RealtimeService.event(c,Api.json("type","outbox.delivered","clientId",clientId));
      flush(c);
    });
  }
}
