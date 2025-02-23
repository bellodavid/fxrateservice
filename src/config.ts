import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'FIXER_API_KEY',
  'OPEN_EXCHANGE_RATES_API_KEY',
  'CURRENCY_LAYER_API_KEY',
  'ALPHA_VANTAGE_API_KEY',
  'CURRENCY_FREAKS_API_KEY',
  'UNIRATE_API_KEY',
  'CURRENCY_BEACON_API_KEY',
  'MARKET_STACK_API_KEY',
  'XE_API_ID',
  'XE_API_KEY',
  'FX_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`Warning: ${envVar} is not set in environment variables`);
  }
}

interface Config {
  port: number;
  nodeEnv: string;
  supabase: {
    url: string;
    anonKey: string;
  };
  database: {
    host: string;
    url: string;
    name: string;
    poolMode: string;
    user: string;
    password: string;
    port: number;
  };
  apis: {
    fixerKey: string;
    openExchangeRatesKey: string;
    currencyLayerKey: string;
    alphaVantageKey: string;
    currencyFreaksKey: string;
    coinLayerKey: string;
    unirateKey: string;
    currencyBeaconKey: string;
    marketStackKey: string;
    xeApiId: string;
    xeApiKey: string;
    fxApiKey: string;
  };
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },
  database: {
    host: process.env.POSTGRES_HOST || '',
    url: process.env.DATABASE_URL || '',
    name: process.env.POSTGRES_DATABASE || '',
    poolMode: process.env.POOL_MODE || '',
    user: process.env.POSTGRES_USER || '',
    password: process.env.POSTGRES_PASSWORD || '',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  },
  apis: {
    fixerKey: process.env.FIXER_API_KEY || '',
    openExchangeRatesKey: process.env.OPEN_EXCHANGE_RATES_API_KEY || '',
    currencyLayerKey: process.env.CURRENCY_LAYER_API_KEY || '',
    alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY || '',
    currencyFreaksKey: process.env.CURRENCY_FREAKS_API_KEY || '',
    coinLayerKey: process.env.COIN_LAYER || '',
    unirateKey: process.env.UNIRATE_API_KEY || '',
    currencyBeaconKey: process.env.CURRENCY_BEACON_API_KEY || '',
    marketStackKey: process.env.MARKET_STACK_API_KEY || '',
    xeApiId: process.env.XE_API_ID || '',
    xeApiKey: process.env.XE_API_KEY || '',
    fxApiKey: process.env.FX_API_KEY || '',
  },
};

export default config;
