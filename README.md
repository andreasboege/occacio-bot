# Occacio RSI Bot

Occacio monitors selected markets for unusually high or low 14-period RSI readings and sends alerts to Telegram.

## What it monitors

The configured instruments are:

- DAX, FTSE 100, and CAC 40
- S&P 500, Nasdaq 100, and Dow futures
- EUR/USD, GBP/USD, and USD/JPY
- Gold, crude oil, and natural gas
- Bitcoin

## Schedule and active hours

The GitHub Actions workflow aims to check every five minutes on weekdays. It uses a scheduled run as a backup and re-dispatches itself for the next five-minute mark.

The bot only checks instruments from **07:00 inclusive to 17:00 exclusive, Europe/Copenhagen time**, Monday through Friday. The timezone observes CET/CEST automatically. Workflow runs outside this window exit without fetching market data.

## How alerts work

- The bot fetches 5-minute candles from Yahoo Finance and calculates RSI(14) using closed candles only; an in-progress candle is ignored.
- An RSI **below 30** is oversold; an RSI **above 70** is overbought. The thresholds themselves (30 and 70) do not trigger alerts.
- An alert is sent when an instrument crosses into an oversold or overbought zone. It does not send repeated alerts on every check while the RSI remains in the same zone.
- A 30-minute cooldown suppresses repeat alerts for each instrument. The bot continues tracking zones during the cooldown.
- When RSI returns to the 30–70 range, no notification is sent by default.
- Data with no closed candle or a newest closed candle more than 20 minutes old is skipped.
- If fetching data for an instrument fails for three consecutive runs, the bot sends a data-fetch warning for that instrument.

Alert messages include a direction emoji, instrument, RSI, and candle time, for example:

```text
🔺 DAX - RSI(14, 5m) = 76.9 at 16:40 CET
```

Oversold alerts use 🔻; overbought alerts use 🔺. The threshold and last closing price are not included in the alert message.

## Configuration and secrets

Instrument names and symbols, RSI settings, active hours, and other thresholds are in [`config.json`](config.json).

The workflow needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` configured as GitHub Actions secrets. To send alerts to a second Telegram chat, also configure the optional `TELEGRAM_CHAT_ID_2` secret. The bot sends each alert to both configured chat IDs. Do not put these values in this README, source files, or other public repository content.
