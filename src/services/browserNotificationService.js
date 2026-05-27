const permissionRequestKey = "fxDeskProNotificationPermissionRequested";

export async function initializeBrowserNotifications() {
  if (!supportsBrowserNotifications()) {
    return "unsupported";
  }

  if (Notification.permission !== "default") {
    return Notification.permission;
  }

  if (window.localStorage.getItem(permissionRequestKey) === "true") {
    return Notification.permission;
  }

  window.localStorage.setItem(permissionRequestKey, "true");

  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function showSmartAlertNotification(alert) {
  if (!supportsBrowserNotifications() || Notification.permission !== "granted") {
    return false;
  }

  try {
    const notification = new Notification(alert.title || buildFallbackTitle(alert), {
      body: alert.body || buildFallbackBody(alert),
      tag: `fx-desk-pro:${alert.pair}:${alert.type}`,
      renotify: false,
      silent: false,
    });

    window.setTimeout(() => notification.close(), 9000);
    return true;
  } catch {
    return false;
  }
}

function supportsBrowserNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function buildFallbackTitle(alert) {
  return `${alert.pair} ${alert.direction} Alert`;
}

function buildFallbackBody(alert) {
  return `Confidence: ${alert.confidence}%\n${alert.type}`;
}
