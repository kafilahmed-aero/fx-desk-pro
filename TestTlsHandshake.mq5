//+------------------------------------------------------------------+
//|                                             TestTlsHandshake.mq5 |
//|                                  Copyright 2026, FX Desk Pro     |
//|                                             https://www.mql5.com |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, FX Desk Pro"
#property link      "https://www.mql5.com"
#property version   "1.00"
#property script_show_inputs

//+------------------------------------------------------------------+
//| Script program start function                                    |
//+------------------------------------------------------------------+
void OnStart() {
   Print("====================================================");
   Print("MQL5 TLS HANDSHAKE DIAGNOSTIC SCRIPT");
   Print("====================================================");
   
   string hosts[3] = {"www.google.com", "www.microsoft.com", "api.github.com"};
   ushort port = 443;
   
   for(int i = 0; i < 3; i++) {
      string host = hosts[i];
      Print("\n[Testing Host ", i + 1, "/3]: ", host);
      
      ResetLastError();
      int socket = SocketCreate(SOCKET_DEFAULT);
      int createErr = GetLastError();
      
      if(socket == INVALID_HANDLE) {
         Print("-> SocketCreate failed. Error Code: ", createErr);
         continue;
      }
      
      Print("-> Socket created successfully. Handle: ", socket);
      
      ResetLastError();
      bool connectRes = SocketConnect(socket, host, port, 5000);
      int connectErr = GetLastError();
      Print("-> SocketConnect result: ", connectRes, ", GetLastError(): ", connectErr);
      
      if(connectRes) {
         uint handshakeStart = GetTickCount();
         ResetLastError();
         bool handshakeRes = SocketTlsHandshake(socket, host);
         int handshakeErr = GetLastError();
         uint elapsed = GetTickCount() - handshakeStart;
         
         Print("-> SocketTlsHandshake result: ", handshakeRes);
         Print("-> Elapsed Handshake Time: ", elapsed, " ms");
         Print("-> GetLastError() from Handshake: ", handshakeErr);
      } else {
         Print("-> Cannot test TLS Handshake because connection failed.");
      }
      
      SocketClose(socket);
      Print("-> Socket closed.");
   }
   Print("\n====================================================");
   Print("DIAGNOSTIC TEST COMPLETE");
   Print("====================================================");
}
//+------------------------------------------------------------------+
