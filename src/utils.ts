import { ForexRate, RateWithSpread } from './types';
import { SPREAD_CONFIG } from './constants';

export function calculateCrossRateWithSpread(
  rates: ForexRate['rates'],
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
        source: "",
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

export function removeOutliersWithSpread(rates: RateWithSpread[]): RateWithSpread[] {
  if (rates.length <= 2) return rates;

  const buyRateValues = rates.map((r) => r.buyRate);
  const sellRateValues = rates.map((r) => r.sellRate);

  const buyRateMean = calculateMean(buyRateValues);
  const sellRateMean = calculateMean(sellRateValues);

  const buyRateStdDev = calculateStandardDeviation(buyRateValues, buyRateMean);
  const sellRateStdDev = calculateStandardDeviation(sellRateValues, sellRateMean);

  return rates.filter(
    (rate) =>
      Math.abs(rate.buyRate - buyRateMean) <= 2 * buyRateStdDev &&
      Math.abs(rate.sellRate - sellRateMean) <= 2 * sellRateStdDev
  );
}

export function calculateMean(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

export function calculateStandardDeviation(values: number[], mean: number): number {
  return Math.sqrt(
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  );
}

export function calculateSpread(baseRate: number): {
  buyRate: number;
  sellRate: number;
} {
  const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
  return {
    buyRate: baseRate * (1 - halfSpread),
    sellRate: baseRate * (1 + halfSpread),
  };
}

export function formatRate(rate: number): number {
  return Number(rate.toFixed(6));
}

export function calculateConfidenceScore(
  standardDeviation: number,
  mean: number
): number {
  return Number(
    Math.min(100, (1 - standardDeviation / mean) * 100).toFixed(2)
  );
}

export function calculateVolatilityIndex(
  standardDeviation: number,
  mean: number
): number {
  return Number(((standardDeviation / mean) * 100).toFixed(2));
}

export function isValidCurrencyPair(fromCurrency: string, toCurrency: string): boolean {
  return (
    typeof fromCurrency === 'string' &&
    typeof toCurrency === 'string' &&
    fromCurrency.length === 3 &&
    toCurrency.length === 3
  );
}

export function handleApiError(error: unknown, source: string): void {
  if (error instanceof Error) {
    console.error(`Error fetching from ${source}:`, error.message);
  } else {
    console.error(`Unknown error from ${source}:`, error);
  }
}
