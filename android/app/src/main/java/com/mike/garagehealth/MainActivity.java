package com.mike.garagehealth;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ObdSerialPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
