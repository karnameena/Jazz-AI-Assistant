package com.gunakarna.jazzwhatsapp;

import android.content.*;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.*;

public final class Api {

  public static final OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(90, TimeUnit.SECONDS)
    .pingInterval(20, TimeUnit.SECONDS)
    .build();

  public interface Result {
    void done(JSONObject data, String error);
  }

  public static android.content.SharedPreferences prefs(Context c) {
    return c.getSharedPreferences("jazz", Context.MODE_PRIVATE);
  }

  public static String base(Context c) {
    return prefs(c).getString("base", "");
  }

  public static String token(Context c) {
    return prefs(c).getString("token", "");
  }

  public static Request.Builder request(Context c, String route) {
    return new Request.Builder()
      .url(base(c) + "/api/jazzwhatsapp" + route)
      .header("Authorization", "Bearer " + token(c));
  }

  public static void call(
    Context c,
    String route,
    JSONObject body,
    Result callback
  ) {
    try {
      Request.Builder b = request(c, route);
      if (body != null) b.post(
        RequestBody.create(body.toString(), MediaType.get("application/json"))
      );
      client.newCall(b.build()).enqueue(
        new Callback() {
          public void onFailure(Call call, IOException e) {
            callback.done(
              null,
              "Jazz server is unreachable. Check the connection."
            );
          }

          public void onResponse(Call call, Response response) {
            try (response) {
              JSONObject data = new JSONObject(response.body().string());
              callback.done(
                data,
                response.isSuccessful()
                  ? null
                  : data.optString("error", "Request failed")
              );
            } catch (Exception e) {
              callback.done(null, "Invalid server response");
            }
          }
        }
      );
    } catch (Exception e) {
      callback.done(null, "Set your Jazz server URL first");
    }
  }

  public static JSONObject json(String... pairs) {
    JSONObject o = new JSONObject();
    try {
      for (int i = 0; i < pairs.length; i += 2) o.put(pairs[i], pairs[i + 1]);
    } catch (Exception ignored) {}
    return o;
  }
}
