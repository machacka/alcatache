package fr.alcatache.gardien;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Service de premier plan du Gardien : tant qu'une cellule est active,
 * il renvoie une alerte sur l'iPhone toutes les N secondes et prévient
 * le parent quand la détenue déclare une tâche terminée.
 */
public class SirenService extends Service {
    private static final int FG_ID = 7;
    private volatile JSONObject cfg;
    private volatile boolean running;
    private Thread worker;
    private PowerManager.WakeLock wake;
    private final Set<String> reported = new HashSet<>();
    private int count = 0;

    private static final String[] TITLES = {
            "🚨 %s — ÉVASION INTERDITE", "⛓️ RAPPEL N°%2$d", "🔒 Le Gardien attend", "📢 SENTENCE NON EXÉCUTÉE",
            "🚔 Mandat d'exécution immédiate", "⚠️ Le mitard te tend les bras"
    };

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("garde", "Surveillance en cours", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel("rapport", "Rapports de la détenue", NotificationManager.IMPORTANCE_HIGH));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String raw = intent != null ? intent.getStringExtra("cfg") : null;
        if (raw == null) raw = MainActivity.Prefs.get(this).getString(MainActivity.Prefs.CFG, null);
        Notification n = fgNotif("Surveillance de la cellule…");
        if (Build.VERSION.SDK_INT >= 29) startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(FG_ID, n);
        if (raw == null) { stopSelf(); return START_NOT_STICKY; }
        try {
            JSONObject next = new JSONObject(raw);
            boolean sameCell = cfg != null && cfg.optString("cellId").equals(next.optString("cellId"));
            cfg = next;
            MainActivity.Prefs.get(this).edit().putString(MainActivity.Prefs.CFG, raw).apply();
            if (!sameCell) { reported.clear(); count = 0; }
            if (worker == null || !worker.isAlive()) {
                running = true;
                PowerManager pm = getSystemService(PowerManager.class);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "alcatache:siren");
                wake.acquire(6 * 3600 * 1000L);
                worker = new Thread(this::loop, "siren");
                worker.start();
            } else if (!sameCell) {
                worker.interrupt(); // nouvelle cellule : alerte immédiate
            }
        } catch (Exception e) { stopSelf(); }
        return START_STICKY;
    }

    private void loop() {
        while (running) {
            JSONObject c = cfg;
            int interval = Math.max(30, c.optInt("intervalSec", 60));
            try {
                String fid = c.getString("fid"), cellId = c.getString("cellId");
                JSONObject fam = Firestore.doc(c, "families/" + fid);
                String active = Firestore.str(fam, "activeCell");
                JSONObject cell = cellId.equals(active) ? Firestore.doc(c, "families/" + fid + "/cells/" + cellId) : null;
                if (cell == null || !"active".equals(Firestore.str(cell, "status"))) {
                    MainActivity.Prefs.get(this).edit().remove(MainActivity.Prefs.CFG).apply();
                    running = false; stopSelf(); break;
                }
                List<JSONObject> tasks = Firestore.tasks(cell);
                String motif = Firestore.str(cell, "motif");
                String name = c.optString("childName", "Détenue n°1");
                JSONObject current = null; int done = 0, ok = 0;
                for (JSONObject t : tasks) {
                    String s = t.optString("status");
                    if ("validated".equals(s)) ok++;
                    else if ("done".equals(s)) {
                        done++;
                        String key = t.optString("key");
                        if (reported.add(key)) report(name + " déclare : " + t.optString("icon") + " " + t.optString("label"),
                                "Ouvrez la cellule pour valider ou refuser.");
                    } else if (current == null) current = t;
                }
                count++;
                String title = String.format(TITLES[(count - 1) % TITLES.length], name.toUpperCase(), count);
                String body = current != null
                        ? current.optString("icon") + " " + current.optString("label") + " — Motif : " + motif
                        : "Travaux déclarés, inspection en cours. Les alertes continuent jusqu'à validation.";
                int sent = 0;
                List<String> tokens = Firestore.tokens(fam);
                for (String tok : tokens) if (Fcm.send(this, c.getString("projectId"), tok, title, body, c.optString("link"), "alca" + count)) sent++;
                update("Relance n°" + count + " · " + ok + "/" + tasks.size() + " validée(s)"
                        + (done > 0 ? " · " + done + " à inspecter" : "")
                        + (tokens.isEmpty() ? " · ⚠️ aucun iPhone" : sent == 0 ? " · ⚠️ envoi échoué" : ""));
            } catch (Exception e) {
                update("Réseau indisponible, nouvel essai… (" + e.getMessage() + ")");
                interval = 20;
            }
            try { Thread.sleep(interval * 1000L); } catch (InterruptedException ignored) { }
        }
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification fgNotif(String text) {
        return new Notification.Builder(this, "garde")
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle("🚨 Cellule occupée")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(openApp())
                .build();
    }

    private void update(String text) { getSystemService(NotificationManager.class).notify(FG_ID, fgNotif(text)); }

    private void report(String title, String text) {
        Notification n = new Notification.Builder(this, "rapport")
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle(title).setContentText(text)
                .setAutoCancel(true).setContentIntent(openApp()).build();
        getSystemService(NotificationManager.class).notify((int) (System.currentTimeMillis() % 100000) + 100, n);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }
}
