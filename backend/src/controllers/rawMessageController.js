import { getRawMessageCount, getRawMessages } from "../services/rawMessageStore.js";

// Raw message API for verifying ingestion before parser/consensus logic exists.
export async function getRawMessagesController(request, response) {
  const limit = Number(request.query.limit) || 100;

  response.json({
    count: await getRawMessageCount(),
    messages: await getRawMessages(limit),
  });
}
