package fr.alcatache.gardien;

import android.content.Context;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;

/** Envoi des alertes Web Push vers l'iPhone via Firebase Cloud Messaging (API HTTP v1). */
final class Fcm {
    private static String accessToken;
    private static long tokenExpiry;

    static void resetToken() { accessToken = null; tokenExpiry = 0; }

    static PrivateKey signer(JSONObject key) throws Exception {
        String pem = key.getString("private_key")
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] der = Base64.decode(pem, Base64.DEFAULT);
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    private static String b64(byte[] b) { return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }

    private static synchronized String token(Context ctx) throws Exception {
        long now = System.currentTimeMillis() / 1000;
        if (accessToken != null && now < tokenExpiry - 120) return accessToken;
        String raw = MainActivity.Prefs.get(ctx).getString(MainActivity.Prefs.KEY, null);
        if (raw == null) throw new Exception("clé de service non importée");
        JSONObject key = new JSONObject(raw);
        String header = b64("{\"alg\":\"RS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        JSONObject claims = new JSONObject()
                .put("iss", key.getString("client_email"))
                .put("scope", "https://www.googleapis.com/auth/firebase.messaging")
                .put("aud", "https://oauth2.googleapis.com/token")
                .put("iat", now).put("exp", now + 3600);
        String unsigned = header + "." + b64(claims.toString().getBytes(StandardCharsets.UTF_8));
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(signer(key));
        sig.update(unsigned.getBytes(StandardCharsets.UTF_8));
        String jwt = unsigned + "." + b64(sig.sign());
        String form = "grant_type=" + URLEncoder.encode("urn:ietf:params:oauth:grant-type:jwt-bearer", "UTF-8") + "&assertion=" + jwt;
        JSONObject r = new JSONObject(http("POST", "https://oauth2.googleapis.com/token", form,
                "application/x-www-form-urlencoded", null));
        accessToken = r.getString("access_token");
        tokenExpiry = now + r.optLong("expires_in", 3600);
        return accessToken;
    }

    /** @return true si FCM a accepté le message. */
    static boolean send(Context ctx, String projectId, String deviceToken, String title, String body, String link, String tag) {
        try {
            JSONObject notif = new JSONObject().put("title", title).put("body", body)
                    .put("tag", tag).put("requireInteraction", true);
            if (link != null && !link.isEmpty()) notif.put("icon", link + "icon-192.png");
            JSONObject webpush = new JSONObject()
                    .put("headers", new JSONObject().put("Urgency", "high").put("TTL", "300"))
                    .put("notification", notif);
            if (link != null && link.startsWith("https://")) webpush.put("fcm_options", new JSONObject().put("link", link));
            JSONObject msg = new JSONObject().put("message", new JSONObject().put("token", deviceToken).put("webpush", webpush));
            http("POST", "https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send",
                    msg.toString(), "application/json", token(ctx));
            return true;
        } catch (Exception e) {
            android.util.Log.w("Alcatache", "FCM: " + e.getMessage());
            return false;
        }
    }

    static String http(String method, String url, String body, String type, String bearer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(20000);
        c.setRequestMethod(method);
        if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", type);
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = c.getResponseCode();
        InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (in != null) { byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0) out.write(b, 0, n); in.close(); }
        String res = out.toString("UTF-8");
        if (code >= 400) throw new Exception("HTTP " + code + " " + res);
        return res;
    }
}
