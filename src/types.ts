// Enhanced types to include buyRate/sellRate
export interface ForexRate {
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

export interface ForexConfig {
    openExchangeRatesApiKey: string;
    currencyLayerApiKey: string;
    currencyFreaksApiKey: string;
    fixerApiKey: string;
    unirateApiKey: string;
    alphaVantageApiKey: string;
  }

export interface RateWithSpread {
  source: string;
  buyRate: number;
  sellRate: number;
  spread: number;
  bananaCrystalRate: number;
}

// Types for rate history
export interface RateHistory {
  id: number;
  from_currency: string;
  to_currency: string;
  banana_crystal_rate: number;
  confidence: number;
  volatility_index: number;
  is_stationary: boolean;
  created_at: string;
}

export interface AllBananaCrystalRates {
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
export interface ConsolidatedRate {
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

export interface BananaCrystalRate {
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