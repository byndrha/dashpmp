package com.pabrikespmp.dashboard;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        super.load();
        getBridge().setWebViewClient(new OfflineAwareWebViewClient(getBridge()));
    }
}
