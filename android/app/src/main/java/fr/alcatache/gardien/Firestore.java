package fr.alcatache.gardien;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Lecture de l'état de la prison via l'API REST Firestore (lecture seule). */
final class Firestore {
    static JSONObject doc(JSONObject c, String path) throws Exception {
        String url = "https://firestore.googleapis.com/v1/projects/" + c.getString("projectId")
                + "/databases/(default)/documents/" + path + "?key=" + c.getString("apiKey");
        return new JSONObject(Fcm.http("GET", url, null, null, null)).optJSONObject("fields");
    }

    static String str(JSONObject fields, String k) {
        if (fields == null) return null;
        JSONObject v = fields.optJSONObject(k);
        return v == null || !v.has("stringValue") ? null : v.optString("stringValue");
    }

    static List<String> familyTokens(JSONObject c) throws Exception {
        return tokens(doc(c, "families/" + c.getString("fid")));
    }

    static List<String> tokens(JSONObject fam) {
        List<String> r = new ArrayList<>();
        if (fam == null) return r;
        JSONObject t = fam.optJSONObject("tokens");
        JSONArray a = t == null ? null : t.optJSONObject("arrayValue") == null ? null : t.optJSONObject("arrayValue").optJSONArray("values");
        if (a != null) for (int i = 0; i < a.length(); i++) {
            String s = a.optJSONObject(i).optString("stringValue", "");
            if (!s.isEmpty()) r.add(s);
        }
        return r;
    }

    /** Tâches d'une cellule : liste de {label, icon, status}. */
    static List<JSONObject> tasks(JSONObject cell) {
        List<JSONObject> r = new ArrayList<>();
        if (cell == null) return r;
        JSONObject t = cell.optJSONObject("tasks");
        JSONArray a = t == null ? null : t.optJSONObject("arrayValue") == null ? null : t.optJSONObject("arrayValue").optJSONArray("values");
        if (a != null) for (int i = 0; i < a.length(); i++) {
            JSONObject f = a.optJSONObject(i).optJSONObject("mapValue");
            f = f == null ? null : f.optJSONObject("fields");
            JSONObject o = new JSONObject();
            try {
                o.put("label", str(f, "label")).put("icon", str(f, "icon")).put("status", str(f, "status")).put("key", str(f, "key"));
            } catch (Exception ignored) { }
            r.add(o);
        }
        return r;
    }
}
