const permissionRequestKey = "fxDeskProNotificationPermissionRequested";
const smartAlertDebugPrefix = "[SMART_ALERT_DEBUG]";

export async function initializeBrowserNotifications() {
  console.info(`${smartAlertDebugPrefix} notification service initialization`);

  if (!supportsBrowserNotifications()) {
    console.info(`${smartAlertDebugPrefix} notification permission status`, {
      permission: "unsupported",
      reason: "Notification API is unavailable",
    });
    return "unsupported";
  }

  if (Notification.permission !== "default") {
    console.info(`${smartAlertDebugPrefix} notification permission status`, {
      permission: Notification.permission,
      reason: "permission already resolved",
    });
    return Notification.permission;
  }

  if (window.localStorage.getItem(permissionRequestKey) === "true") {
    console.info(`${smartAlertDebugPrefix} notification permission status`, {
      permission: Notification.permission,
      reason: "permission request was already attempted",
    });
    return Notification.permission;
  }

  window.localStorage.setItem(permissionRequestKey, "true");

  try {
    const permission = await Notification.requestPermission();
    console.info(`${smartAlertDebugPrefix} notification permission status`, {
      permission,
      reason: "permission request completed",
    });
    return permission;
  } catch (error) {
    console.warn(`${smartAlertDebugPrefix} notification permission status`, {
      permission: Notification.permission,
      reason: "permission request failed",
      error: error.message,
    });
    return Notification.permission;
  }
}

export function showSmartAlertNotification(alert) {
  if (!supportsBrowserNotifications()) {
    console.info(`${smartAlertDebugPrefix} alert filtered/skipped reason`, {
      reason: "Notification API is unavailable",
      pair: alert?.pair,
      alertType: alert?.type,
    });
    return false;
  }

  if (Notification.permission !== "granted") {
    console.info(`${smartAlertDebugPrefix} alert filtered/skipped reason`, {
      reason: "notification permission is not granted",
      permission: Notification.permission,
      pair: alert?.pair,
      alertType: alert?.type,
    });
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
    console.info(`${smartAlertDebugPrefix} browser notification dispatched`, {
      pair: alert?.pair,
      alertType: alert?.type,
      notificationTag: notification.tag,
    });
    return true;
  } catch (error) {
    console.warn(`${smartAlertDebugPrefix} alert filtered/skipped reason`, {
      reason: "browser notification dispatch failed",
      pair: alert?.pair,
      alertType: alert?.type,
      error: error.message,
    });
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
