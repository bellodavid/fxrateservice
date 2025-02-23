import { ForexConfig } from './types';
import config from './config';

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

export const BASE_CURRENCY = "USD";

export const SPREAD_CONFIG = {
  DEFAULT_SPREAD_PIPS: 2.5,
  MAX_ALLOWED_SPREAD_PIPS: 10,
};

export const FOREX_SOURCES = {
  EXCHANGERATE_API: "https://api.exchangerate-api.com/v4/latest/USD",
  FRANKFURTER: "https://api.frankfurter.app/latest",
  FREE_FOREX: "https://www.freeforexapi.com/api/live",
  CURRENCY_API: "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest",
  EXCHANGE_RATE_HOST: "https://api.exchangerate.host/latest",
  CURRENCY_FREAKS: "https://api.currencyfreaks.com/latest",
  OPEN_EXCHANGE_RATES: "https://openexchangerates.org/api/latest.json",
  CURRENCY_LAYER: "http://api.currencylayer.com/live",
  FIXER_IO: "https://data.fixer.io/api/latest",
  ALPHA_VANTAGE: "https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE",
  EXCHANGE_RATE_IO: "https://api.exchangerate.io/latest",
  CURRENCY_CONVERTER_API: "https://free.currencyconverterapi.com/api/v6/convert",
  FLOAT_RATES: "https://www.floatrates.com/daily/usd.json",
  FX_JS_API: "https://api.fxjs.io/api/historical",
  NBP_API: "https://api.nbp.pl/api/exchangerates/tables/A",
  CNB_API: "https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt",
  BOC_API: "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json",
  ECB_API: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
  CBR_API: "https://www.cbr.ru/scripts/XML_daily.asp",
  SNB_API: "https://www.snb.ch/selector/en/mmr/exfeed/rss",
  UNIRATE_API: "https://api.unirateapi.com/api/rates",
  CURRENCY_BEACON: "https://api.currencybeacon.com/v1/latest",
  MARKET_STACK: "https://api.marketstack.com/v1/latest",
  XE_API: "https://xecdapi.xe.com/v1/convert_from",
  FX_API: "https://api.fxapi.com/v1/latest"
};

export const CORS_CONFIG = {
  origin: config.nodeEnv === "production" 
    ? process.env.FRONTEND_URL || "http://localhost:3001"
    : "http://localhost:3001",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
  credentials: true,
};

export const getForexConfig = (): ForexConfig => ({
  openExchangeRatesApiKey: config.apis.openExchangeRatesKey,
  currencyLayerApiKey: config.apis.currencyLayerKey,
  currencyFreaksApiKey: config.apis.currencyFreaksKey,
  fixerApiKey: config.apis.fixerKey,
  unirateApiKey: config.apis.unirateKey,
  alphaVantageApiKey: config.apis.alphaVantageKey,
  currencyBeaconApiKey: config.apis.currencyBeaconKey,
  marketStackApiKey: config.apis.marketStackKey,
  xeApiId: config.apis.xeApiId,
  xeApiKey: config.apis.xeApiKey,
  fxApiKey: config.apis.fxApiKey,
});

export const RATE_UPDATE_CRON = "0 */5 * * *"; // Every 5 hours
