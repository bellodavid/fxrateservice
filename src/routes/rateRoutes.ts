import { Router, Request, Response, RequestHandler } from 'express';
import { ParsedQs } from 'qs';
import { z } from 'zod';
import { rateService } from '../services/rateService';
import { getForexConfig } from '../constants';

const router = Router();

// Schema for rate request validation
const RateRequestSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
});

// Get consolidated rate for a currency pair
const getConsolidatedRate: RequestHandler = async (req, res, next) => {
  try {
    const { fromCurrency, toCurrency } = RateRequestSchema.parse({
      fromCurrency: req.query.from?.toString().toUpperCase(),
      toCurrency: req.query.to?.toString().toUpperCase(),
    });

    const config = getForexConfig();
    const rates = await rateService.aggregateForexRates(config);
    
    if (!rates || rates.length === 0) {
      res.status(404).json({
        error: "No rates available",
        message: "Could not fetch rates from any provider at this time"
      });
      return;
    }

    const consolidatedRate = await rateService.calculateConsolidatedRate(
      fromCurrency,
      toCurrency,
      rates
    );

    res.json(consolidatedRate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid currency codes provided",
        details: error.errors
      });
    } else {
      console.error('Error fetching consolidated rate:', error);
      res.status(500).json({
        error: "Failed to fetch consolidated rate",
        message: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  }
};

// Get BananaCrystal rate for a currency pair
const getBananaCrystalRate: RequestHandler = async (req, res, next) => {
  try {
    const { fromCurrency, toCurrency } = RateRequestSchema.parse({
      fromCurrency: req.query.from?.toString().toUpperCase(),
      toCurrency: req.query.to?.toString().toUpperCase(),
    });

    const config = getForexConfig();
    const rates = await rateService.aggregateForexRates(config);

    if (!rates || rates.length === 0) {
      res.status(404).json({
        error: "No rates available",
        message: "Could not fetch rates from any provider at this time"
      });
      return;
    }

    const bananaCrystalRate = await rateService.calculateBananaCrystalRate(
      fromCurrency,
      toCurrency,
      rates
    );

    // Store the rate history
    try {
      await rateService.storeRateHistory(
        fromCurrency,
        toCurrency,
        bananaCrystalRate.bananaCrystalRate,
        bananaCrystalRate.confidence,
        bananaCrystalRate.volatilityIndex
      );
    } catch (historyError) {
      // Log but don't fail the request if history storage fails
      console.warn('Failed to store rate history:', historyError);
    }

    res.json(bananaCrystalRate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid currency codes provided",
        details: error.errors
      });
    } else {
      console.error('Error fetching BananaCrystal rate:', error);
      res.status(500).json({
        error: "Failed to fetch BananaCrystal rate",
        message: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  }
};

// Get rate history for a currency pair
const getRateHistory: RequestHandler = async (req, res, next) => {
  try {
    const { fromCurrency, toCurrency } = RateRequestSchema.parse({
      fromCurrency: req.query.from?.toString().toUpperCase(),
      toCurrency: req.query.to?.toString().toUpperCase(),
    });

    const rateHistory = await rateService.getRateHistory(fromCurrency, toCurrency);
    
    if (!rateHistory || rateHistory.length === 0) {
      res.status(404).json({
        error: "No history found",
        message: `No rate history found for ${fromCurrency}/${toCurrency}`
      });
      return;
    }

    res.json(rateHistory);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid currency codes provided",
        details: error.errors
      });
    } else {
      console.error('Error fetching rate history:', error);
      res.status(500).json({
        error: "Failed to fetch rate history",
        message: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  }
};

// Get all forex rates
const getForexRates: RequestHandler = async (req, res, next) => {
  try {
    const config = getForexConfig();
    const rates = await rateService.aggregateForexRates(config);
    
    if (!rates || rates.length === 0) {
      res.status(404).json({
        error: "No rates available",
        message: "Could not fetch rates from any provider at this time"
      });
      return;
    }

    // Filter out sources with empty rates
    const validRates = rates.filter(rate => Object.keys(rate.rates).length > 0);
    
    if (validRates.length === 0) {
      res.status(404).json({
        error: "No valid rates",
        message: "All providers returned empty rates"
      });
      return;
    }

    res.json(validRates);
  } catch (error) {
    console.error('Error fetching forex rates:', error);
    res.status(500).json({
      error: "Failed to fetch forex rates",
      message: error instanceof Error ? error.message : "Unknown error occurred"
    });
  }
};

// Get all BananaCrystal rates
const getAllBananaCrystalRates: RequestHandler = async (req, res, next) => {
  try {
    const config = getForexConfig();
    const rates = await rateService.aggregateForexRates(config);
    
    if (!rates || rates.length === 0) {
      res.status(404).json({
        error: "No rates available",
        message: "Could not fetch rates from any provider at this time"
      });
      return;
    }

    const allRates = await rateService.getAllBananaCrystalRates(rates);
    res.json(allRates);
  } catch (error) {
    console.error('Error fetching all BananaCrystal rates:', error);
    res.status(500).json({
      error: "Failed to fetch all BananaCrystal rates",
      message: error instanceof Error ? error.message : "Unknown error occurred"
    });
  }
};

// Register routes
router.get('/consolidated-rate', getConsolidatedRate);
router.get('/bananacrystal-rate', getBananaCrystalRate);
router.get('/rate-history', getRateHistory);
router.get('/forex-rates', getForexRates);
router.get('/all-bananacrystal-rates', getAllBananaCrystalRates);

export default router;
