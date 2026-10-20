import { setDeviceWidget } from "./device-widget.js";
import { createDeviceSpeech, setDeviceSpeech } from "./device-speech.js";
import { createDeviceWidget } from "./widget-snapshot.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { LocalNotifications } from "@capacitor/local-notifications";
import { createDeviceNotifications } from "./local-reminders.js";
import { setDeviceNotifications } from "./device-notifications.js";
import { createNativeExporter, setNativeExporter } from "./file-export.js";

document.documentElement.dataset.platform = Capacitor.getPlatform();
if (Capacitor.isNativePlatform()) {
  setNativeExporter(createNativeExporter({ filesystem: Filesystem, share: Share, cacheDirectory: Directory.Cache, utf8: Encoding.UTF8 }));
  if (Capacitor.getPlatform() === "ios") {
    const speech = createDeviceSpeech(registerPlugin("MARKSpeech"));
    setDeviceSpeech(speech);
    await speech.listen();
    const reminders = createDeviceNotifications({ plugin: LocalNotifications, storage: localStorage });
    setDeviceNotifications(reminders);
    await reminders.listen();
    const widget = createDeviceWidget({ plugin: registerPlugin("MARKWidget") });
    setDeviceWidget(widget);
    await widget.listen();
  }
}
await import("./boot.js");
