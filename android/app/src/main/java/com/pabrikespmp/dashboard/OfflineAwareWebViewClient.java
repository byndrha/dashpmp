package com.pabrikespmp.dashboard;

import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

// Replaces Android's built-in "no connection" error screen with the app's
// own branded offline.html asset whenever the top-level page fails to
// load — covers both a cold start with no connectivity and an in-app
// navigation attempted while offline (both are the same WebView-level
// event: a failed main-frame load). Sub-resource failures (e.g. one
// broken image on an otherwise-fine page) fall through to Capacitor's
// normal handling, unchanged.
public class OfflineAwareWebViewClient extends BridgeWebViewClient {

    private static final String OFFLINE_PAGE = "file:///android_asset/offline.html";

    public OfflineAwareWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
            view.loadUrl(OFFLINE_PAGE + "?target=" + Uri.encode(request.getUrl().toString()));
            return;
        }
        super.onReceivedError(view, request, error);
    }
}
