// Optional native service. The PWA uses the same UI without native imports.
let service = null;
export function setDeviceNotifications(value) { service = value; }
export function getDeviceNotifications() { return service; }
