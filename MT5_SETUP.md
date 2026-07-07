# FX Desk Pro — MT5 Demo Connection & Deployment Guide

This guide describes the complete procedure for connecting your **MetaTrader 5 (MT5)** desktop application to the **FX Desk Pro Bridge** to automate and monitor executions on your MT5 Demo account.

---

## 1. Installing MT5 Desktop
1. Download MetaTrader 5 Desktop from the official MetaQuotes website: [https://www.metatrader5.com/en/download](https://www.metatrader5.com/en/download)
2. Run the installer and complete the setup wizard.
3. Open the MetaTrader 5 application.

---

## 2. Logging into the MetaQuotes Demo Account
1. Inside MT5, go to the top menu: **File** ➔ **Login to Trade Account**.
2. If you do not have a demo account:
   - Go to **File** ➔ **Open an Account**.
   - Select **MetaQuotes Software Corp.** (or your preferred broker, e.g., Vantage Global Prime).
   - Choose **Open a demo account to trade virtual money** and fill in your details.
   - Save your **Login (Account Number)**, **Password**, and **Server** details.
3. If you have an existing account, enter your credentials:
   - **Login**: (e.g., `998877`)
   - **Password**: `******`
   - **Server**: (e.g., `MetaQuotes-Demo` or `Vantage-Demo-Server`)
4. Confirm connection status by checking the green connection bars in the bottom-right corner of the MT5 window.

---

## 3. Compiling the Expert Advisor (`FxDeskBridgeEA.mq5`)
1. In MT5, open the **MetaQuotes Language Editor** (MetaEditor) by pressing `F4` or clicking the MetaEditor icon in the toolbar.
2. Inside MetaEditor, go to **File** ➔ **Open** and select the [FxDeskBridgeEA.mq5](file:///c:/Users/Lenovo/forex-dashboard-demo/FxDeskBridgeEA.mq5) file from your workspace root.
3. Click the **Compile** button in the top toolbar (or press `F7`).
4. Ensure the **Compile** output panel at the bottom shows:
   ```text
   0 error(s), 0 warning(s)
   ```
   This will generate the compiled binary file `FxDeskBridgeEA.ex5` in the same directory.

---

## 4. Copying the Expert Advisor to the MT5 Data Folder
1. In MetaTrader 5, go to **File** ➔ **Open Data Folder**.
2. A file explorer window will open. Navigate to:
   ```text
   MQL5 \ Experts
   ```
3. Copy the compiled `FxDeskBridgeEA.ex5` (and/or `FxDeskBridgeEA.mq5`) from your project workspace and paste it directly into this `MQL5\Experts` folder.
4. Back in MetaTrader 5, go to the **Navigator** panel (usually on the left side; press `Ctrl+N` if not visible).
5. Expand the **Expert Advisors** list, right-click, and select **Refresh**.
6. `FxDeskBridgeEA` should now appear in the list.

---

## 5. Attaching the EA to the XAUUSD Chart
1. In the **Market Watch** panel (press `Ctrl+M`), search for the Gold symbol: **XAUUSD** (or **GOLD**).
2. Right-click the symbol and choose **Chart Window**.
3. Ensure the chart is active (recommended timeframes: `M1`, `M5`, or `H1`).
4. Drag `FxDeskBridgeEA` from the **Navigator** panel onto the active **XAUUSD** chart (or double-click the EA in the Navigator with the chart selected).

---

## 6. Configuring Expert Advisor Inputs
When dragging/attaching the EA, a configuration modal will appear. Navigate to the **Inputs** tab and configure the following parameters:

| Input Parameter | Default Value | Description |
| :--- | :--- | :--- |
| **InpBridgeUrl** | `ws://127.0.0.1:8080` | The WebSocket Server Bridge URL. For local setups, keep the default. |
| **InpAuthToken** | `default-mt5-token-change-me` | The Authentication Token configured on your backend `.env` (`MT5_BRIDGE_AUTH_TOKEN`). |
| **InpReconnectDelay** | `5` | The initial delay (in seconds) to wait before reconnecting if the bridge connection is lost. |
| **InpHeartbeatInterval** | `10` | The interval (in seconds) at which the EA sends PING messages to verify the connection is active. |

---

## 7. Enabling AutoTrading in MetaTrader 5
To allow the Expert Advisor to open, modify, and close trades:
1. In the MT5 configuration modal, navigate to the **Common** tab and check **Allow Algo Trading**.
2. Click **OK** to attach the EA.
3. Click the **Algo Trading** button in the main MT5 top toolbar (it must turn green with a "Play" icon).
4. Verify that the EA icon in the top-right corner of your chart has a **green play icon** (if it is a red square, Algo Trading is disabled).

---

## 8. Expected Backend Server Logs
Upon successful start and connection, the backend service logs will display:

- **Startup of server and bridge:**
  ```text
  {"level":"info","event":"server.started","host":"0.0.0.0","port":5000}
  {"level":"info","event":"mt5_sync.server_started","port":8080}
  ```
- **Change Stream / Polling registration:**
  ```text
  {"level":"info","event":"mt5_sync.change_stream_listening"}
  ```
  *(or fallback if MongoDB Replica Set is not present)*
  ```text
  {"level":"info","event":"mt5_sync.fallback_polling_started"}
  ```
- **Client EA connection and successful registration:**
  ```text
  {"level":"info","event":"mt5_sync.ea_registered","accountId":"Vantage-Demo_998877","broker":"Vantage-Demo","server":"Vantage-Demo-Server","accountNumber":"998877"}
  ```
- **Order placement instructions sent:**
  ```text
  {"level":"info","event":"mt5_sync.sending_open_order","recommendationId":"REC-XXXX-XXXX","magicNumber":12345678}
  ```
- **Confirmation from EA that the position was opened:**
  ```text
  {"level":"info","event":"mt5_sync.state.order_filled","recommendationId":"REC-XXXX-XXXX","magicNumber":12345678,"ticket":"9876543","fillPrice":2350.55,"slippage":0.0,"spread":0.15,"latencyMs":120}
  ```

---

## 9. Expected MT5 Terminal Logs
Logs can be viewed in MT5 under the **Toolbox** panel (press `Ctrl+T`) ➔ **Experts** tab:

- **EA Initialization:**
  ```text
  MT5 Bridge: Initializing FxDeskBridgeEA...
  MT5 Bridge: Attempting connection to ws://127.0.0.1:8080
  ```
- **Connection established and registered:**
  ```text
  MT5 Bridge: Handshake complete. Authenticating... (Delay reset to: 5s)
  MT5 Bridge: REGISTER packet sent for account: Vantage-Demo_998877
  ```
- **Order opening command received and executed:**
  ```text
  MT5 Bridge: Executing market order for REC-XXXX-XXXX (Magic: 12345678)
  MT5 Bridge: Order filled ticket: 9876543 price: 2350.55
  ```
- **Order closed command received and executed:**
  ```text
  MT5 Bridge: Order closed ticket: 9876543 price: 2365.10
  ```

---

## 10. Troubleshooting & Common Issues

### Issue 1: EA fails to connect to the Bridge (Socket Error Code 56 or similar)
- **Cause:** MT5 prohibits socket connections to arbitrary hosts unless explicitly whitelisted.
- **Solution:**
  1. In MT5, go to **Tools** ➔ **Options** ➔ **Expert Advisors**.
  2. Check **Allow WebRequest for listed URL**.
  3. Add your bridge host and port: `http://127.0.0.1:8080` (or `ws://127.0.0.1:8080`).
  4. Ensure your backend is running and the WebSocket server is active on the configured port.

### Issue 2: Invalid Authentication Token (Close Code 4401)
- **Cause:** The `InpAuthToken` input in your EA does not match the `MT5_BRIDGE_AUTH_TOKEN` in your backend `.env` file.
- **Solution:** Edit the EA inputs on your chart (double-click the chart or right-click ➔ **Expert List** ➔ **Properties**) and input the correct token string.

### Issue 3: Order placement fail (Insufficient Margin or Market Closed)
- **Cause:** Your MT5 account does not have enough leverage/free margin to execute `0.1` lots of Gold, or trading is closed.
- **Solution:** Verify account details in the **Trade** tab. Adjust the lot size parameter inside the backend service if necessary or check MT5 trading hours.

### Issue 4: Localhost connection issues on Windows
- **Cause:** Sometimes `localhost` resolves to the IPv6 address `::1` while the server binds to `127.0.0.1`.
- **Solution:** In the EA inputs, use the numerical IP address `ws://127.0.0.1:8080` instead of `localhost`.
