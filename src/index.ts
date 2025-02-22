import express from "express";
import axios from "axios";
import { z } from "zod";
import { DOMParser } from "xmldom";

import dotenv from "dotenv";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import cron from "node-cron";

dotenv.config();

const MAJOR_CURRENCIES = [
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
const BASE_CURRENCY = "USD";

// Supabase client setup
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

// Enhanced types to include buyRate/sellRate
interface ForexRate {
  source: string;
  rates: {
    [key: string]: {
      buyRate: number;
      sellRate: number;
      bananaCrystalRate?: number; // Optional as some direct API responses won't have this
    };
  };
  timestamp: number;
}

interface ForexConfig {
  openExchangeRatesApiKey: string; // Free tier
  currencyLayerApiKey: string; // Free tier
  currencyFreaksApiKey: string; // Free tier
  fixerApiKey: string;
  unirateApiKey: string;
}

interface RateWithSpread {
  source: string;
  buyRate: number;
  sellRate: number;
  spread: number;
  bananaCrystalRate: number;
}

// Types for rate history
interface RateHistory {
  id: number;
  from_currency: string;
  to_currency: string;
  banana_crystal_rate: number;
  confidence: number;
  volatility_index: number;
  is_stationary: boolean;
  created_at: string;
}

interface AllBananaCrystalRates {
  timestamp: number;
  rates: {
    [currencyPair: string]: {
      fromCurrency: string;
      toCurrency: string;
      bananaCrystalRate: number;
      confidence: number;
      volatilityIndex: number;
    };
  };
  metadata: {
    sourcesUsed: string[];
    totalPairs: number;
    updateDuration: number;
    baseCurrency: string;
    supportedCurrencies: string[];
  };
}
interface ConsolidatedRate {
  fromCurrency: string;
  toCurrency: string;
  buyRate: number;
  sellRate: number;
  spread: number;
  spreadPercentage: number;
  bananaCrystalRate: number;
  bananaCrystalConfidence: number;
  metadata: {
    sourcesUsed: string[];
    timestamp: number;
    individualRates: {
      source: string;
      buyRate: number;
      sellRate: number;
      spread: number;
      bananaCrystalRate?: number;
    }[];
    bananaCrystalMetadata?: {
      volatilityIndex: number;
      standardDeviation: number;
      sampleSize: number;
    };
  };
}

interface BananaCrystalRate {
  fromCurrency: string;
  toCurrency: string;
  bananaCrystalRate: number;
  confidence: number;
  volatilityIndex: number;
  metadata: {
    sourcesUsed: string[];
    timestamp: number;
    standardDeviation: number;
    sampleSize: number;
    individualRates: {
      source: string;
      rate: number;
      weight: number;
    }[];
    lastUpdated: string;
  };
}

const app = express();
const port = 3000;

// Schema for rate history validation
const RateHistorySchema = z.object({
  from_currency: z.string().length(3),
  to_currency: z.string().length(3),
  banana_crystal_rate: z.number(),
  confidence: z.number(),
  volatility_index: z.number(),
  is_stationary: z.boolean(),
});

// Define a specific schema for rate history requests
const RateHistoryRequestSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
});

app.use(
  cors({
    origin: "http://localhost:3001", // Allow your frontend origin
    methods: ["GET", "POST", "OPTIONS"], // Allowed methods
    allowedHeaders: ["Content-Type", "Accept"], // Allowed headers
    credentials: true, // Allow credentials
  })
);

// Add spread configurations
const SPREAD_CONFIG = {
  DEFAULT_SPREAD_PIPS: 2.5, // Default spread in pips if not provided by API
  MAX_ALLOWED_SPREAD_PIPS: 10, // Maximum allowed spread for validation
};

// API endpoints and their access keys
const FOREX_SOURCES = {
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

// Function to determine if rate is stationary
function determineRateStationarity(rateHistory: RateHistory[]): boolean {
  if (rateHistory.length < 2) return true;

  // Calculate rate changes
  const rateChanges = rateHistory
    .slice(0, -1)
    .map((rate, index) =>
      Math.abs(
        rate.banana_crystal_rate - rateHistory[index + 1].banana_crystal_rate
      )
    );

  // Calculate average rate change
  const avgChange =
    rateChanges.reduce((sum, change) => sum + change, 0) / rateChanges.length;

  // If average change is less than 0.1%, consider rate stationary
  return avgChange < 0.001;
}

// Function to store rate history - moved before its usage
async function storeRateHistory(
  fromCurrency: string,
  toCurrency: string,
  bananaCrystalRate: number,
  confidence: number,
  volatilityIndex: number
): Promise<void> {
  try {
    // Get last 20 rates for this currency pair
    const { data: rateHistory } = await supabase
      .from("rate_history")
      .select("*")
      .eq("from_currency", fromCurrency)
      .eq("to_currency", toCurrency)
      .order("created_at", { ascending: false })
      .limit(20);

    // Determine if rate is stationary
    const isStationary = determineRateStationarity(rateHistory || []);

    // Insert new rate
    const { error } = await supabase.from("rate_history").insert([
      {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        banana_crystal_rate: bananaCrystalRate,
        confidence,
        volatility_index: volatilityIndex,
        is_stationary: isStationary,
      },
    ]);

    if (error) throw error;
  } catch (error) {
    console.error("Error storing rate history:", error);
    throw error;
  }
}

// Function to get rate history
async function getRateHistory(
  fromCurrency: string,
  toCurrency: string
): Promise<RateHistory[]> {
  try {
    const { data, error } = await supabase
      .from("rate_history")
      .select("*")
      .eq("from_currency", fromCurrency)
      .eq("to_currency", toCurrency)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching rate history:", error);
    throw error;
  }
}

const RateRequestSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
});

async function fetchBananaCrystalRates(
  otherRates: ForexRate[]
): Promise<ForexRate> {
  const aggregatedRates: {
    [key: string]: { buyRate: number; sellRate: number };
  } = {};

  // Get all unique currency pairs
  const allCurrencies = new Set<string>();
  otherRates.forEach((source) => {
    Object.keys(source.rates).forEach((currency) =>
      allCurrencies.add(currency)
    );
  });

  // Add new endpoint for rate history
  app.get("/api/rate-history", async (req, res) => {
    try {
      const { fromCurrency, toCurrency } = RateRequestSchema.parse({
        fromCurrency: req.query.from?.toString().toUpperCase(),
        toCurrency: req.query.to?.toString().toUpperCase(),
      });

      const rateHistory = await getRateHistory(fromCurrency, toCurrency);
      res.json(rateHistory);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid currency codes provided" });
      } else {
        res.status(500).json({ error: "Failed to fetch rate history" });
      }
    }
  });

  // Calculate average rates for each currency
  allCurrencies.forEach((currency) => {
    const validRates = otherRates
      .filter((source) => source.rates[currency])
      .map((source) => source.rates[currency]);

    if (validRates.length > 0) {
      const avgBuyRate =
        validRates.reduce((sum, rate) => sum + rate.buyRate, 0) /
        validRates.length;
      const avgSellRate =
        validRates.reduce((sum, rate) => sum + rate.sellRate, 0) /
        validRates.length;

      aggregatedRates[currency] = {
        buyRate: Number(avgBuyRate.toFixed(6)),
        sellRate: Number(avgSellRate.toFixed(6)),
      };
    }
  });

  return {
    source: "BananaCrystal",
    rates: aggregatedRates,
    timestamp: Date.now(),
  };
}

async function calculateAllBananaCrystalRates(
  rates: ForexRate[]
): Promise<AllBananaCrystalRates> {
  const startTime = Date.now();
  const sourcesUsed = new Set<string>();
  const allRates: AllBananaCrystalRates["rates"] = {};

  // Only calculate rates for major currency pairs to stay within limits
  for (const toCurrency of MAJOR_CURRENCIES) {
    if (toCurrency !== BASE_CURRENCY) {
      try {
        // Add delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const bananaCrystalRate = await calculateBananaCrystalRate(
          BASE_CURRENCY,
          toCurrency,
          rates
        );

        rates.forEach((source) => sourcesUsed.add(source.source));

        const pairKey = `${BASE_CURRENCY}/${toCurrency}`;
        allRates[pairKey] = {
          fromCurrency: BASE_CURRENCY,
          toCurrency,
          bananaCrystalRate: bananaCrystalRate.bananaCrystalRate,
          confidence: bananaCrystalRate.confidence,
          volatilityIndex: bananaCrystalRate.volatilityIndex,
        };

        // Validate currency codes before storing
        if (BASE_CURRENCY.length === 3 && toCurrency.length === 3) {
          await storeRateHistory(
            BASE_CURRENCY,
            toCurrency,
            bananaCrystalRate.bananaCrystalRate,
            bananaCrystalRate.confidence,
            bananaCrystalRate.volatilityIndex
          );
        } else {
          console.warn(
            `Invalid currency code length: ${BASE_CURRENCY}/${toCurrency}`
          );
        }
      } catch (error) {
        console.error(
          `Error calculating rate for ${BASE_CURRENCY}/${toCurrency}:`,
          error
        );
        // Continue with next pair instead of failing completely
        continue;
      }
    }
  }
  return {
    timestamp: Date.now(),
    rates: allRates,
    metadata: {
      sourcesUsed: Array.from(sourcesUsed),
      totalPairs: Object.keys(allRates).length,
      updateDuration: Date.now() - startTime,
      baseCurrency: BASE_CURRENCY,
      supportedCurrencies: MAJOR_CURRENCIES,
    },
  };
}

async function fetchExchangeRateAPI(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.EXCHANGERATE_API);
    // Convert single rate to buyRate/sellRate with default spread
    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.quotes).forEach(([currencyPair, rate]) => {
      // CurrencyLayer returns as USDEUR format
      const currency = currencyPair.substring(3); // Remove 'USD' prefix
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "ExchangeRate-API",
      rates,
      timestamp: new Date(response.data.time_last_updated * 1000).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from ExchangeRate-API:", error);
    throw error;
  }
}

async function fetchNbpApi(): Promise<ForexRate> {
  try {
    const response = await axios.get(`${FOREX_SOURCES.NBP_API}?format=json`);
    const rates: ForexRate["rates"] = {};

    // Get PLN/USD rate to convert from PLN to USD
    const usdRate =
      response.data[0].rates.find((r: any) => r.code === "USD")?.mid || 1;

    response.data[0].rates.forEach((rateData: any) => {
      // Convert rates to USD base (the API returns everything in PLN)
      const baseRate = 1 / (rateData.mid / usdRate);
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

      rates[rateData.code] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    // Add PLN rate (relative to USD)
    rates["PLN"] = {
      buyRate:
        (1 / usdRate) * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      sellRate:
        (1 / usdRate) * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
    };

    return {
      source: "NbpApi",
      rates,
      timestamp: new Date(response.data[0].effectiveDate).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from NbpApi:", error);
    throw error;
  }
}

async function fetchCnbApi(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.CNB_API);
    const lines = response.data.split("\n");
    const dateString = lines[0].split("#")[0].trim();
    const rateLines = lines.slice(2).filter(Boolean);

    const rates: ForexRate["rates"] = {};

    // Find USD rate to convert from CZK to USD
    let usdRate = 1;
    for (const line of rateLines) {
      const [country, currency, amount, code, rate] = line.split("|");
      if (code === "USD") {
        usdRate = parseFloat(rate) / parseFloat(amount);
        break;
      }
    }

    // Parse all other rates
    for (const line of rateLines) {
      const [country, currency, amount, code, rate] = line.split("|");
      if (code && rate) {
        // Convert from CZK to USD base
        const baseRate = 1 / (parseFloat(rate) / parseFloat(amount) / usdRate);
        const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

        rates[code] = {
          buyRate: baseRate * (1 - halfSpread),
          sellRate: baseRate * (1 + halfSpread),
        };
      }
    }

    // Add CZK rate (relative to USD)
    rates["CZK"] = {
      buyRate:
        (1 / usdRate) * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      sellRate:
        (1 / usdRate) * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
    };

    return {
      source: "CnbApi",
      rates,
      timestamp: new Date(dateString).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from CnbApi:", error);
    throw error;
  }
}

async function fetchExchangeRateIO(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.EXCHANGE_RATE_IO);
    const rates: ForexRate["rates"] = {};

    Object.entries(response.data.rates).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "ExchangeRate.io",
      rates,
      timestamp: new Date(response.data.date).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from ExchangeRate.io:", error);
    throw error;
  }
}

async function fetchEcbApi(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.ECB_API);
    const rates: ForexRate["rates"] = {};

    // Use xmldom for parsing
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(response.data, "text/xml");
    const cubes = xmlDoc.getElementsByTagName("Cube");

    if (!cubes || cubes.length === 0) {
      throw new Error("No rate data found in ECB response");
    }

    // Get EUR/USD rate to convert to USD base
    let usdBaseRate = 1;
    for (let i = 0; i < cubes.length; i++) {
      const cube = cubes[i];
      if (cube.getAttribute("currency") === "USD") {
        const rate = cube.getAttribute("rate");
        if (rate) {
          usdBaseRate = 1 / parseFloat(rate);
          break;
        }
      }
    }

    // Process all rates
    for (let i = 0; i < cubes.length; i++) {
      const cube = cubes[i];
      const currency = cube.getAttribute("currency");
      const rate = cube.getAttribute("rate");

      if (currency && rate) {
        const baseRate = parseFloat(rate) * usdBaseRate;
        const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

        rates[currency] = {
          buyRate: baseRate * (1 - halfSpread),
          sellRate: baseRate * (1 + halfSpread),
        };
      }
    }

    // Add EUR rate
    rates["EUR"] = {
      buyRate:
        usdBaseRate * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      sellRate:
        usdBaseRate * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
    };

    return {
      source: "EuropeanCentralBank",
      rates,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Error fetching from ECB:", error);
    return {
      source: "EuropeanCentralBank",
      rates: {},
      timestamp: Date.now(),
    };
  }
}

async function updateAllRates(): Promise<void> {
  try {
    console.log("Starting periodic rate update...");
    const config: ForexConfig = {
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      currencyFreaksApiKey: process.env.CURRENCY_FREAKS_API_KEY || "",
      fixerApiKey: process.env.FIXER_API_KEY || "",
      unirateApiKey: process.env.UNIRATE_API_KEY || "",
    };

    const rates = await aggregateForexRates(config);
    await calculateAllBananaCrystalRates(rates);
    console.log("Periodic rate update completed successfully");
  } catch (error) {
    console.error("Error during periodic rate update:", error);
    // Implement retry logic if needed
    // await retryUpdate();
  }
}

// Add new endpoint for all BananaCrystal rates
app.get("/api/all-bananacrystal-rates", async (req, res) => {
  try {
    const config: ForexConfig = {
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      currencyFreaksApiKey: process.env.CURRENCY_FREAKS_API_KEY || "",
      fixerApiKey: process.env.FIXER_API_KEY || "",
      unirateApiKey: process.env.UNIRATE_API_KEY || "",
    };

    const rates = await aggregateForexRates(config);
    const allRates = await calculateAllBananaCrystalRates(rates);

    res.json({
      ...allRates,
      metadata: {
        ...allRates.metadata,
        notice: "Limited to major currency pairs due to API restrictions",
      },
    });
  } catch (error) {
    console.error("Error fetching all BananaCrystal rates:", error);
    res.status(500).json({
      error: "Failed to fetch BananaCrystal rates",
      message: "Service is limited to major currency pairs in free tier",
    });
  }
});

// Add this after your other app configurations but before app.listen()
// Schedule updates every 5 hours
cron.schedule("0 */5 * * *", async () => {
  await updateAllRates();
});

async function fetchCbrApi(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.CBR_API);
    const rates: ForexRate["rates"] = {};

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(response.data, "text/xml");
    const valutes = xmlDoc.getElementsByTagName("Valute");

    if (!valutes || valutes.length === 0) {
      throw new Error("No rate data found in CBR response");
    }

    // Get USD/RUB rate
    let usdBaseRate = 1;
    for (let i = 0; i < valutes.length; i++) {
      const valute = valutes[i];
      const charCode = valute.getElementsByTagName("CharCode")[0]?.textContent;
      if (charCode === "USD") {
        const nominal = parseFloat(
          valute.getElementsByTagName("Nominal")[0]?.textContent || "1"
        );
        const value = parseFloat(
          valute
            .getElementsByTagName("Value")[0]
            ?.textContent?.replace(",", ".") || "1"
        );
        usdBaseRate = 1 / (value / nominal);
        break;
      }
    }

    // Process all rates
    for (let i = 0; i < valutes.length; i++) {
      const valute = valutes[i];
      const currency = valute.getElementsByTagName("CharCode")[0]?.textContent;
      const nominal = parseFloat(
        valute.getElementsByTagName("Nominal")[0]?.textContent || "1"
      );
      const value = parseFloat(
        valute
          .getElementsByTagName("Value")[0]
          ?.textContent?.replace(",", ".") || "1"
      );

      if (currency && value) {
        const baseRate = (value / nominal) * usdBaseRate;
        const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

        rates[currency] = {
          buyRate: baseRate * (1 - halfSpread),
          sellRate: baseRate * (1 + halfSpread),
        };
      }
    }

    // Add RUB rate
    rates["RUB"] = {
      buyRate:
        usdBaseRate * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      sellRate:
        usdBaseRate * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
    };

    return {
      source: "BankOfRussia",
      rates,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Error fetching from CBR:", error);
    return {
      source: "BankOfRussia",
      rates: {},
      timestamp: Date.now(),
    };
  }
}

async function fetchSnbApi(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.SNB_API);
    const rates: ForexRate["rates"] = {};

    // Parse XML response
    const xmlData = response.data;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlData, "text/xml");
    const observations = xmlDoc.getElementsByTagName("observation");

    // Get USD/CHF rate to convert to USD base
    const usdChfRate = Array.from(observations).find(
      (obs) => obs.getAttribute("currency") === "USD"
    );
    const usdBaseRate = usdChfRate
      ? 1 / parseFloat(usdChfRate.getAttribute("value") || "1")
      : 1;

    // Process all rates
    Array.from(observations).forEach((observation) => {
      const currency = observation.getAttribute("currency");
      const rate = observation.getAttribute("value");

      if (currency && rate) {
        // Convert from CHF base to USD base
        const baseRate = parseFloat(rate) * usdBaseRate;
        const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

        rates[currency] = {
          buyRate: baseRate * (1 - halfSpread),
          sellRate: baseRate * (1 + halfSpread),
        };
      }
    });

    // Add CHF rate (relative to USD)
    rates["CHF"] = {
      buyRate:
        usdBaseRate * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      sellRate:
        usdBaseRate * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
    };

    return {
      source: "SwissNationalBank",
      rates,
      timestamp: Date.now(), // SNB doesn't provide timestamp in the feed
    };
  } catch (error) {
    console.error("Error fetching from SNB:", error);
    throw error;
  }
}

async function fetchFrankfurter(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.FRANKFURTER);
    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.rates).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "Frankfurter",
      rates,
      timestamp: new Date(response.data.date).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from Frankfurter:", error);
    throw error;
  }
}

async function fetchFloatRates(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.FLOAT_RATES);
    const rates: ForexRate["rates"] = {};

    Object.entries(response.data).forEach(([currency, data]) => {
      const rateData = data as any;
      const baseRate = rateData.rate;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency.toUpperCase()] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "FloatRates",
      rates,
      timestamp: Date.now(), // Uses current timestamp as API doesn't provide one
    };
  } catch (error) {
    console.error("Error fetching from FloatRates:", error);
    throw error;
  }
}

async function fetchCurrencyFreaks(apiKey: string): Promise<ForexRate> {
  try {
    const response = await axios.get(
      `${FOREX_SOURCES.CURRENCY_FREAKS}?apikey=${apiKey}`
    );
    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.rates).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "CurrencyFreaks",
      rates,
      timestamp: new Date(response.data.date).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from CurrencyFreaks:", error);
    throw error;
  }
}
async function fetchCurrencyConverterAPI(): Promise<ForexRate> {
  try {
    // Major currency pairs
    const majorCurrencies = ["EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];
    const queryParams = majorCurrencies.map((curr) => `USD_${curr}`).join(",");

    const response = await axios.get(
      `${FOREX_SOURCES.CURRENCY_CONVERTER_API}?q=${queryParams}`
    );

    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.results).forEach(([pair, data]) => {
      const currency = pair.split("_")[1];
      const baseRate = (data as any).val as number;

      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "CurrencyConverterAPI",
      rates,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Error fetching from CurrencyConverterAPI:", error);
    throw error;
  }
}

async function fetchCurrencyAPI(): Promise<ForexRate> {
  try {
    const response = await axios.get(
      `${FOREX_SOURCES.CURRENCY_API}/currencies/usd.json`
    );
    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.usd).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency.toUpperCase()] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "Currency-API",
      rates,
      timestamp: new Date(response.data.date).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from Currency-API:", error);
    throw error;
  }
}

async function fetchExchangeRateHost(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.EXCHANGE_RATE_HOST);
    const rates: ForexRate["rates"] = {};

    if (!response.data?.rates || typeof response.data.rates !== "object") {
      throw new Error("Invalid response format from ExchangeRate.host");
    }

    Object.entries(response.data.rates).forEach(([currency, rate]) => {
      if (typeof rate === "number") {
        const baseRate = rate;
        const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
        rates[currency] = {
          buyRate: baseRate * (1 - halfSpread),
          sellRate: baseRate * (1 + halfSpread),
        };
      }
    });

    return {
      source: "ExchangeRate.host",
      rates,
      timestamp: response.data.date
        ? new Date(response.data.date).getTime()
        : Date.now(),
    };
  } catch (error) {
    console.error("Error fetching from ExchangeRate.host:", error);
    return {
      source: "ExchangeRate.host",
      rates: {},
      timestamp: Date.now(),
    };
  }
}

async function fetchFxJsApi(): Promise<ForexRate> {
  try {
    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split("T")[0];

    // Using their free tier (limited requests)
    const response = await axios.get(
      `${FOREX_SOURCES.FX_JS_API}?base=USD&date=${today}`
    );
    const rates: ForexRate["rates"] = {};

    Object.entries(response.data.rates).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "FxJsApi",
      rates,
      timestamp: new Date(response.data.date).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from FxJsApi:", error);
    throw error;
  }
}

async function fetchBocApi(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.BOC_API);
    const rates: ForexRate["rates"] = {};

    const latestDate =
      response.data.observations[response.data.observations.length - 1].d;
    const latestRates =
      response.data.observations[response.data.observations.length - 1];

    // Bank of Canada API returns CAD exchange rates
    // We need to convert to USD base
    const usdCadRate = 1 / parseFloat(latestRates.FXUSDCAD.v);

    // Process each currency
    Object.entries(latestRates).forEach(([code, value]) => {
      if (code !== "d" && code.startsWith("FX")) {
        // Extract currency code (format is FXUSDCAD, FXUSDJPY, etc.)
        const currencyCode = code.substring(6);
        if (currencyCode && currencyCode.length === 3) {
          // Convert from CAD to USD base
          const cadRate = parseFloat((value as any).v);
          const usdRate = cadRate * usdCadRate;
          const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

          rates[currencyCode] = {
            buyRate: usdRate * (1 - halfSpread),
            sellRate: usdRate * (1 + halfSpread),
          };
        }
      }
    });

    // Add CAD rate (relative to USD)
    rates["CAD"] = {
      buyRate: usdCadRate * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      sellRate:
        usdCadRate * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
    };

    return {
      source: "BocApi",
      rates,
      timestamp: new Date(latestDate).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from BocApi:", error);
    throw error;
  }
}

async function calculateBananaCrystalRate(
  fromCurrency: string,
  toCurrency: string,
  rates: ForexRate[]
): Promise<BananaCrystalRate> {
  // Extract all valid rates and calculate their midpoint rates
  const validRates = rates
    .map((source) => {
      const rate = calculateCrossRateWithSpread(
        source.rates,
        fromCurrency,
        toCurrency
      );
      if (rate !== null) {
        return {
          source: source.source,
          rate: (rate.buyRate + rate.sellRate) / 2, // Use midpoint rate
          weight: 1, // Default weight, can be adjusted based on source reliability
        };
      }
      return null;
    })
    .filter(
      (rate): rate is { source: string; rate: number; weight: number } =>
        rate !== null
    );

  if (validRates.length === 0) {
    throw new Error(`No valid rates found for ${fromCurrency}/${toCurrency}`);
  }

  // Calculate weighted average and standard deviation
  const totalWeight = validRates.reduce((sum, rate) => sum + rate.weight, 0);
  const weightedSum = validRates.reduce(
    (sum, rate) => sum + rate.rate * rate.weight,
    0
  );
  const weightedAverage = weightedSum / totalWeight;

  // Calculate standard deviation
  const squaredDiffs = validRates.map(
    (rate) => Math.pow(rate.rate - weightedAverage, 2) * rate.weight
  );
  const standardDeviation = Math.sqrt(
    squaredDiffs.reduce((sum, diff) => sum + diff, 0) / totalWeight
  );

  // Calculate confidence score (inverse of coefficient of variation)
  const confidenceScore = Math.min(
    100,
    (1 - standardDeviation / weightedAverage) * 100
  );

  // Calculate volatility index (normalized standard deviation)
  const volatilityIndex = (standardDeviation / weightedAverage) * 100;

  return {
    fromCurrency,
    toCurrency,
    bananaCrystalRate: Number(weightedAverage.toFixed(6)),
    confidence: Number(confidenceScore.toFixed(2)),
    volatilityIndex: Number(volatilityIndex.toFixed(2)),
    metadata: {
      sourcesUsed: validRates.map((r) => r.source),
      timestamp: Date.now(),
      standardDeviation: Number(standardDeviation.toFixed(6)),
      sampleSize: validRates.length,
      individualRates: validRates.map((r) => ({
        source: r.source,
        rate: Number(r.rate.toFixed(6)),
        weight: r.weight,
      })),
      lastUpdated: new Date().toISOString(),
    },
  };
}

async function fetchFixerIO(apiKey: string): Promise<ForexRate> {
  try {
    const response = await axios.get(
      `${FOREX_SOURCES.FIXER_IO}?access_key=${apiKey}`
    );
    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.rates).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "Fixer.io",
      rates,
      timestamp: new Date(response.data.timestamp * 1000).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from Fixer.io:", error);
    throw error;
  }
}

async function fetchOpenExchangeRates(apiKey: string): Promise<ForexRate> {
  try {
    const response = await axios.get(
      `${FOREX_SOURCES.OPEN_EXCHANGE_RATES}?app_id=${apiKey}`
    );
    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.rates).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "OpenExchangeRates",
      rates,
      timestamp: new Date(response.data.timestamp * 1000).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from OpenExchangeRates:", error);
    throw error;
  }
}

async function fetchCurrencyLayer(apiKey: string): Promise<ForexRate> {
  try {
    const response = await axios.get(
      `${FOREX_SOURCES.CURRENCY_LAYER}?access_key=${apiKey}`
    );
    const rates: ForexRate["rates"] = {};
    Object.entries(response.data.quotes).forEach(([currency, rate]) => {
      const baseRate = rate as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "CurrencyLayer",
      rates,
      timestamp: new Date(response.data.timestamp * 1000).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from CurrencyLayer:", error);
    throw error;
  }
}

async function fetchAlphaVantage(
  apiKey: string,
  fromCurrency: string,
  toCurrency: string
): Promise<ForexRate> {
  try {
    const response = await axios.get(
      `${FOREX_SOURCES.ALPHA_VANTAGE}&from_currency=${fromCurrency}&to_currency=${toCurrency}&apikey=${apiKey}`
    );
    const baseRate = parseFloat(
      response.data["Realtime Currency Exchange Rate"]["5. Exchange Rate"]
    );
    const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

    return {
      source: "AlphaVantage",
      rates: {
        [toCurrency]: {
          buyRate: baseRate * (1 - halfSpread),
          sellRate: baseRate * (1 + halfSpread),
        },
      },
      timestamp: new Date().getTime(),
    };
  } catch (error) {
    console.error("Error fetching from AlphaVantage:", error);
    throw error;
  }
}

async function aggregateForexRates(config: ForexConfig): Promise<ForexRate[]> {
  try {
    const results = await Promise.allSettled([
      // Your existing APIs
      fetchExchangeRateAPI(),
      fetchFrankfurter(),
      fetchCurrencyAPI(),
      fetchExchangeRateHost(),
      fetchOpenExchangeRates(config.openExchangeRatesApiKey),
      fetchCurrencyLayer(config.currencyLayerApiKey),
      fetchCurrencyFreaks(config.currencyFreaksApiKey),
      fetchFixerIO(config.fixerApiKey),

      // Additional free APIs

      fetchFloatRates(),
      fetchFxJsApi(),
      fetchNbpApi(),
      fetchCnbApi(),
      fetchBocApi(),

      // Previous additional APIs
      fetchExchangeRateIO(),
      fetchEcbApi(),
      fetchCbrApi(),
      fetchSnbApi(),
      fetchCurrencyConverterAPI(),
      fetchUniRateApi(config.unirateApiKey),
    ]);

    const rates = results
      .filter(
        (result): result is PromiseFulfilledResult<ForexRate> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value);

    const bananaCrystalRates = await fetchBananaCrystalRates(rates);
    return [...rates, bananaCrystalRates];
  } catch (error) {
    console.error("Error aggregating forex rates:", error);
    throw error;
  }
}

async function calculateConsolidatedRate(
  fromCurrency: string,
  toCurrency: string,
  rates: ForexRate[]
): Promise<ConsolidatedRate> {
  // First, define the validRates with proper type checking
  const validRates: RateWithSpread[] = rates
    .map((source) => {
      const rate = calculateCrossRateWithSpread(
        source.rates,
        fromCurrency,
        toCurrency
      );
      if (rate !== null) {
        return {
          ...rate,
          source: source.source,
          bananaCrystalRate: (rate.buyRate + rate.sellRate) / 2,
        };
      }
      return null;
    })
    .filter((rate): rate is RateWithSpread => rate !== null);

  if (validRates.length === 0) {
    throw new Error(`No valid rates found for ${fromCurrency}/${toCurrency}`);
  }

  const cleanedRates = removeOutliersWithSpread(validRates);

  // Calculate averages including BananaCrystal
  const avgBuyRate =
    cleanedRates.reduce((sum, rate) => sum + rate.buyRate, 0) /
    cleanedRates.length;
  const avgSellRate =
    cleanedRates.reduce((sum, rate) => sum + rate.sellRate, 0) /
    cleanedRates.length;
  const spread = avgSellRate - avgBuyRate;
  const spreadPercentage = (spread / avgBuyRate) * 100;

  // Calculate BananaCrystal metrics
  const bananaCrystalRates = cleanedRates.map((r) => r.bananaCrystalRate);
  const bananaCrystalAvg =
    bananaCrystalRates.reduce((sum, rate) => sum + rate, 0) /
    bananaCrystalRates.length;
  const standardDeviation = Math.sqrt(
    bananaCrystalRates.reduce(
      (sum, rate) => sum + Math.pow(rate - bananaCrystalAvg, 2),
      0
    ) / bananaCrystalRates.length
  );
  const confidenceScore = Math.min(
    100,
    (1 - standardDeviation / bananaCrystalAvg) * 100
  );

  return {
    fromCurrency,
    toCurrency,
    buyRate: Number(avgBuyRate.toFixed(6)),
    sellRate: Number(avgSellRate.toFixed(6)),
    spread: Number(spread.toFixed(6)),
    spreadPercentage: Number(spreadPercentage.toFixed(4)),
    bananaCrystalRate: Number(bananaCrystalAvg.toFixed(6)),
    bananaCrystalConfidence: Number(confidenceScore.toFixed(2)),
    metadata: {
      sourcesUsed: cleanedRates.map((r) => r.source),
      timestamp: Date.now(),
      individualRates: cleanedRates.map((r) => ({
        source: r.source,
        buyRate: r.buyRate,
        sellRate: r.sellRate,
        spread: r.spread,
        bananaCrystalRate: r.bananaCrystalRate,
      })),
      bananaCrystalMetadata: {
        volatilityIndex: Number(
          ((standardDeviation / bananaCrystalAvg) * 100).toFixed(2)
        ),
        standardDeviation: Number(standardDeviation.toFixed(6)),
        sampleSize: cleanedRates.length,
      },
    },
  };
}

function calculateCrossRateWithSpread(
  rates: ForexRate["rates"],
  fromCurrency: string,
  toCurrency: string
): RateWithSpread | null {
  try {
    if (rates[fromCurrency] && rates[toCurrency]) {
      const buyRate = rates[toCurrency].buyRate / rates[fromCurrency].sellRate;
      const sellRate = rates[toCurrency].sellRate / rates[fromCurrency].buyRate;
      const spread = sellRate - buyRate;
      const bananaCrystalRate = (buyRate + sellRate) / 2;

      return {
        source: "", // Will be set by the calling function
        buyRate,
        sellRate,
        spread,
        bananaCrystalRate,
      };
    }
    return null;
  } catch (error) {
    console.error("Error calculating cross rate with spread:", error);
    return null;
  }
}

function removeOutliersWithSpread(rates: RateWithSpread[]): RateWithSpread[] {
  if (rates.length <= 2) return rates;

  const buyRateValues = rates.map((r) => r.buyRate);
  const sellRateValues = rates.map((r) => r.sellRate);

  const buyRateMean =
    buyRateValues.reduce((sum, val) => sum + val, 0) / buyRateValues.length;
  const sellRateMean =
    sellRateValues.reduce((sum, val) => sum + val, 0) / sellRateValues.length;

  const buyRateStdDev = Math.sqrt(
    buyRateValues.reduce(
      (sum, val) => sum + Math.pow(val - buyRateMean, 2),
      0
    ) / buyRateValues.length
  );
  const sellRateStdDev = Math.sqrt(
    sellRateValues.reduce(
      (sum, val) => sum + Math.pow(val - sellRateMean, 2),
      0
    ) / sellRateValues.length
  );

  return rates.filter(
    (rate) =>
      Math.abs(rate.buyRate - buyRateMean) <= 2 * buyRateStdDev &&
      Math.abs(rate.sellRate - sellRateMean) <= 2 * sellRateStdDev
  );
}

async function fetchUniRateApi(apiKey: string): Promise<ForexRate> {
  try {
    const response = await axios.get(
      `${FOREX_SOURCES.UNIRATE_API}?api_key=${apiKey}&from=USD`
    );

    const rates: ForexRate["rates"] = {};

    // Process each currency pair from the response
    Object.entries(response.data.rates).forEach(([currency, rateData]) => {
      // UniRate provides a single rate, so we'll add our standard spread
      const baseRate = rateData as number;
      const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;

      rates[currency] = {
        buyRate: baseRate * (1 - halfSpread),
        sellRate: baseRate * (1 + halfSpread),
      };
    });

    return {
      source: "UniRate",
      rates,
      timestamp: Date.now(), // UniRate doesn't provide a timestamp, so we use current time
    };
  } catch (error) {
    console.error("Error fetching from UniRate:", error);
    throw error;
  }
}

app.get("/api/consolidated-rate", async (req, res) => {
  try {
    const { fromCurrency, toCurrency } = RateRequestSchema.parse({
      fromCurrency: req.query.from?.toString().toUpperCase(),
      toCurrency: req.query.to?.toString().toUpperCase(),
    });

    const config: ForexConfig = {
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      currencyFreaksApiKey: process.env.CURRENCY_FREAKS_API_KEY || "",
      fixerApiKey: process.env.FIXER_API_KEY || "",
      unirateApiKey: process.env.UNIRATE_API_KEY || "",
    };

    const rates = await aggregateForexRates(config);
    const consolidatedRate = await calculateConsolidatedRate(
      fromCurrency,
      toCurrency,
      rates
    );

    res.json(consolidatedRate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid currency codes provided" });
    } else {
      res.status(500).json({ error: "Failed to fetch consolidated rate" });
    }
  }
});

app.get("/api/forex-rates", async (req, res) => {
  try {
    const config: ForexConfig = {
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      currencyFreaksApiKey: process.env.CURRENCY_FREAKS_API_KEY || "",
      fixerApiKey: process.env.FIXER_API_KEY || "",
      unirateApiKey: process.env.UNIRATE_API_KEY || "",
    };

    const rates = await aggregateForexRates(config);
    res.json(rates);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch forex rates" });
  }
});

app.listen(port, async () => {
  console.log(`Forex rate aggregator running on port ${port}`);
  // Perform initial update when server starts
  await updateAllRates();
});

app.get("/api/bananacrystal-rate", async (req, res) => {
  try {
    const { fromCurrency, toCurrency } = RateRequestSchema.parse({
      fromCurrency: req.query.from?.toString().toUpperCase(),
      toCurrency: req.query.to?.toString().toUpperCase(),
    });

    const config: ForexConfig = {
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      currencyFreaksApiKey: process.env.CURRENCY_FREAKS_API_KEY || "",
      fixerApiKey: process.env.FIXER_API_KEY || "",
      unirateApiKey: process.env.UNIRATE_API_KEY || "",
    };

    const rates = await aggregateForexRates(config);
    const bananaCrystalRate = await calculateBananaCrystalRate(
      fromCurrency,
      toCurrency,
      rates
    );

    // Store the rate history
    await storeRateHistory(
      fromCurrency,
      toCurrency,
      bananaCrystalRate.bananaCrystalRate,
      bananaCrystalRate.confidence,
      bananaCrystalRate.volatilityIndex
    );

    res.json(bananaCrystalRate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid currency codes provided" });
    } else {
      res.status(500).json({ error: "Failed to fetch BananaCrystal rate" });
    }
  }
});

export default app;
