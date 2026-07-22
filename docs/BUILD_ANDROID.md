# Build & Install the Android App

The Capacitor project in this repo (`android/`) cannot be compiled in the
development environment these changes were written in (no Android SDK
installed). This is the manual process to actually produce and install the
APK, done once you have Android Studio available.

## Prerequisites

- [Android Studio](https://developer.android.com/studio) installed (it
  bundles the Android SDK).
- This repo cloned, with `npm install` already run.

## One-time: create a release signing key

Only needed the first time, or if the key is ever lost (losing it means you
can never publish an update under the same app identity again — back it up
somewhere safe, outside this git repo):

```bash
keytool -genkey -v -keystore pmp-release.keystore -alias pmp-release -keyalg RSA -keysize 2048 -validity 10000
```

Answer its prompts (name, org, etc. — cosmetic, not user-facing) and choose
a strong password. Then create `android/key.properties` (already
`.gitignore`d — never commit this file):

```properties
storeFile=../../pmp-release.keystore
storePassword=<the password you set above>
keyAlias=pmp-release
keyPassword=<the password you set above>
```

## Build the APK

1. Open the `android/` folder in Android Studio (File > Open).
2. Let it finish Gradle sync (first time may take several minutes while it
   downloads the Gradle distribution and dependencies — needs internet).
3. Build > Generate Signed Bundle / APK... > APK > select the keystore from
   the previous step > Release > Finish.
4. The signed APK appears under `android/app/release/app-release.apk`.

## Install & test on a device

1. Enable "Install unknown apps" for whichever app you'll transfer the APK
   through (e.g. Files, a messaging app) on the target Android phone —
   Settings > Apps > Special access > Install unknown apps.
2. Transfer `app-release.apk` to the phone and open it to install.
3. Open the app and verify:
   - It loads the dashboard and the login screen appears.
   - Logging in works and the session persists after fully closing and
     reopening the app.
   - Navigate to Pemasaran > "+ Pengajuan Baru" and tap "Pakai Lokasi
     Saya" in the Lokasi GPS section — Android should show its standard
     location-permission dialog the first time; after granting it, the map
     pin should move to the device's actual GPS position.
   - The hardware Back button navigates back through the app's pages, and
     exits/backgrounds the app from the home/root page.
   - Toggling light/dark mode (Mode Tampilan menu) changes the status bar
     icon color to match.

## Updating the app later

Whenever the web app at `https://dash.pabrikespmp.com` changes, **no
rebuild is needed** — the app loads that URL live, so changes appear the
next time the app is opened or the page reloads. A new APK build is only
needed when this repo's `android/`, `capacitor.config.ts`, or native plugin
set changes (e.g. adding a new Capacitor plugin).
