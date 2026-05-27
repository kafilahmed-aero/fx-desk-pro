export const TEST_SIGNAL_CHANNEL_NAME = "Fx-test-feed";
export const TEST_SIGNAL_EXPIRATION_MINUTES = 5;

const TEST_SIGNAL_EXPIRATION_MS = TEST_SIGNAL_EXPIRATION_MINUTES * 60 * 1000;

export function isTestSignalSource(source = {}) {
  return [
    source.channel,
    source.channelTitle,
    source.sourceChannelName,
    source.sourceChannelTitle,
  ].some(isFxTestFeedChannel);
}

export function createTestSignalMetadata(rawMessage = {}, now = new Date()) {
  const isTestSignal = Boolean(rawMessage.isTestSignal || isTestSignalSource(rawMessage));

  if (!isTestSignal) {
    return {
      isTestSignal: false,
      expiresAt: null,
    };
  }

  return {
    isTestSignal: true,
    expiresAt: new Date(getSourceTime(rawMessage, now) + TEST_SIGNAL_EXPIRATION_MS).toISOString(),
  };
}

export function isExpiredTestSignal(signal = {}, now = new Date()) {
  if (!signal.isTestSignal) {
    return false;
  }

  const expiresAt = getExpiresAtTime(signal);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function isFxTestFeedChannel(value) {
  return normalizeChannelName(value) === normalizeChannelName(TEST_SIGNAL_CHANNEL_NAME);
}

function normalizeChannelName(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function getSourceTime(rawMessage, now) {
  const timestamp = rawMessage.timestamp || rawMessage.createdAt || rawMessage.fetchedAt;
  const parsed = timestamp ? new Date(timestamp).getTime() : NaN;

  return Number.isFinite(parsed) ? parsed : now.getTime();
}

function getExpiresAtTime(signal) {
  const explicitExpiresAt = signal.expiresAt ? new Date(signal.expiresAt).getTime() : NaN;

  if (Number.isFinite(explicitExpiresAt)) {
    return explicitExpiresAt;
  }

  const baseTime = getSourceTime(signal, new Date());
  return Number.isFinite(baseTime) ? baseTime + TEST_SIGNAL_EXPIRATION_MS : NaN;
}
