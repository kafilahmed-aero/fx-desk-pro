import { parseSignalMessage } from '../parsers/signalParser.js';

const rawMessageText = `GOLD SURE SIGNALS
GET READY FOR SECOND GOLD SIGNAL
GOLD BUY NOW  4083__4079
LIMITES

1 TARGET 4087
2 TARGET 4091
3 TARGET 4095
4 TARGET 4099
5 TARGET OPEN

STOP LOSS 4072`;

console.log('====================================================');
console.log('  Testing Signal Parser on Screenshot Text         ');
console.log('====================================================\n');

const rawMessage = {
  text: rawMessageText,
  channel: 'GOLDSURESIGNALS',
  channelTitle: 'GOLD SURE SIGNALS',
  messageId: 99999,
};

const parsedResult = parseSignalMessage(rawMessage, 'NEW_SIGNAL');

console.log('Parser Output Result:');
console.log(JSON.stringify(parsedResult, null, 2));
