import axios from 'axios';
import { DOMParser } from 'xmldom';
import { createClient } from '@supabase/supabase-js';
import config from '../config';
import {
  ForexRate,
  ForexConfig,
  RateHistory,
  BananaCrystalRate,
  ConsolidatedRate,
  RateWithSpread,
  AllBananaCrystalRates
} from '../types';
import {
  FOREX_SOURCES,
  SPREAD_CONFIG,
  BASE_CURRENCY,
  MAJOR_CURRENCIES,
} from '../constants';
import {
  calculateCrossRateWithSpread,
  removeOutliersWithSpread,
  calculateSpread,
  formatRate,
  calculateConfidenceScore,
  calculateVolatilityIndex,
  handleApiError
} from '../utils';
import { apiService } from './apiService';

export class RateService {
  private static instance: RateService;
  private parser: DOMParser;
  private supabase;

  private constructor() {
    this.parser = new DOMParser();
    
    if (!config.supabase.url || !config.supabase.anonKey) {
      console.warn('Supabase credentials not found. Rate history features will be disabled.');
      this.supabase = null;
    } else {
      this.supabase = createClient(config.supabase.url, config.supabase.anonKey);
    }
  }

  public static getInstance(): RateService {
    if (!RateService.instance) {
      RateService.instance = new RateService();
    }
    return RateService.instance;
  }

  async aggregateForexRates(config: ForexConfig): Promise<ForexRate[]> {
    const results = await Promise.allSettled([
      // Free APIs
      apiService.fetchExchangeRateAPI(),
      apiService.fetchFrankfurter(),
      apiService.fetchCurrencyAPI(),
      apiService.fetchExchangeRateHost(),
      apiService.fetchFloatRates(),
      apiService.fetchFxJsApi(),
      apiService.fetchNbpApi(),
      apiService.fetchCnbApi(),
      apiService.fetchBocApi(),
      apiService.fetchEcbApi(),
      apiService.fetchCbrApi(),
      apiService.fetchSnbApi(),

      // APIs requiring keys
      apiService.fetchOpenExchangeRates(config.openExchangeRatesApiKey),
      apiService.fetchCurrencyLayer(config.currencyLayerApiKey),
      //apiService.fetchCurrencyFreaks(config.currencyFreaksApiKey),
      apiService.fetchFixerIO(config.fixerApiKey),
      apiService.fetchUniRateApi(config.unirateApiKey),
      apiService.fetchCurrencyBeacon(config.currencyBeaconApiKey),
      apiService.fetchMarketStack(config.marketStackApiKey),
      apiService.fetchXeApi(config.xeApiId, config.xeApiKey),
      apiService.fetchFxApi(config.fxApiKey)
    ]);

    const rates = results
      .filter((result): result is PromiseFulfilledResult<ForexRate> =>
        result.status === "fulfilled" && Object.keys(result.value.rates).length > 0
      )
      .map((result) => result.value);

    if (rates.length === 0) {
      console.warn('No valid rates received from any source');
      return [];
    }

    try {
      const bananaCrystalRates = await apiService.fetchBananaCrystalRates(rates);
      return [...rates, bananaCrystalRates];
    } catch (error) {
      console.error('Failed to calculate BananaCrystal rates:', error);
      return rates;
    }
  }

  async calculateBananaCrystalRate(
    fromCurrency: string,
    toCurrency: string,
    rates: ForexRate[]
  ): Promise<BananaCrystalRate> {
    const validRates = rates
      .map((source) => {
        const rate = calculateCrossRateWithSpread(source.rates, fromCurrency, toCurrency);
        if (rate !== null) {
          return {
            source: source.source,
            rate: (rate.buyRate + rate.sellRate) / 2,
            weight: 1,
          };
        }
        return null;
      })
      .filter((rate): rate is { source: string; rate: number; weight: number } => rate !== null);

    if (validRates.length === 0) {
      throw new Error(`No valid rates found for ${fromCurrency}/${toCurrency}`);
    }

    const totalWeight = validRates.reduce((sum, rate) => sum + rate.weight, 0);
    const weightedSum = validRates.reduce((sum, rate) => sum + rate.rate * rate.weight, 0);
    const weightedAverage = weightedSum / totalWeight;
    const standardDeviation = Math.sqrt(
      validRates.reduce((sum, rate) => sum + Math.pow(rate.rate - weightedAverage, 2) * rate.weight, 0) / totalWeight
    );

    const confidenceScore = calculateConfidenceScore(standardDeviation, weightedAverage);
    const volatilityIndex = calculateVolatilityIndex(standardDeviation, weightedAverage);

    return {
      fromCurrency,
      toCurrency,
      bananaCrystalRate: formatRate(weightedAverage),
      confidence: confidenceScore,
      volatilityIndex,
      metadata: {
        sourcesUsed: validRates.map((r) => r.source),
        timestamp: Date.now(),
        standardDeviation: formatRate(standardDeviation),
        sampleSize: validRates.length,
        individualRates: validRates.map((r) => ({
          source: r.source,
          rate: formatRate(r.rate),
          weight: r.weight,
        })),
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  async calculateConsolidatedRate(
    fromCurrency: string,
    toCurrency: string,
    rates: ForexRate[]
  ): Promise<ConsolidatedRate> {
    const validRates: RateWithSpread[] = rates
      .map((source) => {
        const rate = calculateCrossRateWithSpread(source.rates, fromCurrency, toCurrency);
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
    const avgBuyRate = formatRate(
      cleanedRates.reduce((sum, rate) => sum + rate.buyRate, 0) / cleanedRates.length
    );
    const avgSellRate = formatRate(
      cleanedRates.reduce((sum, rate) => sum + rate.sellRate, 0) / cleanedRates.length
    );
    const spread = formatRate(avgSellRate - avgBuyRate);
    const spreadPercentage = formatRate((spread / avgBuyRate) * 100);

    const bananaCrystalRates = cleanedRates.map((r) => r.bananaCrystalRate);
    const bananaCrystalAvg = formatRate(
      bananaCrystalRates.reduce((sum, rate) => sum + rate, 0) / bananaCrystalRates.length
    );
    const standardDeviation = Math.sqrt(
      bananaCrystalRates.reduce((sum, rate) => sum + Math.pow(rate - bananaCrystalAvg, 2), 0) /
        bananaCrystalRates.length
    );

    return {
      fromCurrency,
      toCurrency,
      buyRate: avgBuyRate,
      sellRate: avgSellRate,
      spread,
      spreadPercentage,
      bananaCrystalRate: bananaCrystalAvg,
      bananaCrystalConfidence: calculateConfidenceScore(standardDeviation, bananaCrystalAvg),
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
          volatilityIndex: calculateVolatilityIndex(standardDeviation, bananaCrystalAvg),
          standardDeviation: formatRate(standardDeviation),
          sampleSize: cleanedRates.length,
        },
      },
    };
  }

  // Rate history methods
  async storeRateHistory(
    fromCurrency: string,
    toCurrency: string,
    bananaCrystalRate: number,
    confidence: number,
    volatilityIndex: number
  ): Promise<void> {
    try {
      const rateHistory = await this.getRateHistory(fromCurrency, toCurrency);
      const isStationary = this.determineRateStationarity(rateHistory);

      if (!this.supabase) {
        console.warn('Supabase client not initialized. Skipping rate history storage.');
        return;
      }
      
      const { error } = await this.supabase.from("rate_history").insert([
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
      handleApiError(error, "storeRateHistory");
      throw error;
    }
  }

  async getRateHistory(
    fromCurrency: string,
    toCurrency: string
  ): Promise<RateHistory[]> {
    try {
      if (!this.supabase) {
        console.warn('Supabase client not initialized. Returning empty rate history.');
        return [];
      }
      
      const { data, error } = await this.supabase
        .from("rate_history")
        .select("*")
        .eq("from_currency", fromCurrency)
        .eq("to_currency", toCurrency)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data || [];
    } catch (error) {
      handleApiError(error, "getRateHistory");
      throw error;
    }
  }

  async storeAllBananaCrystalRates(rates: AllBananaCrystalRates): Promise<void> {
    try {
      if (!this.supabase) {
        console.warn('Supabase client not initialized. Skipping rate storage.');
        return;
      }

      // Store each currency rate
      for (const [currency, rate] of Object.entries(rates.rates)) {
        // Get history for this currency
        const { data: history, error: historyError } = await this.supabase
          .from("all_bananacrystal_rates")
          .select("*")
          .eq("currency", currency)
          .order("created_at", { ascending: false })
          .limit(20);

        if (historyError) throw historyError;

        // Calculate stationarity if we have enough history
        let isStationary = false;
        if (history && history.length >= 2) {
          const rateChanges = history
            .slice(0, -1)
            .map((record, index) => 
              Math.abs((record.buy_rate + record.sell_rate) / 2 - 
                      (history[index + 1].buy_rate + history[index + 1].sell_rate) / 2)
            );
          const avgChange = rateChanges.reduce((sum, change) => sum + change, 0) / rateChanges.length;
          isStationary = avgChange < 0.001;
        }

        // Insert new record
        const { error: insertError } = await this.supabase
          .from("all_bananacrystal_rates")
          .insert([{
            currency,
            buy_rate: rate.buyRate,
            sell_rate: rate.sellRate,
            confidence: rate.confidence,
            volatility_index: rate.volatilityIndex,
            is_stationary: isStationary
          }]);

        if (insertError) throw insertError;

        // If we have more than 20 records, delete the oldest ones
        if (history && history.length >= 20) {
          const oldestToKeep = history[18].created_at; // Keep 19 old + 1 new = 20 total
          const { error: deleteError } = await this.supabase
            .from("all_bananacrystal_rates")
            .delete()
            .eq("currency", currency)
            .lt("created_at", oldestToKeep);

          if (deleteError) throw deleteError;
        }
      }
    } catch (error) {
      handleApiError(error, "storeAllBananaCrystalRates");
      throw error;
    }
  }

  async getAllBananaCrystalRates(rates: ForexRate[]): Promise<AllBananaCrystalRates> {
    const startTime = Date.now();
    const currencyPairs = new Set<string>();
    const bananaCrystalRates: AllBananaCrystalRates['rates'] = {};
    const sourcesUsed = new Set<string>();
    const supportedCurrencies = new Set<string>();

    // Get all available currencies and the last rate source (BananaCrystal rates)
    const lastSource = rates[rates.length - 1];
    rates.forEach(source => {
      Object.keys(source.rates).forEach(currency => supportedCurrencies.add(currency));
      sourcesUsed.add(source.source);
    });

    // Get all currencies except USD
    supportedCurrencies.forEach(currency => {
      if (currency !== BASE_CURRENCY) {
        currencyPairs.add(currency);
      }
    });

    // Calculate rates for each currency
    for (const currency of currencyPairs) {
      try {
        // Get rates from the last source (BananaCrystal rates)
        const rate = lastSource.rates[currency];
        if (rate) {
          // Calculate BananaCrystal rate for confidence and volatility
          const bananaCrystalRate = await this.calculateBananaCrystalRate(BASE_CURRENCY, currency, rates);

          bananaCrystalRates[currency] = {
            buyRate: rate.buyRate,
            sellRate: rate.sellRate,
            confidence: bananaCrystalRate.confidence,
            volatilityIndex: bananaCrystalRate.volatilityIndex
          };
        }
      } catch (error) {
        console.warn(`Failed to calculate rate for ${currency}:`, error);
      }
    }

    return {
      timestamp: Date.now(),
      base: BASE_CURRENCY,
      rates: bananaCrystalRates,
      metadata: {
        sourcesUsed: Array.from(sourcesUsed),
        totalPairs: Object.keys(bananaCrystalRates).length,
        updateDuration: Date.now() - startTime,
        baseCurrency: BASE_CURRENCY,
        supportedCurrencies: Array.from(supportedCurrencies)
      }
    };
  }

  private determineRateStationarity(rateHistory: RateHistory[]): boolean {
    if (rateHistory.length < 2) return true;

    const rateChanges = rateHistory
      .slice(0, -1)
      .map((rate, index) =>
        Math.abs(rate.banana_crystal_rate - rateHistory[index + 1].banana_crystal_rate)
      );

    const avgChange = rateChanges.reduce((sum, change) => sum + change, 0) / rateChanges.length;
    return avgChange < 0.001;
  }
}

export const rateService = RateService.getInstance();
