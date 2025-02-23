import axios from 'axios';
import { DOMParser } from 'xmldom';
import { ForexRate } from '../types';
import { FOREX_SOURCES, SPREAD_CONFIG, MAJOR_CURRENCIES } from '../constants';
import { calculateSpread, handleApiError } from '../utils';

export class ApiService {
  private static instance: ApiService;
  private parser: DOMParser;

  private constructor() {
    this.parser = new DOMParser();
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  // Additional API providers
  async fetchUniRateApi(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.UNIRATE_API}?api_key=${apiKey}&from=USD`);
      const rates: ForexRate['rates'] = {};

      Object.entries(response.data.rates).forEach(([currency, rateData]) => {
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
        timestamp: Date.now(),
      };
    } catch (error) {
      console.warn('UniRate error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "UniRate",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchNbpApi(): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.NBP_API}?format=json`);
      const rates: ForexRate['rates'] = {};

      const usdRate = response.data[0].rates.find((r: any) => r.code === "USD")?.mid || 1;

      response.data[0].rates.forEach((rateData: any) => {
        const baseRate = 1 / (rateData.mid / usdRate);
        const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
        rates[rateData.code] = {
          buyRate: baseRate * (1 - halfSpread),
          sellRate: baseRate * (1 + halfSpread),
        };
      });

      rates["PLN"] = {
        buyRate: (1 / usdRate) * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
        sellRate: (1 / usdRate) * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      };

      return {
        source: "NbpApi",
        rates,
        timestamp: new Date(response.data[0].effectiveDate).getTime(),
      };
    } catch (error) {
      console.warn('NbpApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "NbpApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchCnbApi(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.CNB_API);
      const lines = response.data.split("\n");
      const dateString = lines[0].split("#")[0].trim();
      const rateLines = lines.slice(2).filter(Boolean);

      const rates: ForexRate['rates'] = {};
      let usdRate = 1;

      for (const line of rateLines) {
        const [country, currency, amount, code, rate] = line.split("|");
        if (code === "USD") {
          usdRate = parseFloat(rate) / parseFloat(amount);
          break;
        }
      }

      for (const line of rateLines) {
        const [country, currency, amount, code, rate] = line.split("|");
        if (code && rate) {
          const baseRate = 1 / (parseFloat(rate) / parseFloat(amount) / usdRate);
          const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
          rates[code] = {
            buyRate: baseRate * (1 - halfSpread),
            sellRate: baseRate * (1 + halfSpread),
          };
        }
      }

      rates["CZK"] = {
        buyRate: (1 / usdRate) * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
        sellRate: (1 / usdRate) * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      };

      return {
        source: "CnbApi",
        rates,
        timestamp: new Date(dateString).getTime(),
      };
    } catch (error) {
      console.warn('CnbApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "CnbApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchBocApi(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.BOC_API);
      const rates: ForexRate['rates'] = {};

      const latestDate = response.data.observations[response.data.observations.length - 1].d;
      const latestRates = response.data.observations[response.data.observations.length - 1];
      const usdCadRate = 1 / parseFloat(latestRates.FXUSDCAD.v);

      Object.entries(latestRates).forEach(([code, value]) => {
        if (code !== "d" && code.startsWith("FX")) {
          const currencyCode = code.substring(6);
          if (currencyCode && currencyCode.length === 3) {
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

      rates["CAD"] = {
        buyRate: usdCadRate * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
        sellRate: usdCadRate * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      };

      return {
        source: "BocApi",
        rates,
        timestamp: new Date(latestDate).getTime(),
      };
    } catch (error) {
      console.warn('BocApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "BocApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchExchangeRateAPI(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.EXCHANGERATE_API, {
        timeout: 5000, // 5 second timeout
        validateStatus: (status) => status === 200 // Only accept 200 status
      });

      if (!response.data || !response.data.quotes) {
        console.warn('ExchangeRate-API: Invalid response format');
        return {
          source: "ExchangeRate-API",
          rates: {},
          timestamp: Date.now(),
        };
      }

      const rates: ForexRate['rates'] = {};
      Object.entries(response.data.quotes).forEach(([currencyPair, rate]) => {
        if (typeof rate === 'number' && !isNaN(rate)) {
          const currency = currencyPair.substring(3);
          rates[currency] = calculateSpread(rate);
        }
      });

      return {
        source: "ExchangeRate-API",
        rates,
        timestamp: new Date(response.data.time_last_updated * 1000).getTime(),
      };
    } catch (error) {
      console.warn('ExchangeRate-API error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "ExchangeRate-API",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchFrankfurter(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.FRANKFURTER);
      const rates: ForexRate['rates'] = {};
      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "Frankfurter",
        rates,
        timestamp: new Date(response.data.date).getTime(),
      };
    } catch (error) {
      console.warn('Frankfurter error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "Frankfurter",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchCurrencyAPI(): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.CURRENCY_API}/currencies/usd.json`);
      const rates: ForexRate['rates'] = {};
      Object.entries(response.data.usd).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency.toUpperCase()] = calculateSpread(baseRate);
      });

      return {
        source: "Currency-API",
        rates,
        timestamp: new Date(response.data.date).getTime(),
      };
    } catch (error) {
      console.warn('Currency-API error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "Currency-API",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchExchangeRateHost(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.EXCHANGE_RATE_HOST);
      const rates: ForexRate['rates'] = {};

      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        if (typeof rate === "number") {
          rates[currency] = calculateSpread(rate);
        }
      });

      return {
        source: "ExchangeRate.host",
        rates,
        timestamp: response.data.date ? new Date(response.data.date).getTime() : Date.now(),
      };
    } catch (error) {
      console.warn('ExchangeRate.host error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "ExchangeRate.host",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchOpenExchangeRates(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.OPEN_EXCHANGE_RATES}?app_id=${apiKey}`);
      const rates: ForexRate['rates'] = {};
      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "OpenExchangeRates",
        rates,
        timestamp: new Date(response.data.timestamp * 1000).getTime(),
      };
    } catch (error) {
      console.warn('OpenExchangeRates error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "OpenExchangeRates",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchCurrencyLayer(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.CURRENCY_LAYER}?access_key=${apiKey}`);
      const rates: ForexRate['rates'] = {};
      Object.entries(response.data.quotes).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "CurrencyLayer",
        rates,
        timestamp: new Date(response.data.timestamp * 1000).getTime(),
      };
    } catch (error) {
      console.warn('CurrencyLayer error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "CurrencyLayer",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchCurrencyFreaks(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.CURRENCY_FREAKS}?apikey=${apiKey}`);
      const rates: ForexRate['rates'] = {};
      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "CurrencyFreaks",
        rates,
        timestamp: new Date(response.data.date).getTime(),
      };
    } catch (error) {
      console.warn('CurrencyFreaks error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "CurrencyFreaks",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchFixerIO(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.FIXER_IO}?access_key=${apiKey}`);
      const rates: ForexRate['rates'] = {};
      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "Fixer.io",
        rates,
        timestamp: new Date(response.data.timestamp * 1000).getTime(),
      };
    } catch (error) {
      console.warn('Fixer.io error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "Fixer.io",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchFloatRates(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.FLOAT_RATES);
      const rates: ForexRate['rates'] = {};

      Object.entries(response.data).forEach(([currency, data]) => {
        const rateData = data as any;
        rates[currency.toUpperCase()] = calculateSpread(rateData.rate);
      });

      return {
        source: "FloatRates",
        rates,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.warn('FloatRates error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "FloatRates",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchFxJsApi(): Promise<ForexRate> {
    try {
      const today = new Date().toISOString().split("T")[0];
      const response = await axios.get(`${FOREX_SOURCES.FX_JS_API}?base=USD&date=${today}`);
      const rates: ForexRate['rates'] = {};

      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "FxJsApi",
        rates,
        timestamp: new Date(response.data.date).getTime(),
      };
    } catch (error) {
      console.warn('FxJsApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "FxJsApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchEcbApi(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.ECB_API);
      const xmlDoc = this.parser.parseFromString(response.data, 'text/xml');
      const rates: ForexRate['rates'] = {};

      const cubes = xmlDoc.getElementsByTagName('Cube');
      let eurUsdRate = 1;

      // Find EUR/USD rate first to convert all rates to USD base
      for (let i = 0; i < cubes.length; i++) {
        const cube = cubes[i];
        const currency = cube.getAttribute('currency');
        const rate = cube.getAttribute('rate');
        
        if (currency === 'USD' && rate) {
          eurUsdRate = parseFloat(rate);
          break;
        }
      }

      // Convert all rates to USD base
      for (let i = 0; i < cubes.length; i++) {
        const cube = cubes[i];
        const currency = cube.getAttribute('currency');
        const rate = cube.getAttribute('rate');
        
        if (currency && rate) {
          const usdRate = parseFloat(rate) / eurUsdRate;
          const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
          rates[currency] = {
            buyRate: usdRate * (1 - halfSpread),
            sellRate: usdRate * (1 + halfSpread),
          };
        }
      }

      // Add EUR rate
      rates['EUR'] = {
        buyRate: (1 / eurUsdRate) * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
        sellRate: (1 / eurUsdRate) * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      };

      return {
        source: "EcbApi",
        rates,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.warn('EcbApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "EcbApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchCbrApi(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.CBR_API);
      const xmlDoc = this.parser.parseFromString(response.data, 'text/xml');
      const rates: ForexRate['rates'] = {};

      const valutas = xmlDoc.getElementsByTagName('Valute');
      let usdRate = 1;

      // Find USD rate first
      for (let i = 0; i < valutas.length; i++) {
        const valuta = valutas[i];
        const charCode = valuta.getElementsByTagName('CharCode')[0]?.textContent;
        if (charCode === 'USD') {
          const nominal = parseFloat(valuta.getElementsByTagName('Nominal')[0]?.textContent || '1');
          const value = parseFloat(valuta.getElementsByTagName('Value')[0]?.textContent?.replace(',', '.') || '0');
          usdRate = value / nominal;
          break;
        }
      }

      // Process all rates
      for (let i = 0; i < valutas.length; i++) {
        const valuta = valutas[i];
        const charCode = valuta.getElementsByTagName('CharCode')[0]?.textContent;
        if (charCode) {
          const nominal = parseFloat(valuta.getElementsByTagName('Nominal')[0]?.textContent || '1');
          const value = parseFloat(valuta.getElementsByTagName('Value')[0]?.textContent?.replace(',', '.') || '0');
          const rate = (value / nominal) / usdRate;
          
          const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
          rates[charCode] = {
            buyRate: rate * (1 - halfSpread),
            sellRate: rate * (1 + halfSpread),
          };
        }
      }

      // Add RUB rate
      rates['RUB'] = {
        buyRate: (1 / usdRate) * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
        sellRate: (1 / usdRate) * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      };

      return {
        source: "CbrApi",
        rates,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.warn('CbrApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "CbrApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchCurrencyBeacon(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.CURRENCY_BEACON}?api_key=${apiKey}&base=USD`);
      const rates: ForexRate['rates'] = {};

      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "CurrencyBeacon",
        rates,
        timestamp: new Date(response.data.timestamp * 1000).getTime(),
      };
    } catch (error) {
      console.warn('CurrencyBeacon error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "CurrencyBeacon",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchMarketStack(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.MARKET_STACK}?access_key=${apiKey}&base=USD`);
      const rates: ForexRate['rates'] = {};

      response.data.data.forEach((exchange: any) => {
        if (exchange.currency && exchange.rate) {
          rates[exchange.currency] = calculateSpread(exchange.rate);
        }
      });

      return {
        source: "MarketStack",
        rates,
        timestamp: new Date(response.data.timestamp).getTime(),
      };
    } catch (error) {
      console.warn('MarketStack error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "MarketStack",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchXeApi(apiId: string, apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.XE_API, {
        auth: {
          username: apiId,
          password: apiKey
        },
        params: {
          from: 'USD',
          to: MAJOR_CURRENCIES.join(',')
        }
      });

      const rates: ForexRate['rates'] = {};
      response.data.to.forEach((rate: any) => {
        rates[rate.quotecurrency] = calculateSpread(rate.mid);
      });

      return {
        source: "XeApi",
        rates,
        timestamp: new Date(response.data.timestamp).getTime(),
      };
    } catch (error) {
      console.warn('XeApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "XeApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchFxApi(apiKey: string): Promise<ForexRate> {
    try {
      const response = await axios.get(`${FOREX_SOURCES.FX_API}?api_key=${apiKey}&base=USD`);
      const rates: ForexRate['rates'] = {};

      Object.entries(response.data.rates).forEach(([currency, rate]) => {
        const baseRate = rate as number;
        rates[currency] = calculateSpread(baseRate);
      });

      return {
        source: "FxApi",
        rates,
        timestamp: new Date(response.data.timestamp * 1000).getTime(),
      };
    } catch (error) {
      console.warn('FxApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "FxApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchSnbApi(): Promise<ForexRate> {
    try {
      const response = await axios.get(FOREX_SOURCES.SNB_API);
      const xmlDoc = this.parser.parseFromString(response.data, 'text/xml');
      const rates: ForexRate['rates'] = {};

      const items = xmlDoc.getElementsByTagName('item');
      let usdRate = 1;

      // Find USD rate first
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const title = item.getElementsByTagName('title')[0]?.textContent;
        if (title?.includes('USD')) {
          const rateMatch = title.match(/(\d+\.?\d*)/);
          if (rateMatch) {
            usdRate = parseFloat(rateMatch[1]);
            break;
          }
        }
      }

      // Process all rates
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const title = item.getElementsByTagName('title')[0]?.textContent;
        if (title) {
          const currencyMatch = title.match(/[A-Z]{3}/);
          const rateMatch = title.match(/(\d+\.?\d*)/);
          
          if (currencyMatch && rateMatch) {
            const currency = currencyMatch[0];
            const rate = parseFloat(rateMatch[1]) / usdRate;
            
            const halfSpread = SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2;
            rates[currency] = {
              buyRate: rate * (1 - halfSpread),
              sellRate: rate * (1 + halfSpread),
            };
          }
        }
      }

      // Add CHF rate
      rates['CHF'] = {
        buyRate: (1 / usdRate) * (1 - SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
        sellRate: (1 / usdRate) * (1 + SPREAD_CONFIG.DEFAULT_SPREAD_PIPS / 10000 / 2),
      };

      return {
        source: "SnbApi",
        rates,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.warn('SnbApi error:', error instanceof Error ? error.message : 'Unknown error');
      return {
        source: "SnbApi",
        rates: {},
        timestamp: Date.now(),
      };
    }
  }

  async fetchBananaCrystalRates(rates: ForexRate[]): Promise<ForexRate> {
    const aggregatedRates: ForexRate['rates'] = {};
    const allCurrencies = new Set<string>();
    
    rates.forEach((source) => {
      Object.keys(source.rates).forEach((currency) => allCurrencies.add(currency));
    });

    allCurrencies.forEach((currency) => {
      const validRates = rates
        .filter((source) => source.rates[currency])
        .map((source) => source.rates[currency]);

      if (validRates.length > 0) {
        const avgBuyRate = validRates.reduce((sum, rate) => sum + rate.buyRate, 0) / validRates.length;
        const avgSellRate = validRates.reduce((sum, rate) => sum + rate.sellRate, 0) / validRates.length;

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
}

export const apiService = ApiService.getInstance();
