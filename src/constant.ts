// API endpoints and their access keys
export const FOREX_SOURCES = {
  EXCHANGERATE_API: "https://api.exchangerate-api.com/v4/latest/USD", // Free tier available
  FRANKFURTER: "https://api.frankfurter.app/latest", // Completely free
  FREE_FOREX: "https://www.freeforexapi.com/api/live", // Free with registration
  CURRENCY_API: "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest", // Completely free
  EXCHANGE_RATE_HOST: "https://api.exchangerate.host/latest", // Completely free
  CURRENCY_FREAKS: "https://api.currencyfreaks.com/latest", // Free tier available
  OPEN_EXCHANGE_RATES: "https://openexchangerates.org/api/latest.json", // Free tier available
  CURRENCY_LAYER: "http://api.currencylayer.com/live", // Free tier available

  FIXER_IO: "https://data.fixer.io/api/latest",
  ALPHA_VANTAGE:
    "https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE",
  EXCHANGE_RATE_IO: "https://api.exchangerate.io/latest",

  CURRENCY_CONVERTER_API:
    "https://free.currencyconverterapi.com/api/v6/convert",
  FLOAT_RATES: "https://www.floatrates.com/daily/usd.json",
  FX_JS_API: "https://api.fxjs.io/api/historical",
  NBP_API: "https://api.nbp.pl/api/exchangerates/tables/A",
  CNB_API:
    "https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt",
  BOC_API:
    "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json",
  ECB_API: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
  CBR_API: "https://www.cbr.ru/scripts/XML_daily.asp",
  SNB_API: "https://www.snb.ch/selector/en/mmr/exfeed/rss",
  UNIRATE_API: "https://api.unirateapi.com/api/rates",
};

export const MAJOR_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "NZD",
];