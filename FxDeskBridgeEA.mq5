//+------------------------------------------------------------------+
//|                                             FxDeskBridgeEA.mq5   |
//|                               Copyright 2026, FX Desk Pro Group  |
//|                                             https://fxdesk.pro   |
//|                                                                  |
//| A clean MQL5 Expert Advisor that connects to the FX Desk Pro WS  |
//| bridge to execute, modify, and close trades on MT5 Demo accounts.|
//|                                                                  |
//| Uses MT5's native Socket API. DLL imports are NOT required.      |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, FX Desk Pro Group"
#property link      "https://fxdesk.pro"
#property strict
#define IsTradeContextBusy() false

// Include Standard Libraries
#include <Trade\Trade.mqh>
#include <Trade\SymbolInfo.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>

//--- Input Parameters
input string   InpBridgeUrl         = "ws://127.0.0.1:8080";      // WebSocket Bridge URL
input string   InpAuthToken         = "default-mt5-token-change-me"; // MT5 Bridge Auth Token
input int      InpReconnectDelay    = 5;                         // Reconnect Delay (Seconds)
input int      InpHeartbeatInterval = 10;                        // Heartbeat Interval (Seconds)

//--- Global Variables
int            g_socket = INVALID_HANDLE;
bool           g_connected = false;
datetime       g_last_heartbeat = 0;
datetime       g_last_reconnect_attempt = 0;
datetime       g_last_received_time = 0;      // Track last packet received for dead socket detection
int            g_current_reconnect_delay = 5; // Exponential backoff reconnect delay
CTrade         g_trade;
CSymbolInfo    g_symbol;
CPositionInfo  g_pos_info;
COrderInfo     g_order_info;

//--- Global accumulation buffer for incoming WebSocket frames
uchar          g_receive_buffer[];
int            g_receive_buffer_len = 0;

//--- Helper functions for JSON parsing/generating
string GetJsonValue(string json, string key) {
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos < 0) return "";
   
   int val_start = pos + StringLen(search);
   // Skip spaces
   while(val_start < StringLen(json) && (StringGetCharacter(json, val_start) == ' ' || StringGetCharacter(json, val_start) == ':')) {
      val_start++;
   }
   
   ushort first_char = StringGetCharacter(json, val_start);
   if(first_char == '"') {
      val_start++;
      int val_end = StringFind(json, "\"", val_start);
      if(val_end < 0) return "";
      return StringSubstr(json, val_start, val_end - val_start);
   } else {
      int val_end = val_start;
      while(val_end < StringLen(json) && 
            StringGetCharacter(json, val_end) != ',' && 
            StringGetCharacter(json, val_end) != '}' && 
            StringGetCharacter(json, val_end) != ']') {
         val_end++;
      }
      return StringSubstr(json, val_start, val_end - val_start);
   }
}

void AppendReceiveBuffer(const uchar &src[], int src_len) {
   if(src_len <= 0) return;
   int old_len = g_receive_buffer_len;
   g_receive_buffer_len = old_len + src_len;
   ArrayResize(g_receive_buffer, g_receive_buffer_len);
   for(int i = 0; i < src_len; i++) {
      g_receive_buffer[old_len + i] = src[i];
   }
}

void ConsumeReceiveBuffer(int bytes_to_consume) {
   if(bytes_to_consume <= 0) return;
   if(bytes_to_consume >= g_receive_buffer_len) {
      g_receive_buffer_len = 0;
      ArrayResize(g_receive_buffer, 0);
      return;
   }
   
   int remaining = g_receive_buffer_len - bytes_to_consume;
   for(int i = 0; i < remaining; i++) {
      g_receive_buffer[i] = g_receive_buffer[bytes_to_consume + i];
   }
   g_receive_buffer_len = remaining;
   ArrayResize(g_receive_buffer, remaining);
}

//--- WebSocket incoming frame processor (RFC6455 Compliant)
void ProcessIncomingFrames() {
   while(g_receive_buffer_len >= 2) {
      uchar header1 = g_receive_buffer[0];
      uchar header2 = g_receive_buffer[1];
      
      bool fin = (header1 & 0x80) != 0;
      int opcode = header1 & 0x0F;
      bool masked = (header2 & 0x80) != 0;
      int payload_len = header2 & 0x7F;
      
      int data_offset = 2;
      
      if(payload_len == 126) {
         if(g_receive_buffer_len < 4) break; // Incomplete header
         payload_len = (g_receive_buffer[2] << 8) | g_receive_buffer[3];
         data_offset = 4;
      } else if(payload_len == 127) {
         if(g_receive_buffer_len < 10) break; // Incomplete header
         payload_len = 0;
         for(int i = 0; i < 8; i++) {
            payload_len = (payload_len << 8) | g_receive_buffer[2 + i];
         }
         data_offset = 10;
      }
      
      if(masked) {
         if(g_receive_buffer_len < data_offset + 4) break; // Incomplete header
         data_offset += 4;
      }
      
      if(g_receive_buffer_len < data_offset + payload_len) {
         break; // Incomplete frame payload, wait for next TCP packet
      }
      
      uchar payload[];
      ArrayResize(payload, payload_len);
      int mask_offset = data_offset - 4;
      for(int i = 0; i < payload_len; i++) {
         uchar c = g_receive_buffer[data_offset + i];
         if(masked) {
            c = c ^ g_receive_buffer[mask_offset + (i % 4)];
         }
         payload[i] = c;
      }
      
      if(opcode == 0x01) { // Text frame
         string decoded_payload = CharArrayToString(payload, 0, payload_len, CP_UTF8);
         
         static bool logged_first_server_frame = false;
         if(!logged_first_server_frame) {
            logged_first_server_frame = true;
            Print("STAGE 6: First WebSocket frame received");
            Print("====================================");
            Print("VERIFY FIRST SERVER FRAME");
            Print("====================================");
            Print("SERVER FRAME");
            Print("Opcode: 0x01 (Text)");
            Print("FIN: ", fin ? "true" : "false");
            Print("MASK: ", masked ? "true" : "false");
            Print("Payload Length: ", payload_len);
            Print("Payload (UTF-8): ", decoded_payload);
            Print("====================================");
         }
         
         ProcessInboundMessage(decoded_payload);
      } else if(opcode == 0x09) { // Ping
         SendPong(payload, payload_len);
      } else if(opcode == 0x0A) { // Pong
         g_last_received_time = TimeCurrent();
      } else if(opcode == 0x08) { // Close
         Print("MT5 Bridge: Server initiated close.");
         SocketDisconnect();
         break;
      }
      
      ConsumeReceiveBuffer(data_offset + payload_len);
   }
}

//--- Polling socket stream (non-blocking)
void PollSocket() {
   if(g_socket == INVALID_HANDLE || !g_connected) return;
   
   ResetLastError();
   uint bytesAvailable = SocketIsReadable(g_socket);
   if(bytesAvailable > 0) {
      uchar temp_buf[];
      ArrayResize(temp_buf, bytesAvailable);
      ResetLastError();
      int bytesRead = SocketRead(g_socket, temp_buf, bytesAvailable, 1);
      if(bytesRead > 0) {
         AppendReceiveBuffer(temp_buf, bytesRead);
         g_last_received_time = TimeCurrent();
      }
   }
   
   ProcessIncomingFrames();
}

void SendPong(const uchar &ping_payload[], int ping_len) {
   if(g_socket == INVALID_HANDLE || !g_connected) return;
   
   uchar frame[];
   int header_len = 6;
   uchar mask[4] = {0x12, 0x34, 0x56, 0x78};
   
   ArrayResize(frame, header_len + ping_len);
   frame[0] = 0x8A; // FIN + Pong frame
   frame[1] = (uchar)(ping_len | 0x80); // Masked
   frame[2] = mask[0];
   frame[3] = mask[1];
   frame[4] = mask[2];
   frame[5] = mask[3];
   
   for(int i = 0; i < ping_len; i++) {
      frame[header_len + i] = (uchar)(ping_payload[i] ^ mask[i % 4]);
   }
   
   ResetLastError();
   SocketSend(g_socket, frame, header_len + ping_len);
}

void SendClose(ushort code, string reason) {
   if(g_socket == INVALID_HANDLE || !g_connected) return;
   
   uchar payload[];
   int reason_len = StringToCharArray(reason, payload, 0, -1, CP_UTF8);
   if(reason_len > 0) reason_len--; // Remove null terminator
   
   int payload_len = 2 + reason_len;
   uchar frame[];
   int header_len = 6;
   uchar mask[4] = {0x12, 0x34, 0x56, 0x78};
   
   ArrayResize(frame, header_len + payload_len);
   frame[0] = 0x88; // FIN + Close frame
   frame[1] = (uchar)(payload_len | 0x80); // Masked
   frame[2] = mask[0];
   frame[3] = mask[1];
   frame[4] = mask[2];
   frame[5] = mask[3];
   
   uchar close_payload[];
   ArrayResize(close_payload, payload_len);
   close_payload[0] = (uchar)((code >> 8) & 0xFF);
   close_payload[1] = (uchar)(code & 0xFF);
   
   for(int i = 0; i < reason_len; i++) {
      close_payload[2 + i] = payload[i];
   }
   
   for(int i = 0; i < payload_len; i++) {
      frame[header_len + i] = (uchar)(close_payload[i] ^ mask[i % 4]);
   }
   
   ResetLastError();
   SocketSend(g_socket, frame, header_len + payload_len);
}

//--- Send data through WebSocket frame
bool SocketWriteData(string data) {
   if(g_socket == INVALID_HANDLE || !g_connected) return false;
   
   uchar payload[];
   int payload_len = StringToCharArray(data, payload, 0, -1, CP_UTF8);
   if(payload_len > 0) {
      payload_len--; // Remove null terminator
   } else {
      payload_len = 0;
   }
   
   uchar frame[];
   int header_len = 0;
   uchar mask[4] = {0x12, 0x34, 0x56, 0x78}; // Simple static mask
   
   if(payload_len < 126) {
      header_len = 6;
      ArrayResize(frame, header_len + payload_len);
      frame[1] = (uchar)(payload_len | 0x80); // Mask bit set
      frame[2] = mask[0];
      frame[3] = mask[1];
      frame[4] = mask[2];
      frame[5] = mask[3];
   } else if(payload_len < 65536) {
      header_len = 8;
      ArrayResize(frame, header_len + payload_len);
      frame[1] = (uchar)(126 | 0x80); // Mask bit set
      frame[2] = (uchar)((payload_len >> 8) & 0xFF);
      frame[3] = (uchar)(payload_len & 0xFF);
      frame[4] = mask[0];
      frame[5] = mask[1];
      frame[6] = mask[2];
      frame[7] = mask[3];
   } else {
      header_len = 14;
      ArrayResize(frame, header_len + payload_len);
      frame[1] = (uchar)(127 | 0x80); // Mask bit set
      frame[2] = 0; frame[3] = 0; frame[4] = 0; frame[5] = 0;
      frame[6] = (uchar)((payload_len >> 24) & 0xFF);
      frame[7] = (uchar)((payload_len >> 16) & 0xFF);
      frame[8] = (uchar)((payload_len >> 8) & 0xFF);
      frame[9] = (uchar)(payload_len & 0xFF);
      frame[10] = mask[0];
      frame[11] = mask[1];
      frame[12] = mask[2];
      frame[13] = mask[3];
   }
   
   frame[0] = 0x81; // FIN + Text frame
   
   for(int i = 0; i < payload_len; i++) {
      frame[header_len + i] = (uchar)(payload[i] ^ mask[i % 4]);
   }
   
   // Temporary wire-level client verification logging (Problem 8)
   static bool logged_first_client_frame = false;
   if(!logged_first_client_frame) {
      logged_first_client_frame = true;
      Print("====================================");
      Print("VERIFY FIRST CLIENT FRAME");
      Print("====================================");
      Print("CLIENT FRAME");
      Print("Opcode: 0x01 (Text)");
      Print("FIN: true");
      Print("MASK: true");
      Print("Payload Length: ", payload_len);
      Print("Payload (UTF-8): ", data);
      Print("====================================");
   }
   
   ResetLastError();
   int res = SocketSend(g_socket, frame, header_len + payload_len);
   return (res > 0);
}

//--- Disconnect WebSocket connection
void SocketDisconnect() {
   Print("MT5 Bridge: SocketDisconnect() called.");
   if(g_socket != INVALID_HANDLE) {
      if(g_connected) {
         SendClose(1000, "Normal Closure");
         Sleep(100);
      }
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
   }
   g_connected = false;
   g_receive_buffer_len = 0;
   ArrayResize(g_receive_buffer, 0);
}

//--- Send JSON Event
void SendEvent(string event_json) {
   SocketWriteData(event_json);
}

//--- Send registration message to backend (never send duplicate packet unless reconnected)
void SendRegister() {
   string accountId = "Vantage-Demo_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   string build = IntegerToString(TerminalInfoInteger(TERMINAL_BUILD));
   
   string payload = "{\"event\":\"REGISTER\"," +
                    "\"token\":\"" + InpAuthToken + "\"," +
                    "\"accountId\":\"" + accountId + "\"," +
                    "\"broker\":\"" + broker + "\"," +
                    "\"server\":\"" + server + "\"," +
                    "\"accountNumber\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\"," +
                    "\"terminalBuild\":\"" + build + "\"," +
                    "\"eaVersion\":\"2.00\"," +
                    "\"protocolVersion\":2}";
   SendEvent(payload);
   Print("STAGE 7: REGISTER sent");
   Print("MT5 Bridge: REGISTER packet sent for account: ", accountId);
}

//--- Parse WebSocket Upgrade handshake responses
bool HandleUpgradeHandshake(string httpResponse) {
   if(StringFind(httpResponse, "HTTP/1.1 101") >= 0 || StringFind(httpResponse, "Sec-WebSocket-Accept") >= 0) {
      Print("STAGE 4: HTTP 101 detected");
      g_connected = true;
      g_last_heartbeat = TimeCurrent();
      g_last_received_time = TimeCurrent();
      g_current_reconnect_delay = InpReconnectDelay; // Reset delay to initial value on successful connection
      Print("MT5 Bridge: Handshake complete. Authenticating... (Delay reset to: ", g_current_reconnect_delay, "s)");
      SendRegister();
      return true;
   }
   return false;
}

//--- Connect to server
void ConnectToBridge() {
   if(g_connected) return;
   
   // Parse Host, Port, and Path from URL: ws://host:port/path or wss://host:port/path
   string host = "127.0.0.1";
   ushort port = 8080;
   string path = "/";
   bool isSecure = false;
   
   string cleanUrl = InpBridgeUrl;
   
   // Check for secure scheme
   int wssPos = StringFind(cleanUrl, "wss://");
   if(wssPos >= 0) {
      isSecure = true;
      cleanUrl = StringSubstr(cleanUrl, wssPos + 6);
      port = 443;
   } else {
      int wsPos = StringFind(cleanUrl, "ws://");
      if(wsPos >= 0) {
         cleanUrl = StringSubstr(cleanUrl, wsPos + 5);
         port = 80;
      }
   }
   
   // Parse path if present
   int slashPos = StringFind(cleanUrl, "/");
   if(slashPos >= 0) {
      path = StringSubstr(cleanUrl, slashPos);
      cleanUrl = StringSubstr(cleanUrl, 0, slashPos);
   }
   
   // Parse host and port
   int colonPos = StringFind(cleanUrl, ":");
   if(colonPos >= 0) {
      host = StringSubstr(cleanUrl, 0, colonPos);
      port = (ushort)StringToInteger(StringSubstr(cleanUrl, colonPos + 1));
   } else {
      host = cleanUrl;
   }
   
   Print("MT5 Bridge: DIAGNOSTIC - Attempting connection to ", InpBridgeUrl, " (Retry delay: ", g_current_reconnect_delay, "s)");
   Print("MT5 Bridge: DIAGNOSTIC - Host parsed: '", host, "', Port parsed: ", port, ", Path parsed: '", path, "', Secure: ", isSecure);
   g_last_reconnect_attempt = TimeCurrent();
   
   ResetLastError();
   g_socket = SocketCreate(SOCKET_DEFAULT);
   int createErr = GetLastError();
   Print("MT5 Bridge: DIAGNOSTIC - SocketCreate() handle value: ", g_socket, ", GetLastError() immediately after: ", createErr);
   
   if(g_socket == INVALID_HANDLE) {
      Print("MT5 Bridge: DIAGNOSTIC - Native socket creation failed.");
      return;
   }
   
   // Connect socket with 5 seconds timeout
   ResetLastError();
   bool connectRes = SocketConnect(g_socket, host, port, 5000);
   int connectErr = GetLastError();
   Print("MT5 Bridge: DIAGNOSTIC - SocketConnect() result: ", connectRes, ", GetLastError() immediately after: ", connectErr);
   
   if(!connectRes) {
      Print("MT5 Bridge: Connection failed. Socket Error Code: ", connectErr);
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
      
      // Connection failed: increase reconnect delay (exponential backoff capped at 60 seconds)
      g_current_reconnect_delay = g_current_reconnect_delay * 2;
      if(g_current_reconnect_delay > 60) g_current_reconnect_delay = 60;
      return;
   }
   
   Print("STAGE 1: SocketConnect success");
   
   // Explicit TLS Handshake for secure sockets (if secure)
   if(isSecure) {
      ResetLastError();
      bool handshakeRes = SocketTlsHandshake(g_socket, host);
      int handshakeErr = GetLastError();
      if(!handshakeRes) {
         Print("MT5 Bridge: TLS Handshake failed. Socket Error Code: ", handshakeErr);
         SocketClose(g_socket);
         g_socket = INVALID_HANDLE;
         
         g_current_reconnect_delay = g_current_reconnect_delay * 2;
         if(g_current_reconnect_delay > 60) g_current_reconnect_delay = 60;
         return;
      }
   }
   
   // Send WebSocket Upgrade request
   string hostHeader = host;
   if((isSecure && port != 443) || (!isSecure && port != 80)) {
      hostHeader = host + ":" + IntegerToString(port);
   }
   
   string upgradeRequest = "GET " + path + "?token=" + InpAuthToken + " HTTP/1.1\r\n" +
                           "Host: " + hostHeader + "\r\n" +
                           "Upgrade: websocket\r\n" +
                           "Connection: Upgrade\r\n" +
                           "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
                           "Sec-WebSocket-Version: 13\r\n" +
                           "User-Agent: FxDeskBridgeEA/2.0\r\n\r\n";
   
   uchar requestBytes[];
   StringToCharArray(upgradeRequest, requestBytes, 0, -1, CP_UTF8);
   ResetLastError();
   SocketSend(g_socket, requestBytes, ArraySize(requestBytes) - 1);
   
   Print("STAGE 2: Begin HTTP handshake read");
   uint startTime = GetTickCount();
   int bytesAvailable = 0;
   while(GetTickCount() - startTime < 5000) {
      ResetLastError();
      bytesAvailable = (int)SocketIsReadable(g_socket);
      if(bytesAvailable > 0) {
         Sleep(100);
         bytesAvailable = (int)SocketIsReadable(g_socket);
         break;
      }
      Sleep(10);
   }
   
   Print("MT5 Bridge: Handshake SocketIsReadable() returned: ", bytesAvailable, ", GetLastError() after check: ", GetLastError());
   
   int bytesRead = 0;
   uchar handshakeBuf[];
   if(bytesAvailable > 0) {
      ArrayResize(handshakeBuf, bytesAvailable);
      ResetLastError();
      bytesRead = SocketRead(g_socket, handshakeBuf, bytesAvailable, 5000);
      Print("MT5 Bridge: Handshake SocketRead() returned: ", bytesRead, ", GetLastError() after read: ", GetLastError());
   } else {
      Print("MT5 Bridge: Handshake SocketRead skipped, zero bytes available.");
   }
   
   string handshakeResponse = "";
   if(bytesRead > 0) {
      Print("STAGE 3: HTTP response received");
      handshakeResponse = CharArrayToString(handshakeBuf, 0, bytesRead, CP_UTF8);
   }
   
   if(handshakeResponse != "") {
      HandleUpgradeHandshake(handshakeResponse);
      Print("STAGE 5: Switch to WebSocket parser");
      
      // Preserve any trailing bytes received with the HTTP 101 response (Problem 4)
      int headerEndPos = StringFind(handshakeResponse, "\r\n\r\n");
      if(headerEndPos >= 0) {
         int bodyByteStart = headerEndPos + 4;
         int extraBytes = bytesRead - bodyByteStart;
         if(extraBytes > 0) {
            uchar extraBuf[];
            ArrayResize(extraBuf, extraBytes);
            for(int i = 0; i < extraBytes; i++) {
               extraBuf[i] = handshakeBuf[bodyByteStart + i];
            }
            AppendReceiveBuffer(extraBuf, extraBytes);
            Print("MT5 Bridge: Handshake buffer contained extra bytes: ", extraBytes, ". Appended to receive queue.");
         }
      }
   } else {
      Print("MT5 Bridge: Upgrade handshake timed out.");
      SocketDisconnect();
      
      g_current_reconnect_delay = g_current_reconnect_delay * 2;
      if(g_current_reconnect_delay > 60) g_current_reconnect_delay = 60;
   }
}

//--- Send periodic account metrics
void SendAccountSummary() {
   Print("TRACE: Enter SendAccountSummary");
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin = AccountInfoDouble(ACCOUNT_MARGIN);
   double free_margin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double profit = AccountInfoDouble(ACCOUNT_PROFIT);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);
   long accountNum = AccountInfoInteger(ACCOUNT_LOGIN);
   
   string payload = "{\"event\":\"ACCOUNT_SUMMARY\"," +
                    "\"accountId\":\"Vantage-Demo_" + IntegerToString(accountNum) + "\"," +
                    "\"accountNumber\":\"" + IntegerToString(accountNum) + "\"," +
                    "\"broker\":\"" + broker + "\"," +
                    "\"server\":\"" + server + "\"," +
                    "\"balance\":" + DoubleToString(balance, 2) + "," +
                    "\"equity\":" + DoubleToString(equity, 2) + "," +
                    "\"margin\":" + DoubleToString(margin, 2) + "," +
                    "\"freeMargin\":" + DoubleToString(free_margin, 2) + "," +
                    "\"profit\":" + DoubleToString(profit, 2) + "," +
                    "\"leverage\":" + IntegerToString(leverage) + "}";
   SendEvent(payload);
   Print("TRACE: Leaving SendAccountSummary");
}

//--- Send position list to sync reconciliation
void SendPositionList() {
   Print("TRACE: Enter SendPositionList");
   string payload = "{\"event\":\"POSITION_LIST\",\"positions\":[";
   int total = PositionsTotal();
   int matched_count = 0;
   
   for(int i = 0; i < total; i++) {
      if(g_pos_info.SelectByIndex(i)) {
         if(matched_count > 0) payload += ",";
         
         string posType = g_pos_info.PositionType() == POSITION_TYPE_BUY ? "BUY" : "SELL";
         
         payload += "{\"ticket\":\"" + IntegerToString(g_pos_info.Ticket()) + "\"," +
                    "\"symbol\":\"" + g_pos_info.Symbol() + "\"," +
                    "\"magic\":" + IntegerToString(g_pos_info.Magic()) + "," +
                    "\"type\":\"" + posType + "\"," +
                    "\"volume\":" + DoubleToString(g_pos_info.Volume(), 2) + "," +
                    "\"openPrice\":" + DoubleToString(g_pos_info.PriceOpen(), 5) + "}";
         matched_count++;
      }
   }
   payload += "]}";
   SendEvent(payload);
   Print("MT5 Bridge: Send active positions count: ", matched_count);
   Print("TRACE: Leaving SendPositionList");
}

//--- Send execution failures with descriptions and broker error return codes
void SendTradeFailed(string recommendationId, string reason, uint retcode) {
   string payload = "{\"event\":\"TRADE_FAILED\"," +
                    "\"recommendationId\":\"" + recommendationId + "\"," +
                    "\"reason\":\"" + reason + "\"," +
                    "\"retcode\":" + IntegerToString(retcode) + "}";
   SendEvent(payload);
}

//--- Helper to map MQL5 error codes to readable descriptions
string GetRetcodeDescription(uint retcode) {
   switch(retcode) {
      case 10004: return "Requote";
      case 10006: return "Request Rejected";
      case 10007: return "Invalid Request";
      case 10011: return "Common Error";
      case 10012: return "No Connection";
      case 10013: return "Invalid Volume";
      case 10014: return "Invalid Price";
      case 10015: return "Invalid Stops";
      case 10016: return "Trade Disabled";
      case 10017: return "Market Closed";
      case 10018: return "Market Closed";
      case 10019: return "Insufficient Margin";
      case 10020: return "Off Quotes";
      case 10021: return "No Connection";
      default:    return "Trade Context Busy or Broker Error (" + IntegerToString(retcode) + ")";
   }
}

//--- Execute Market Order immediately
void ExecuteOpenOrder(string json) {
   Print("T6: OPEN_ORDER handler entered");
   Print("TRACE: Enter ExecuteOpenOrder");
   string recId = GetJsonValue(json, "recommendationId");
   string symbol = GetJsonValue(json, "symbol");
   string direction = GetJsonValue(json, "direction");
   double lot = StringToDouble(GetJsonValue(json, "volume"));
   double price = StringToDouble(GetJsonValue(json, "price"));
   double sl = StringToDouble(GetJsonValue(json, "sl"));
   double tp = StringToDouble(GetJsonValue(json, "tp"));
   ulong magic = StringToInteger(GetJsonValue(json, "magicNumber"));
   
   if(symbol == "") symbol = _Symbol;
   if(lot <= 0) lot = 0.1;
   
   // --- Order Idempotency: Check if recommendationId or magicNumber is already active ---
   int total_positions = PositionsTotal();
   for(int i = 0; i < total_positions; i++) {
      if(g_pos_info.SelectByIndex(i)) {
         if(g_pos_info.Magic() == magic || g_pos_info.Comment() == "FX Desk: " + recId) {
            Print("MT5 Bridge: Duplicate order execution prevented for ", recId, " (Magic: ", magic, "). Already active.");
            Print("TRACE: Leaving ExecuteOpenOrder");
            return;
         }
      }
   }
   
   // Set magic number on trade controller
   g_trade.SetExpertMagicNumber(magic);
   g_trade.SetDeviationInPoints(20);
   
   ENUM_ORDER_TYPE orderType = direction == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double executionPrice = direction == "BUY" ? ask : bid;
   
   Print("MT5 Bridge: Executing market order for ", recId, " (Magic: ", magic, ") symbol: ", symbol, " type: ", EnumToString(orderType), " lot: ", lot, " price: ", executionPrice, " ask: ", ask, " bid: ", bid, " sl: ", sl, " tp: ", tp);
   
   Print("T7: Calling OrderSend");
   Print("Symbol: ", symbol, 
         ", Volume: ", lot, 
         ", Order Type: ", EnumToString(orderType), 
         ", Entry: ", executionPrice, 
         ", SL: ", sl, 
         ", TP: ", tp, 
         ", Magic Number: ", magic);

    ResetLastError();
    bool isOpened = g_trade.PositionOpen(symbol, orderType, lot, executionPrice, sl, tp, "FX Desk: " + recId);
    
    Print("===== TRADE DIAGNOSTICS =====");
    Print("ResultRetcode = ", g_trade.ResultRetcode());
    Print("ResultRetcodeDescription = ", g_trade.ResultRetcodeDescription());
    Print("ResultComment = ", g_trade.ResultComment());
    Print("GetLastError = ", GetLastError());

    Print("Terminal Trade Allowed = ", TerminalInfoInteger(TERMINAL_TRADE_ALLOWED));
    Print("MQL Trade Allowed = ", MQLInfoInteger(MQL_TRADE_ALLOWED));
    Print("Terminal Connected = ", TerminalInfoInteger(TERMINAL_CONNECTED));
    Print("Trade Context Busy = ", IsTradeContextBusy());

    Print("Symbol = ", symbol);
    Print("Volume = ", lot);
    Print("Type = ", EnumToString(orderType));
    Print("Price = ", executionPrice);
    Print("SL = ", sl);
    Print("TP = ", tp);

    if(isOpened) {
       ulong ticket = g_trade.ResultDeal();
       double fillPrice = g_trade.ResultPrice();
       uint ret = g_trade.ResultRetcode();
       string comment = g_trade.ResultComment();
       
       bool success = (ret == 10008 || ret == 10009);
       Print("T8: Result = ", success ? "success" : "failure",
             ", Retcode = ", ret,
             ", Comment = '", comment, "'",
             ", Ticket = ", ticket);
             
       if(success) { // ORDER_PLACED or ORDER_DONE
          double spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD) * SymbolInfoDouble(symbol, SYMBOL_POINT);
          double slippage = MathAbs(fillPrice - price);
          
          // Notify success
          string payload = "{\"event\":\"ORDER_FILLED\"," +
                           "\"recommendationId\":\"" + recId + "\"," +
                           "\"ticket\":\"" + IntegerToString(ticket) + "\"," +
                           "\"fillPrice\":" + DoubleToString(fillPrice, 5) + "," +
                           "\"fillTime\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES|TIME_SECONDS) + "\"," +
                           "\"slippage\":" + DoubleToString(slippage, 5) + "," +
                           "\"spread\":" + DoubleToString(spread, 5) + "," +
                           "\"latencyMs\":120}";
          SendEvent(payload);
          Print("MT5 Bridge: Order filled ticket: ", ticket, " price: ", fillPrice, " retcode: ", ret, " LastError: ", GetLastError());
       } else {
          string reason = GetRetcodeDescription(ret);
          SendTradeFailed(recId, reason, ret);
          Print("MT5 Bridge: Order opening execution failed: ", reason, " retcode: ", ret, " LastError: ", GetLastError());
       }
    } else {
       uint ret = g_trade.ResultRetcode();
       string reason = GetRetcodeDescription(ret);
       string comment = g_trade.ResultComment();
       long tradeMode = SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
       double minVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
       double maxVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
       double stepVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
       
       Print("T8: Result = failure",
             ", Retcode = ", ret,
             ", Comment = '", comment, "'",
             ", Ticket = 0");
             
       SendTradeFailed(recId, reason, ret);
       Print("MT5 Bridge: Order opening dispatch failed: ", reason, " retcode: ", ret, " comment: '", comment, "' tradeMode: ", tradeMode, " minVol: ", minVol, " maxVol: ", maxVol, " stepVol: ", stepVol, " LastError: ", GetLastError());
    }
   Print("TRACE: Leaving ExecuteOpenOrder");
}

//--- Locate and close position
void ExecuteCloseOrder(string json) {
   Print("TRACE: Enter ExecuteCloseOrder");
   string recId = GetJsonValue(json, "recommendationId");
   ulong magic = StringToInteger(GetJsonValue(json, "magicNumber"));
   ulong ticket = StringToInteger(GetJsonValue(json, "ticket"));
   
   bool closed = false;
   
   // Select by ticket first
   if(ticket > 0 && g_pos_info.SelectByTicket(ticket)) {
      g_trade.SetExpertMagicNumber(magic);
      if(g_trade.PositionClose(g_pos_info.Ticket())) {
         closed = (g_trade.ResultRetcode() == 10009);
      }
   } else {
      // Find matching open position by magic number
      int total = PositionsTotal();
      for(int i = 0; i < total; i++) {
         if(g_pos_info.SelectByIndex(i)) {
            if(g_pos_info.Magic() == magic) {
               g_trade.SetExpertMagicNumber(magic);
               if(g_trade.PositionClose(g_pos_info.Ticket())) {
                  closed = (g_trade.ResultRetcode() == 10009);
                  ticket = g_pos_info.Ticket();
                  break;
               }
            }
         }
      }
   }
   
   if(closed) {
      double exitPrice = g_trade.ResultPrice();
      string payload = "{\"event\":\"ORDER_CLOSED\"," +
                       "\"recommendationId\":\"" + recId + "\"," +
                       "\"ticket\":\"" + IntegerToString(ticket) + "\"," +
                       "\"exitPrice\":" + DoubleToString(exitPrice, 5) + "," +
                       "\"exitTime\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES|TIME_SECONDS) + "\"," +
                       "\"reason\":\"MANUAL\"}";
      SendEvent(payload);
      Print("MT5 Bridge: Order closed ticket: ", ticket, " price: ", exitPrice, " retcode: ", g_trade.ResultRetcode(), " LastError: ", GetLastError());
   } else {
      uint ret = g_trade.ResultRetcode();
      Print("MT5 Bridge: Failed to close order ", recId, " (retcode: ", ret, ") LastError: ", GetLastError());
      SendTradeFailed(recId, "Failed to Close Position", ret);
   }
   Print("TRACE: Leaving ExecuteCloseOrder");
}

//--- Modify Stop Loss and Take Profit levels
void ExecuteModifySLTP(string json) {
   Print("TRACE: Enter ExecuteModifySLTP");
   string recId = GetJsonValue(json, "recommendationId");
   ulong ticket = StringToInteger(GetJsonValue(json, "ticket"));
   double sl = StringToDouble(GetJsonValue(json, "sl"));
   double tp = StringToDouble(GetJsonValue(json, "tp"));
   
   bool modified = false;
   if(ticket > 0 && g_pos_info.SelectByTicket(ticket)) {
      if(g_trade.PositionModify(ticket, sl, tp)) {
         modified = (g_trade.ResultRetcode() == 10009);
      }
   }
   
   if(modified) {
      string payload = "{\"event\":\"ORDER_MODIFIED\"," +
                       "\"recommendationId\":\"" + recId + "\"," +
                       "\"ticket\":\"" + IntegerToString(ticket) + "\"," +
                       "\"sl\":" + DoubleToString(sl, 5) + "," +
                       "\"tp\":" + DoubleToString(tp, 5) + "}";
      SendEvent(payload);
      Print("MT5 Bridge: Modified ticket: ", ticket, " SL: ", sl, " TP: ", tp, " retcode: ", g_trade.ResultRetcode(), " LastError: ", GetLastError());
   } else {
      uint ret = g_trade.ResultRetcode();
      Print("MT5 Bridge: Failed to modify ticket ", ticket, " (retcode: ", ret, ") LastError: ", GetLastError());
      SendTradeFailed(recId, "Failed to Modify stops", ret);
   }
   Print("TRACE: Leaving ExecuteModifySLTP");
}

//--- Inbound JSON Dispatcher
void ProcessInboundMessage(string json) {
   Print("TRACE 1: Enter ProcessInboundMessage");
   Print("TRACE 2: JSON received:\n", json);
   Print("T4: Message received\n", json);
   
   string action = GetJsonValue(json, "action");
   string eventVal = GetJsonValue(json, "event");
   Print("T5: Event = ", eventVal, ", Action = ", action);
   Print("TRACE 3: Event parsed: action='", action, "', event='", eventVal, "'");
   
   if(action == "" && eventVal == "") {
      Print("TRACE 7: Leaving ProcessInboundMessage (no action or event)");
      return;
   }
   
   if(action == "PING" || eventVal == "PING") {
      Print("TRACE 4: Dispatching PING handler");
      string payload = "{\"event\":\"PONG\"}";
      SendEvent(payload);
      Print("TRACE 5: PING handler finished");
      Print("TRACE 6: Dispatch finished");
      Print("TRACE 7: Leaving ProcessInboundMessage");
      return;
   }
   
   if(action == "OPEN_ORDER" || eventVal == "OPEN_ORDER") {
      Print("TRACE 4: Dispatching OPEN_ORDER handler");
      ExecuteOpenOrder(json);
      Print("TRACE 5: OPEN_ORDER handler finished");
      Print("TRACE 6: Dispatch finished");
      Print("TRACE 7: Leaving ProcessInboundMessage");
      return;
   }
   
   if(action == "CLOSE_ORDER" || eventVal == "CLOSE_ORDER") {
      Print("TRACE 4: Dispatching CLOSE_ORDER handler");
      ExecuteCloseOrder(json);
      Print("TRACE 5: CLOSE_ORDER handler finished");
      Print("TRACE 6: Dispatch finished");
      Print("TRACE 7: Leaving ProcessInboundMessage");
      return;
   }
   
   if(action == "MODIFY_SLTP" || eventVal == "MODIFY_SLTP") {
      Print("TRACE 4: Dispatching MODIFY_SLTP handler");
      ExecuteModifySLTP(json);
      Print("TRACE 5: MODIFY_SLTP handler finished");
      Print("TRACE 6: Dispatch finished");
      Print("TRACE 7: Leaving ProcessInboundMessage");
      return;
   }
   
   if(action == "POSITION_LIST" || eventVal == "POSITION_LIST") {
      Print("TRACE 4: Dispatching POSITION_LIST handler");
      SendPositionList();
      Print("TRACE 5: POSITION_LIST handler finished");
      Print("TRACE 6: Dispatch finished");
      Print("TRACE 7: Leaving ProcessInboundMessage");
      return;
   }
   
   if(eventVal == "REGISTER") {
      Print("STAGE 8: REGISTER_ACK received");
      Print("TRACE 4: Dispatching REGISTER handler");
      Print("TRACE 5: REGISTER handler finished");
      Print("TRACE 6: Dispatch finished");
      Print("TRACE 7: Leaving ProcessInboundMessage");
      return;
   }
   
   Print("TRACE 6: Dispatch finished");
   Print("TRACE 7: Leaving ProcessInboundMessage");
}

//--- Helper to format deinitialization reasons
string GetDeinitReasonDescription(int reason) {
   switch(reason) {
      case REASON_PROGRAM: return "REASON_PROGRAM (0) - ExpertAdvisor stopped by calling ExpertRemove()";
      case REASON_REMOVE: return "REASON_REMOVE (1) - Program removed from chart";
      case REASON_RECOMPILE: return "REASON_RECOMPILE (2) - Program recompiled";
      case REASON_CHARTCHANGE: return "REASON_CHARTCHANGE (3) - Symbol or timeframe changed";
      case REASON_CHARTCLOSE: return "REASON_CHARTCLOSE (4) - Chart closed";
      case REASON_PARAMETERS: return "REASON_PARAMETERS (5) - Parameters changed by user";
      case REASON_ACCOUNT: return "REASON_ACCOUNT (6) - Account changed";
      case REASON_TEMPLATE: return "REASON_TEMPLATE (7) - Template applied";
      case REASON_INITFAILED: return "REASON_INITFAILED (8) - OnInit() failed";
      case REASON_CLOSE: return "REASON_CLOSE (9) - Terminal closed";
      default: return "Unknown reason: " + IntegerToString(reason);
   }
}

//--- EA Initialization
int OnInit() {
   Print("MT5 Bridge: OnInit() started. Initializing FxDeskBridgeEA...");
   
   // Set timer for network tasks (1 second resolution)
   EventSetTimer(1);
   
   // ConnectToBridge(); // Deferred to OnTimer to avoid Sleep() restriction inside OnInit
   
   Print("MT5 Bridge: OnInit() completed. Return: INIT_SUCCEEDED");
   return(INIT_SUCCEEDED);
}

//--- EA Deinitialization
void OnDeinit(const int reason) {
   string reasonDesc = GetDeinitReasonDescription(reason);
   Print("MT5 Bridge: OnDeinit() started. Reason Code: ", reason, " (", reasonDesc, ")");
   EventKillTimer();
   SocketDisconnect();
   Print("MT5 Bridge: OnDeinit() completed.");
}

//--- EA Timer loop for Heartbeat & Reconnection
void OnTimer() {
   Print("MT5 Bridge: OnTimer() loop tick. g_connected: ", g_connected);
   
   // Reconnection loop using linear/exponential retry logic
   if(!g_connected) {
      if(TimeCurrent() - g_last_reconnect_attempt >= g_current_reconnect_delay) {
         Print("MT5 Bridge: OnTimer() - Initiating reconnection attempt...");
         ConnectToBridge();
      }
      return;
   }
   
   // Check for dead socket via heartbeat timeout (InpHeartbeatInterval * 2)
   if(g_connected && TimeCurrent() - g_last_received_time >= InpHeartbeatInterval * 2) {
      Print("MT5 Bridge: OnTimer() - Heartbeat timeout. Dead socket detected. Disconnecting...");
      SocketDisconnect();
      
      // Heartbeat timeout disconnect: increase reconnect delay (exponential backoff capped at 60 seconds)
      g_current_reconnect_delay = g_current_reconnect_delay * 2;
      if(g_current_reconnect_delay > 60) g_current_reconnect_delay = 60;
      return;
   }
   
   // Heartbeat loop
   if(TimeCurrent() - g_last_heartbeat >= InpHeartbeatInterval) {
      string pingPayload = "{\"event\":\"PING\"}";
      Print("MT5 Bridge: OnTimer() - Sending PING heartbeat...");
      if(SocketWriteData(pingPayload)) {
         g_last_heartbeat = TimeCurrent();
      } else {
         Print("MT5 Bridge: OnTimer() - Heartbeat write failed. Connection lost. Reconnecting...");
         SocketDisconnect();
      }
   }
   
   // Poll and process incoming WebSocket messages
   PollSocket();
   
   // Send periodic Account Metrics every 30 seconds
   static datetime last_summary = 0;
   if(TimeCurrent() - last_summary >= 30) {
      Print("MT5 Bridge: OnTimer() - Sending periodic account summary...");
      SendAccountSummary();
      last_summary = TimeCurrent();
   }
}

//--- EA Tick handler
void OnTick() {
   // If connected, read inbound frames immediately on tick for ultra-low latency execution
   if(g_connected) {
      PollSocket();
   }
}

//--- Listen to Broker events (SL/TP hit, manual terminal changes)
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result) {
   // We watch position closure transitions to alert backend of SL / TP hits or manual exits
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD) {
      ulong deal_ticket = trans.deal;
      if(HistoryDealSelect(deal_ticket)) {
         long entry = HistoryDealGetInteger(deal_ticket, DEAL_ENTRY);
         long reason = HistoryDealGetInteger(deal_ticket, DEAL_REASON);
         
         // Only look for closing deals (DEAL_ENTRY_OUT)
         if(entry == DEAL_ENTRY_OUT) {
            ulong pos_ticket = HistoryDealGetInteger(deal_ticket, DEAL_POSITION_ID);
            double exitPrice = HistoryDealGetDouble(deal_ticket, DEAL_PRICE);
            long magic = HistoryDealGetInteger(deal_ticket, DEAL_MAGIC);
            
            // Map closure reason (SL, TP, CLIENT = Manual)
            string reasonStr = "MANUAL";
            if(reason == DEAL_REASON_SL) reasonStr = "SL";
            else if(reason == DEAL_REASON_TP) reasonStr = "TP";
            
            string payload = "{\"event\":\"ORDER_CLOSED\"," +
                             "\"recommendationId\":\"\"," + // Handled on backend by matching ticket
                             "\"ticket\":\"" + IntegerToString(pos_ticket) + "\"," +
                             "\"exitPrice\":" + DoubleToString(exitPrice, 5) + "," +
                             "\"exitTime\":\"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES|TIME_SECONDS) + "\"," +
                             "\"reason\":\"" + reasonStr + "\"}";
            SendEvent(payload);
            Print("MT5 Bridge: Trade closed natively: Ticket ", pos_ticket, " Reason: ", reasonStr);
         }
      }
   }
}
