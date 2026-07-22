import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pabrikespmp.dashboard",
  appName: "PMP Group",
  webDir: "capacitor-www",
  server: {
    url: "https://dash.pabrikespmp.com",
    androidScheme: "https",
  },
};

export default config;
