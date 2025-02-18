interface StoredRate {
    fromCurrency: string;
    toCurrency: string;
    bid: number;
    ask: number;
    timestamp: number;
}

export class RateStorage {
    private rates: StoredRate[] = [];
    private readonly maxStorageSize = 100;

    addRate(rate: StoredRate) {
        this.rates.push(rate);
        if (this.rates.length > this.maxStorageSize) {
            this.rates.shift();
        }
    }

    getHistory(fromCurrency: string, toCurrency: string): StoredRate[] {
        return this.rates.filter(
            rate => rate.fromCurrency === fromCurrency && 
                   rate.toCurrency === toCurrency
        );
    }
}