import axios from 'axios';

interface AIResponse {
    suggestedBid: number;
    suggestedAsk: number;
    explanation: string;
    confidence: number;
}

export class AIService {
    private readonly apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async getSuggestions(currentRate: any, historicalRates: any[]): Promise<AIResponse> {
        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: "claude-3-sonnet-20240229",
                    max_tokens: 1024,
                    messages: [{
                        role: "user",
                        content: `Analyze this forex rate data and suggest optimal bid/ask rates:
                            Current Rate: ${JSON.stringify(currentRate)}
                            Historical Rates: ${JSON.stringify(historicalRates.slice(-5))}
                            
                            Provide response in this JSON format:
                            {
                                "suggestedBid": number,
                                "suggestedAsk": number,
                                "explanation": "brief explanation of suggestion",
                                "confidence": number between 0-1
                            }`
                    }]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01'
                    }
                }
            );

            return JSON.parse(response.data.content[0].text);
        } catch (error) {
            console.error('AI Service Error:', error);
            throw new Error('Failed to get AI suggestions');
        }
    }
}