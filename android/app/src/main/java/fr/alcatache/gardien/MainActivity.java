package fr.alcatache.gardien;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_FILE = 42;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#1C1D21"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AlcatacheGardien");

        web.addJavascriptInterface(new Bridge(this), "AlcaNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String host = req.getUrl().getHost();
                Uri app = Uri.parse(BuildConfig.APP_URL);
                if (host != null && host.equals(app.getHost())) return false;
                openExternal(req.getUrl().toString());
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try { startActivityForResult(Intent.createChooser(i, "Fichier de clé"), REQ_FILE); }
                catch (ActivityNotFoundException e) { fileCallback = null; return false; }
                return true;
            }
        });

        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }

        String url = BuildConfig.APP_URL + (BuildConfig.APP_URL.contains("?") ? "&" : "?") + "mode=parent";
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(url);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE && fileCallback != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null && data.getData() != null) r = new Uri[]{data.getData()};
            fileCallback.onReceiveValue(r);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    void openExternal(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { toast("Impossible d'ouvrir : " + url); }
    }

    void toast(String m) { runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show()); }

    /** Fonctions appelées depuis l'interface web (window.AlcaNative). */
    class Bridge {
        private final Context ctx;
        Bridge(Context c) { ctx = c.getApplicationContext(); }

        @JavascriptInterface
        public void startSiren(String json) {
            Intent i = new Intent(ctx, SirenService.class).putExtra("cfg", json);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        }

        @JavascriptInterface
        public void stopSiren() {
            ctx.stopService(new Intent(ctx, SirenService.class));
            Prefs.get(ctx).edit().remove(Prefs.CFG).apply();
        }

        @JavascriptInterface
        public boolean hasServiceKey() { return Prefs.get(ctx).getString(Prefs.KEY, null) != null; }

        @JavascriptInterface
        public String saveServiceKey(String json) {
            try {
                JSONObject o = new JSONObject(json);
                if (!o.has("private_key") || !o.has("client_email")) return "ce n'est pas une clé de compte de service";
                Fcm.signer(o); // vérifie que la clé est lisible
                Prefs.get(ctx).edit().putString(Prefs.KEY, json).apply();
                Fcm.resetToken();
                return "ok";
            } catch (Exception e) { return e.getMessage(); }
        }

        @JavascriptInterface
        public String testPush(String json) {
            new Thread(() -> {
                try {
                    JSONObject c = new JSONObject(json);
                    List<String> tokens = Firestore.familyTokens(c);
                    if (tokens.isEmpty()) { toast("Aucun iPhone n'a activé les alertes."); return; }
                    int ok = 0;
                    for (String t : tokens) if (Fcm.send(ctx, c.getString("projectId"), t,
                            "🧪 Test du Gardien", "Ceci est un essai. La prochaine fois, ce sera pour de vrai.",
                            c.optString("link"), "test")) ok++;
                    toast(ok + "/" + tokens.size() + " alerte(s) envoyée(s).");
                } catch (Exception e) { toast("Échec : " + e.getMessage()); }
            }).start();
            return "Envoi en cours…";
        }

        @JavascriptInterface
        public void openUrl(String url) { openExternal(url); }

        @JavascriptInterface
        public void openKids360() {
            PackageManager pm = getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
            ResolveInfo best = null;
            for (ResolveInfo r : apps) {
                String label = String.valueOf(r.loadLabel(pm)).toLowerCase(Locale.ROOT).replace(" ", "");
                String pkg = r.activityInfo.packageName.toLowerCase(Locale.ROOT);
                if (label.contains("kids360") || pkg.contains("kids360")) {
                    best = r;
                    if (!label.contains("alli")) break;
                }
            }
            if (best != null) {
                Intent l = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
                if (l != null) { startActivity(l.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
            }
            toast("Kids 360 introuvable sur ce téléphone.");
            openExternal("https://play.google.com/store/search?q=Kids360&c=apps");
        }
    }

    static class Prefs {
        static final String KEY = "serviceKey", CFG = "sirenCfg";
        static SharedPreferences get(Context c) { return c.getSharedPreferences("alca", MODE_PRIVATE); }
    }
}
