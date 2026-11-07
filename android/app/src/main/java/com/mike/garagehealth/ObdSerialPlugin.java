package com.mike.garagehealth;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
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
import java.util.Set;
import java.util.UUID;

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
                            JSObject ev = new JSObject();
                            ev.put("value", new String(buf, 0, n, StandardCharsets.ISO_8859_1));
                            notifyListeners("data", ev);
                        }
                    } catch (IOException ignored) {
                    }
                    if (socket == mine) {
                        closeQuietly();
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
        closeQuietly();
        call.resolve();
    }

    private synchronized void closeQuietly() {
        BluetoothSocket s = socket;
        socket = null;
        out = null;
        if (s != null) try { s.close(); } catch (IOException ignored) {}
    }

    @Override
    protected void handleOnDestroy() {
        closeQuietly();
    }
}
