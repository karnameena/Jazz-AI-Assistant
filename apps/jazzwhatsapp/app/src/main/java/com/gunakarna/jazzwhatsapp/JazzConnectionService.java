package com.gunakarna.jazzwhatsapp;

import android.os.*;
import android.telecom.*;
import java.util.concurrent.ConcurrentHashMap;
import org.json.*;

public class JazzConnectionService extends ConnectionService {

  static final ConcurrentHashMap<String, Connection> connections =
    new ConcurrentHashMap<>();

  public Connection onCreateOutgoingConnection(
    PhoneAccountHandle account,
    ConnectionRequest request
  ) {
    try {
      Bundle extras = request.getExtras();
      Bundle nested = extras.getBundle(
        TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS
      );
      if (nested != null) extras = nested;
      JSONObject call = new JSONObject(extras.getString("call"));
      String id = call.getString("id");
      Connection connection = new Connection() {
        public void onDisconnect() {
          CallActionReceiver.act(JazzConnectionService.this, id, "end");
        }
      };
      connection.setConnectionProperties(Connection.PROPERTY_SELF_MANAGED);
      connection.setAudioModeIsVoip(true);
      connection.setCallerDisplayName(
        "Jazz AI",
        TelecomManager.PRESENTATION_ALLOWED
      );
      connection.setActive();
      connections.put(id, connection);
      return connection;
    } catch (Exception e) {
      return Connection.createFailedConnection(
        new DisconnectCause(DisconnectCause.ERROR)
      );
    }
  }

  public Connection onCreateIncomingConnection(
    PhoneAccountHandle account,
    ConnectionRequest request
  ) {
    try {
      JSONObject call = new JSONObject(request.getExtras().getString("call"));
      String id = call.getString("id");
      Connection connection = new Connection() {
        public void onShowIncomingCallUi() {
          Notifications.showIncoming(JazzConnectionService.this, call);
        }

        public void onAnswer() {
          startActivity(
            new android.content.Intent(
              JazzConnectionService.this,
              CallActivity.class
            )
              .putExtra("call", call.toString())
              .putExtra("answer", true)
              .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
          );
        }

        public void onReject() {
          CallActionReceiver.act(JazzConnectionService.this, id, "decline");
        }

        public void onDisconnect() {
          CallActionReceiver.act(JazzConnectionService.this, id, "end");
        }

        public void onSilence() {
          if (Notifications.ringtone != null) Notifications.ringtone.stop();
        }
      };
      connection.setConnectionProperties(Connection.PROPERTY_SELF_MANAGED);
      connection.setAudioModeIsVoip(true);
      connection.setCallerDisplayName(
        "Jazz AI",
        TelecomManager.PRESENTATION_ALLOWED
      );
      connection.setRinging();
      connections.put(id, connection);
      return connection;
    } catch (Exception e) {
      return Connection.createFailedConnection(
        new DisconnectCause(DisconnectCause.ERROR)
      );
    }
  }

  static void active(String id) {
    Connection c = connections.get(id);
    if (c != null) c.setActive();
  }

  static void finish(String id) {
    Connection c = connections.remove(id);
    if (c != null) {
      c.setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
      c.destroy();
    }
  }
}
