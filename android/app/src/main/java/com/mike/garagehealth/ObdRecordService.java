package com.mike.garagehealth;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

// Keeps an OBD recording alive while another app is in front. Shows a
// notification with the recording's status and a Stop button, and holds a
// partial wake lock so the CPU keeps running with the screen off.
public class ObdRecordService extends Service {
    static final String CHANNEL = "obd_recording";
    static final int NOTE_ID = 4711;
    static final String ACTION_STOP = "com.mike.garagehealth.STOP_RECORDING";
    static final String EXTRA_TEXT = "text";

    private PowerManager.WakeLock wake;

    /** True while the service is in the foreground, so the native poll loop can refresh its text. */
    static volatile boolean running;

    /** Replace the notification text without going through the WebView (works with the app in the background). */
    static void update(Context ctx, String text) {
        if (!running) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTE_ID, build(ctx, text));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(CHANNEL, "OBD recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows while an OBD session is being recorded");
            nm.createNotificationChannel(ch);
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "garagehealth:obd");
        wake.setReferenceCounted(false);
        wake.acquire();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // Stop button: tell the web app, which ends the recording and stops this service.
            if (ObdSerialPlugin.current != null) ObdSerialPlugin.current.notifyStop();
            running = false;
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        String text = intent != null && intent.hasExtra(EXTRA_TEXT) ? intent.getStringExtra(EXTRA_TEXT) : "Recording OBD session";
        Notification n = build(this, text);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTE_ID, n);
        }
        running = true;
        return START_NOT_STICKY;
    }

    private static Notification build(Context ctx, String text) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, flags);
        PendingIntent stop = PendingIntent.getService(ctx, 1,
            new Intent(ctx, ObdRecordService.class).setAction(ACTION_STOP), flags);
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle("Garage Health: recording OBD")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .addAction(0, "Stop", stop)
            .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wake != null && wake.isHeld()) wake.release();
        wake = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
