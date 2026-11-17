package com.mike.garagehealth;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;


/**
 * Minimal Bluetooth Classic (SPP / RFCOMM) bridge for ELM327 adapters.
 * Lists paired devices, connects with three fallbacks used by cheap clones
 * (secure SPP, insecure SPP, raw RFCOMM channel 1), streams bytes to JS.
 */
@CapacitorPlugin(
    name = "ObdSerial",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "connect")
    }
)
public class ObdSerialPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothSocket socket;
    private OutputStream out;
    private Thread reader;

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m != null ? m.getAdapter() : null;
    }

    /** Android 12+ needs the runtime "Nearby devices" permission. Older versions don't. */
    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("connect") != PermissionState.GRANTED;
    }

    /** Returns false (and rejects) when the call can't continue. */
    private boolean ready(PluginCall call, String callback) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("This phone has no Bluetooth"); return false; }
        if (needsPermission()) { requestPermissionForAlias("connect", call, callback); return false; }
        if (!a.isEnabled()) { call.reject("Bluetooth is off. Turn it on and try again."); return false; }
        return true;
    }

    @PermissionCallback
    private void permPaired(PluginCall call) {
        if (needsPermission()) call.reject("Nearby devices permission denied. Allow it in Android Settings > Apps > Garage Health > Permissions.");
        else listPaired(call);
    }

    @PermissionCallback
    private void permConnect(PluginCall call) {
        if (needsPermission()) call.reject("Nearby devices permission denied. Allow it in Android Settings > Apps > Garage Health > Permissions.");
        else connect(call);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void listPaired(PluginCall call) {
        if (!ready(call, "permPaired")) return;
        JSArray list = new JSArray();
        Set<BluetoothDevice> bonded = adapter().getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName());
                o.put("address", d.getAddress());
                o.put("type", d.getType()); // 1 classic, 2 LE, 3 dual
                list.put(o);
            }
        }
        JSObject res = new JSObject();
        res.put("devices", list);
        call.resolve(res);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address", "");
        address = address == null ? "" : address.trim().toUpperCase();
        if (!BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("Not a valid Bluetooth address: " + address);
            return;
        }
        if (!ready(call, "permConnect")) return;
        final String addr = address;
        new Thread(() -> {
            closeQuietly();
            BluetoothAdapter a = adapter();
            try { a.cancelDiscovery(); } catch (Exception ignored) {}
            BluetoothDevice dev = a.getRemoteDevice(addr);
            StringBuilder errors = new StringBuilder();
            BluetoothSocket s = null;
            for (int attempt = 0; attempt < 3 && s == null; attempt++) {
                BluetoothSocket tryS = null;
                try {
                    if (attempt == 0) tryS = dev.createRfcommSocketToServiceRecord(SPP);
                    else if (attempt == 1) tryS = dev.createInsecureRfcommSocketToServiceRecord(SPP);
                    else {
                        Method m = dev.getClass().getMethod("createRfcommSocket", int.class);
                        tryS = (BluetoothSocket) m.invoke(dev, 1);
                    }
                    tryS.connect();
                    s = tryS;
                } catch (Exception e) {
                    String[] names = { "secure", "insecure", "channel 1" };
                    errors.append(names[attempt]).append(": ").append(e.getMessage()).append("; ");
                    if (tryS != null) try { tryS.close(); } catch (IOException ignored) {}
                }
            }
            if (s == null) {
                call.reject("Could not open the adapter (" + errors + "). Check the key is on and no other app (OBD Fusion, OBDroid) is connected to it.");
                return;
            }
            try {
                socket = s;
                out = s.getOutputStream();
                final InputStream in = s.getInputStream();
                final BluetoothSocket mine = s;
                reader = new Thread(() -> {
                    byte[] buf = new byte[1024];
                    try {
                        while (true) {
                            int n = in.read(buf);
                            if (n < 0) break;
                            if (n == 0) continue;
                            String chunk = new String(buf, 0, n, StandardCharsets.ISO_8859_1);
                            if (nativeMode) {
                                // Native poll loop owns the link: replies go to execNative, not the WebView.
                                synchronized (nbuf) { nbuf.append(chunk); nbuf.notifyAll(); }
                                continue;
                            }
                            JSObject ev = new JSObject();
                            ev.put("value", chunk);
                            notifyListeners("data", ev);
                        }
                    } catch (IOException ignored) {
                    }
                    if (socket == mine) {
                        closeQuietly();
                        polling = false;
                        synchronized (nbuf) { nbuf.notifyAll(); }
                        notifyListeners("disconnected", new JSObject());
                    }
                });
                reader.setDaemon(true);
                reader.start();
                JSObject res = new JSObject();
                res.put("address", addr);
                call.resolve(res);
            } catch (IOException e) {
                closeQuietly();
                call.reject("Connected but could not open streams: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void write(PluginCall call) {
        String value = call.getString("value", "");
        OutputStream o = out;
        if (o == null) { call.reject("Not connected"); return; }
        try {
            o.write(value.getBytes(StandardCharsets.ISO_8859_1));
            o.flush();
            call.resolve();
        } catch (IOException e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    // ---------- Native poll loop ----------
    // The WebView's timers are throttled or paused when another app (Spotify,
    // Maps) is in front, which leaves gaps in a recording. While a live session
    // runs, this thread does the request/reply loop itself and buffers every
    // raw reply; the web app drains the buffer whenever it gets to run and
    // decodes the replies with the same PID formulas as before.

    private static final int MAX_SAMPLES = 200000; // about 5.5 h at 10 passes/s
    private final StringBuilder nbuf = new StringBuilder();
    private final ReentrantLock io = new ReentrantLock(true); // fair: JS commands get a turn between PIDs
    private volatile boolean nativeMode = false;
    private volatile boolean polling = false;
    private volatile String[] pollPids = new String[0];
    private volatile long rateMs = 0;
    private volatile double hz = 0;
    private Thread poller;
    private final Object sleeper = new Object();
    private final List<JSObject> samples = new ArrayList<>();
    private int dropped = 0;
    private volatile long recStart = 0;
    private volatile int recRows = 0;

    /** Send one command and wait for the ELM327 prompt. Returns null on timeout. */
    private String execNative(String cmd, long timeoutMs) throws IOException, InterruptedException {
        if (!io.tryLock(timeoutMs + 2000, TimeUnit.MILLISECONDS)) return null;
        try {
            OutputStream o = out;
            if (o == null) throw new IOException("Not connected");
            synchronized (nbuf) { nbuf.setLength(0); }
            o.write((cmd + "\r").getBytes(StandardCharsets.ISO_8859_1));
            o.flush();
            long end = System.currentTimeMillis() + timeoutMs;
            synchronized (nbuf) {
                while (true) {
                    int p = nbuf.lastIndexOf(">");
                    if (p >= 0) {
                        String r = nbuf.substring(0, p);
                        nbuf.setLength(0);
                        return r;
                    }
                    if (out == null) throw new IOException("Adapter disconnected");
                    long left = end - System.currentTimeMillis();
                    if (left <= 0) return null;
                    nbuf.wait(left);
                }
            }
        } finally {
            io.unlock();
        }
    }

    private static String[] toPids(JSArray arr) {
        if (arr == null) return new String[0];
        List<String> l = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            String p = arr.optString(i, "");
            if (p.matches("[0-9A-Fa-f]{2}")) l.add(p.toUpperCase());
        }
        return l.toArray(new String[0]);
    }

    /** Start the native loop: { pids: ["0C","05",...], rateMs }. */
    @PluginMethod
    public void startPoll(PluginCall call) {
        if (out == null) { call.reject("Not connected"); return; }
        stopPollThread();
        pollPids = toPids(call.getArray("pids"));
        rateMs = Math.max(0, call.getLong("rateMs", 0L));
        synchronized (samples) { samples.clear(); dropped = 0; }
        synchronized (nbuf) { nbuf.setLength(0); }
        nativeMode = true;
        polling = true;
        poller = new Thread(this::pollLoop, "obd-poll");
        poller.setDaemon(true);
        poller.start();
        call.resolve();
    }

    /** Change PIDs or rate while running. */
    @PluginMethod
    public void updatePoll(PluginCall call) {
        if (call.getData().has("pids")) pollPids = toPids(call.getArray("pids"));
        if (call.getData().has("rateMs")) rateMs = Math.max(0, call.getLong("rateMs", 0L));
        wakePoller(); // cut a long sleep short (never interrupts a command in flight)
        call.resolve();
    }

    @PluginMethod
    public void stopPoll(PluginCall call) {
        stopPollThread();
        nativeMode = false;
        call.resolve();
    }

    private void wakePoller() {
        synchronized (sleeper) { sleeper.notifyAll(); }
    }

    private void stopPollThread() {
        polling = false;
        wakePoller();
        Thread t = poller;
        poller = null;
        // Let the command in flight finish (at most its 4 s timeout) so the adapter isn't left mid-reply.
        if (t != null) try { t.join(6000); } catch (InterruptedException ignored) {}
    }

    /** Everything recorded since the last drain: { samples: [{ t, r: { pid: reply }, v: reply }], hz, running, dropped }. */
    @PluginMethod
    public void drainPoll(PluginCall call) {
        JSArray arr = new JSArray();
        int d;
        synchronized (samples) {
            for (JSObject o : samples) arr.put(o);
            samples.clear();
            d = dropped;
            dropped = 0;
        }
        JSObject res = new JSObject();
        res.put("samples", arr);
        res.put("hz", hz);
        res.put("running", polling);
        res.put("dropped", d);
        call.resolve(res);
    }

    /** One command through the native link, used for code reads etc. while the loop runs. */
    @PluginMethod
    public void exec(PluginCall call) {
        final String cmd = call.getString("cmd", "");
        final long timeout = call.getLong("timeout", 4000L);
        new Thread(() -> {
            try {
                String r = execNative(cmd, timeout);
                if (r == null) { call.reject("Timeout on " + cmd); return; }
                JSObject res = new JSObject();
                res.put("value", r);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Command failed");
            }
        }).start();
    }

    private void pollLoop() {
        long n = 0;
        long lastNote = 0;
        while (polling && out != null) {
            long t0 = System.currentTimeMillis();
            JSObject sample = new JSObject();
            JSObject r = new JSObject();
            boolean moduleVolts = false;
            try {
                for (String pid : pollPids) {
                    if (!polling) break;
                    String reply = execNative("01" + pid, 4000);
                    if (reply == null) continue; // skip one slow PID, same as the web loop
                    r.put(pid, reply);
                    if (pid.equals("42") && reply.replaceAll("\\s", "").toUpperCase().contains("4142")) moduleVolts = true;
                }
                // Same rule as the web loop: adapter voltage every pass, or every 5th when PID 42 answers.
                if (polling && (n++ % 5 == 0 || !moduleVolts)) {
                    String v = execNative("ATRV", 4000);
                    if (v != null) sample.put("v", v);
                }
            } catch (InterruptedException | IOException e) {
                break;
            }
            if (!polling) break;
            sample.put("t", t0);
            sample.put("r", r);
            synchronized (samples) {
                if (samples.size() >= MAX_SAMPLES) { samples.remove(0); dropped++; }
                samples.add(sample);
            }
            if (recStart > 0) {
                recRows++;
                long now = System.currentTimeMillis();
                if (now - lastNote > 5000) {
                    lastNote = now;
                    long s = (now - recStart) / 1000;
                    ObdRecordService.update(getContext(), String.format(java.util.Locale.US, "%d:%02d · %d rows", s / 60, s % 60, recRows));
                }
            }
            long left = rateMs - (System.currentTimeMillis() - t0);
            if (left > 0 && polling) {
                synchronized (sleeper) {
                    try { sleeper.wait(left); } catch (InterruptedException e) { break; }
                }
            }
            long dt = System.currentTimeMillis() - t0;
            hz = dt > 0 ? 1000.0 / dt : 0;
        }
        polling = false;
    }

    /** The plugin instance the background recording service talks back to. */
    static ObdSerialPlugin current;

    void notifyStop() { notifyListeners("recordStop", new JSObject()); }

    /** Start (or refresh) the recording notification. Keeps recording with other apps in front. */
    @PluginMethod
    public void startRecording(PluginCall call) {
        current = this;
        if (recStart == 0) { recStart = System.currentTimeMillis(); recRows = 0; }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
        Intent i = new Intent(getContext(), ObdRecordService.class).putExtra(ObdRecordService.EXTRA_TEXT, call.getString("text", "Recording OBD session"));
        ContextCompat.startForegroundService(getContext(), i);
        call.resolve();
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        recStart = 0;
        getContext().stopService(new Intent(getContext(), ObdRecordService.class));
        call.resolve();
    }

    /** Keep the screen on while the live dashboard is open. */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        stopPollThread();
        nativeMode = false;
        closeQuietly();
        call.resolve();
    }

    private synchronized void closeQuietly() {
        BluetoothSocket s = socket;
        socket = null;
        out = null;
        if (s != null) try { s.close(); } catch (IOException ignored) {}
        synchronized (nbuf) { nbuf.notifyAll(); }
    }

    @Override
    protected void handleOnDestroy() {
        polling = false;
        closeQuietly();
    }
}
