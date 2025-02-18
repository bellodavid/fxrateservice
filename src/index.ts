import express from "express";
import axios from "axios";
import { z } from "zod";
import pool from "./db";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

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

interface RateWithSpread {
  source: string;
  buyRate: number;
  sellRate: number;
  spread: number;
  bananaCrystalRate: number;
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
  EXCHANGERATE_API: "https://api.exchangerate-api.com/v4/latest/USD",
  FIXER_IO: "http://data.fixer.io/api/latest",
  OPEN_EXCHANGE_RATES: "https://openexchangerates.org/api/latest.json",
  CURRENCY_LAYER: "http://api.currencylayer.com/live",
  ALPHA_VANTAGE:
    "https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE",
};

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

async function fetchExchangeRateAPI(): Promise<ForexRate> {
  try {
    const response = await axios.get(FOREX_SOURCES.EXCHANGERATE_API);
    // Convert single rate to buyRate/sellRate with default spread
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
      source: "ExchangeRate-API",
      rates,
      timestamp: new Date(response.data.time_last_updated * 1000).getTime(),
    };
  } catch (error) {
    console.error("Error fetching from ExchangeRate-API:", error);
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

async function aggregateForexRates(config: {
  fixerApiKey: string;
  openExchangeRatesApiKey: string;
  currencyLayerApiKey: string;
  alphaVantageApiKey: string;
}): Promise<ForexRate[]> {
  try {
    const results = await Promise.allSettled([
      fetchExchangeRateAPI(),
      fetchFixerIO(config.fixerApiKey),
      fetchOpenExchangeRates(config.openExchangeRatesApiKey),
      fetchCurrencyLayer(config.currencyLayerApiKey),
      fetchAlphaVantage(config.alphaVantageApiKey, "USD", "EUR"),
    ]);

    const rates = results
      .filter(
        (result): result is PromiseFulfilledResult<ForexRate> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value);

    // Add BananaCrystal rates
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

app.get("/api/consolidated-rate", async (req, res) => {
  try {
    const { fromCurrency, toCurrency } = RateRequestSchema.parse({
      fromCurrency: req.query.from?.toString().toUpperCase(),
      toCurrency: req.query.to?.toString().toUpperCase(),
    });

    const config = {
      fixerApiKey: process.env.FIXER_API_KEY || "",
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || "",
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
    const config = {
      fixerApiKey: process.env.FIXER_API_KEY || "",
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || "",
    };

    const rates = await aggregateForexRates(config);
    res.json(rates);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch forex rates" });
  }
});

app.listen(port, () => {
  console.log(`Forex rate aggregator running on port ${port}`);
});

app.get("/api/bananacrystal-rate", async (req, res) => {
  try {
    const { fromCurrency, toCurrency } = RateRequestSchema.parse({
      fromCurrency: req.query.from?.toString().toUpperCase(),
      toCurrency: req.query.to?.toString().toUpperCase(),
    });

    const config = {
      fixerApiKey: process.env.FIXER_API_KEY || "",
      openExchangeRatesApiKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || "",
      currencyLayerApiKey: process.env.CURRENCY_LAYER_API_KEY || "",
      alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || "",
    };

    const rates = await aggregateForexRates(config);
    const bananaCrystalRate = await calculateBananaCrystalRate(
      fromCurrency,
      toCurrency,
      rates
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
