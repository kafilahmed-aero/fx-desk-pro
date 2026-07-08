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
#property version   "1.00"
#property strict

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

//--- WebSocket framing and parsing helper
string SocketReadData(bool checkConnected = true, int timeout_ms = 1) {
   if(g_socket == INVALID_HANDLE) return "";
   if(checkConnected && !g_connected) return "";
   
   uchar buf[];
   ArrayResize(buf, 4096);
   // Set timeout to prevent UI freeze (acting as non-blocking read)
   ResetLastError();
   int res = SocketRead(g_socket, buf, 4096, timeout_ms);
   int err = GetLastError();
   
   if(!checkConnected) {
      Print("MT5 Bridge: DIAGNOSTIC - Handshake SocketRead returned: ", res, ", GetLastError(): ", err);
      if(res > 0) {
         string hexStr = "";
         for(int i = 0; i < res; i++) {
            hexStr += StringFormat("0x%02X ", buf[i]);
         }
         Print("MT5 Bridge: DIAGNOSTIC - Hex bytes: ", hexStr);
         
         string asciiStr = CharArrayToString(buf, 0, res);
         Print("MT5 Bridge: DIAGNOSTIC - ASCII text: \n", asciiStr);
         
         if(StringFind(asciiStr, "HTTP/1.1 101") == 0) {
            Print("MT5 Bridge: DIAGNOSTIC - Starts with HTTP/1.1 101: YES");
         } else if(buf[0] == 0x81) {
            Print("MT5 Bridge: DIAGNOSTIC - Starts with 0x81: YES");
         } else {
            Print("MT5 Bridge: DIAGNOSTIC - Starts with something else (First byte: ", StringFormat("0x%02X", buf[0]), ")");
         }
      }
   }
   
   if(res <= 0) return "";
   
   // Data successfully read, update last received timestamp
   g_last_received_time = TimeCurrent();
   
   // Check if it's a WebSocket text frame (Opcode 0x81)
   if(buf[0] == 0x81) {
      int payload_len = buf[1] & 0x7F;
      int data_offset = 2;
      
      if(payload_len == 126) {
         payload_len = (buf[2] << 8) | buf[3];
         data_offset = 4;
      } else if(payload_len == 127) {
         data_offset = 10;
      }
      
      // If masked
      bool masked = (buf[1] & 0x80) != 0;
      uchar mask[4];
      if(masked) {
         for(int i=0; i<4; i++) mask[i] = buf[data_offset++];
      }
      
      uchar decoded[];
      ArrayResize(decoded, payload_len);
      for(int i=0; i<payload_len; i++) {
         uchar c = buf[data_offset + i];
         if(masked) c = c ^ mask[i % 4];
         decoded[i] = c;
      }
      return CharArrayToString(decoded, 0, payload_len);
   }
   
   return CharArrayToString(buf, 0, res);
}

//--- Send data through WebSocket frame
bool SocketWriteData(string data) {
   if(g_socket == INVALID_HANDLE || !g_connected) return false;
   
   int len = StringLen(data);
   uchar payload[];
   StringToCharArray(data, payload);
   
   uchar frame[];
   ArrayResize(frame, 6 + len);
   frame[0] = 0x81; // FIN + Text frame
   
   int header_len = 6;
   uchar mask[4] = {0x12, 0x34, 0x56, 0x78}; // Simple static mask
   
   if(len < 126) {
      frame[1] = (uchar)(len | 0x80); // Mask bit set
      frame[2] = mask[0];
      frame[3] = mask[1];
      frame[4] = mask[2];
      frame[5] = mask[3];
   } else {
      header_len = 8;
      ArrayResize(frame, 8 + len);
      frame[1] = (uchar)(126 | 0x80); // Mask bit set
      frame[2] = (uchar)((len >> 8) & 0xFF);
      frame[3] = (uchar)(len & 0xFF);
      frame[4] = mask[0];
      frame[5] = mask[1];
      frame[6] = mask[2];
      frame[7] = mask[3];
   }
   
   // Copy masked payload
   for(int i=0; i<len; i++) {
      frame[header_len + i] = (uchar)(payload[i] ^ mask[i % 4]);
   }
   
   int res = SocketSend(g_socket, frame, header_len + len);
   return (res > 0);
}

//--- Disconnect WebSocket connection
void SocketDisconnect() {
   if(g_socket != INVALID_HANDLE) {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
   }
   g_connected = false;
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
                    "\"eaVersion\":\"1.00\"}";
   SendEvent(payload);
   Print("MT5 Bridge: REGISTER packet sent for account: ", accountId);
}

//--- Parse WebSocket Upgrade handshake responses
bool HandleUpgradeHandshake(string httpResponse) {
   if(StringFind(httpResponse, "HTTP/1.1 101") >= 0 || StringFind(httpResponse, "Sec-WebSocket-Accept") >= 0) {
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
   
   // Parse Host & Port from URL: ws://host:port
   string host = "127.0.0.1";
   ushort port = 8080;
   
   string cleanUrl = InpBridgeUrl;
   int wsPos = StringFind(cleanUrl, "ws://");
   if(wsPos >= 0) {
      cleanUrl = StringSubstr(cleanUrl, wsPos + 5);
   }
   
   int colonPos = StringFind(cleanUrl, ":");
   if(colonPos >= 0) {
      host = StringSubstr(cleanUrl, 0, colonPos);
      port = (ushort)StringToInteger(StringSubstr(cleanUrl, colonPos + 1));
   } else {
      host = cleanUrl;
   }
   
   Print("MT5 Bridge: DIAGNOSTIC - Attempting connection to ", InpBridgeUrl, " (Retry delay: ", g_current_reconnect_delay, "s)");
   Print("MT5 Bridge: DIAGNOSTIC - Host parsed: '", host, "', Port parsed: ", port);
   g_last_reconnect_attempt = TimeCurrent();
   
   ResetLastError();
   g_socket = SocketCreate();
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
   
   // Log readability and writability immediately after connection
   uint isReadable = SocketIsReadable(g_socket);
   bool isWritable = SocketIsWritable(g_socket);
   Print("MT5 Bridge: DIAGNOSTIC - SocketIsReadable() returned bytes: ", isReadable, ", SocketIsWritable() returned: ", isWritable);
   
   // Send WebSocket Upgrade request
   string upgradeRequest = "GET /?token=" + InpAuthToken + " HTTP/1.1\r\n" +
                           "Host: " + host + ":" + IntegerToString(port) + "\r\n" +
                           "Upgrade: websocket\r\n" +
                           "Connection: Upgrade\r\n" +
                           "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
                           "Sec-WebSocket-Version: 13\r\n\r\n";
   
   uchar requestBytes[];
   StringToCharArray(upgradeRequest, requestBytes);
   // Exclude the trailing null byte when sending raw characters
   SocketSend(g_socket, requestBytes, StringLen(upgradeRequest));
   
   // Handshake read polling logic
   uint start_time = GetTickCount();
   uint timeout_limit = 5000;
   uint elapsed = 0;
   uint bytes_avail = 0;
   bool data_ready = false;
   
   while(elapsed < timeout_limit) {
      ResetLastError();
      bytes_avail = SocketIsReadable(g_socket);
      if(bytes_avail > 0) {
         data_ready = true;
         break;
      }
      Sleep(50);
      elapsed = GetTickCount() - start_time;
   }
   
   string handshakeResponse = "";
   if(data_ready) {
      uchar buf[];
      ArrayResize(buf, 4096);
      ResetLastError();
      int res = SocketRead(g_socket, buf, 4096, 5000);
      int err = GetLastError();
      
      if(res > 0) {
         handshakeResponse = CharArrayToString(buf, 0, res);
      }
      
      Print("MT5 Bridge: HANDSHAKE DIAGNOSTIC - Elapsed wait time: ", elapsed, " ms");
      Print("MT5 Bridge: HANDSHAKE DIAGNOSTIC - Bytes reported by SocketIsReadable(): ", bytes_avail);
      Print("MT5 Bridge: HANDSHAKE DIAGNOSTIC - SocketRead() return value: ", res);
      Print("MT5 Bridge: HANDSHAKE DIAGNOSTIC - GetLastError(): ", err);
      Print("MT5 Bridge: HANDSHAKE DIAGNOSTIC - First 200 characters: ", StringSubstr(handshakeResponse, 0, 200));
   } else {
      Print("Handshake timeout: no readable data.");
   }
   
   if(handshakeResponse != "") {
      HandleUpgradeHandshake(handshakeResponse);
   } else {
      Print("MT5 Bridge: Upgrade handshake timed out.");
      SocketDisconnect();
      
      // Handshake failed: increase reconnect delay (exponential backoff capped at 60 seconds)
      g_current_reconnect_delay = g_current_reconnect_delay * 2;
      if(g_current_reconnect_delay > 60) g_current_reconnect_delay = 60;
   }
}

//--- Send periodic account metrics
void SendAccountSummary() {
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
}

//--- Send position list to sync reconciliation
void SendPositionList() {
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
   
   Print("MT5 Bridge: Executing market order for ", recId, " (Magic: ", magic, ")");
   
   if(g_trade.PositionOpen(symbol, orderType, lot, executionPrice, sl, tp, "FX Desk: " + recId)) {
      ulong ticket = g_trade.ResultDeal();
      double fillPrice = g_trade.ResultPrice();
      uint ret = g_trade.ResultRetcode();
      
      if(ret == 10008 || ret == 10009) { // ORDER_PLACED or ORDER_DONE
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
         Print("MT5 Bridge: Order filled ticket: ", ticket, " price: ", fillPrice);
      } else {
         string reason = GetRetcodeDescription(ret);
         SendTradeFailed(recId, reason, ret);
         Print("MT5 Bridge: Order opening execution failed: ", reason);
      }
   } else {
      uint ret = g_trade.ResultRetcode();
      string reason = GetRetcodeDescription(ret);
      SendTradeFailed(recId, reason, ret);
      Print("MT5 Bridge: Order opening dispatch failed: ", reason);
   }
}

//--- Locate and close position
void ExecuteCloseOrder(string json) {
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
      Print("MT5 Bridge: Order closed ticket: ", ticket, " price: ", exitPrice);
   } else {
      uint ret = g_trade.ResultRetcode();
      Print("MT5 Bridge: Failed to close order ", recId, " (retcode: ", ret, ")");
      SendTradeFailed(recId, "Failed to Close Position", ret);
   }
}

//--- Modify Stop Loss and Take Profit levels
void ExecuteModifySLTP(string json) {
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
      Print("MT5 Bridge: Modified ticket: ", ticket, " SL: ", sl, " TP: ", tp);
   } else {
      uint ret = g_trade.ResultRetcode();
      Print("MT5 Bridge: Failed to modify ticket ", ticket, " (retcode: ", ret, ")");
      SendTradeFailed(recId, "Failed to Modify stops", ret);
   }
}

//--- Inbound JSON Dispatcher
void ProcessInboundMessage(string json) {
   string action = GetJsonValue(json, "action");
   if(action == "") return;
   
   if(action == "PING") {
      string payload = "{\"event\":\"PONG\"}";
      SendEvent(payload);
      return;
   }
   
   if(action == "OPEN_ORDER") {
      ExecuteOpenOrder(json);
      return;
   }
   
   if(action == "CLOSE_ORDER") {
      ExecuteCloseOrder(json);
      return;
   }
   
   if(action == "MODIFY_SLTP") {
      ExecuteModifySLTP(json);
      return;
   }
   
   if(action == "POSITION_LIST") {
      SendPositionList();
      return;
   }
}

//--- EA Initialization
int OnInit() {
   Print("MT5 Bridge: Initializing FxDeskBridgeEA...");
   
   // Set timer for network tasks (1 second resolution)
   EventSetTimer(1);
   
   ConnectToBridge();
   
   return(INIT_SUCCEEDED);
}

//--- EA Deinitialization
void OnDeinit(const int reason) {
   Print("MT5 Bridge: Deinitializing EA. Reason Code: ", reason);
   EventKillTimer();
   SocketDisconnect();
}

//--- EA Timer loop for Heartbeat & Reconnection
void OnTimer() {
   // Reconnection loop using linear/exponential retry logic
   if(!g_connected) {
      if(TimeCurrent() - g_last_reconnect_attempt >= g_current_reconnect_delay) {
         ConnectToBridge();
      }
      return;
   }
   
   // Check for dead socket via heartbeat timeout (InpHeartbeatInterval * 2)
   if(g_connected && TimeCurrent() - g_last_received_time >= InpHeartbeatInterval * 2) {
      Print("MT5 Bridge: Heartbeat timeout. Dead socket detected. Disconnecting...");
      SocketDisconnect();
      
      // Heartbeat timeout disconnect: increase reconnect delay (exponential backoff capped at 60 seconds)
      g_current_reconnect_delay = g_current_reconnect_delay * 2;
      if(g_current_reconnect_delay > 60) g_current_reconnect_delay = 60;
      return;
   }
   
   // Heartbeat loop
   if(TimeCurrent() - g_last_heartbeat >= InpHeartbeatInterval) {
      string pingPayload = "{\"event\":\"PING\"}";
      if(SocketWriteData(pingPayload)) {
         g_last_heartbeat = TimeCurrent();
      } else {
         Print("MT5 Bridge: Connection lost. Reconnecting...");
         SocketDisconnect();
      }
   }
   
   // Check for incoming WebSocket messages
   string msg = SocketReadData();
   if(msg != "") {
      ProcessInboundMessage(msg);
   }
   
   // Send periodic Account Metrics every 30 seconds
   static datetime last_summary = 0;
   if(TimeCurrent() - last_summary >= 30) {
      SendAccountSummary();
      last_summary = TimeCurrent();
   }
}

//--- EA Tick handler
void OnTick() {
   // If connected, read inbound frames immediately on tick for ultra-low latency execution
   if(g_connected) {
      string msg = SocketReadData();
      if(msg != "") {
         ProcessInboundMessage(msg);
      }
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
