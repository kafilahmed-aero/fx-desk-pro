// parsers will turn raw Telegram text into structured signal data.
// Advanced parsing rules are intentionally not implemented yet.
export function parseSignalMessage(rawMessage) {
  return {
    rawMessage,
    parsed: false,
  };
}
