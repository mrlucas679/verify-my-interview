import scamKeywords from '../../data/scamKeywords.json';

export interface ScamAnalysisResult {
  score: number; // 0-100
  foundKeywords: string[];
  error?: string;
}

export class NLPScamDetectionService {
  private keywords: Record<string, number>;

  constructor() {
    this.keywords = scamKeywords as Record<string, number>;
  }

  async analyzeText(text: string): Promise<ScamAnalysisResult> {
    try {
      if (!text || text.trim().length === 0) {
        return { score: 0, foundKeywords: [] };
      }

      const normalizedText = text.toLowerCase();
      const foundKeywords: Array<{ keyword: string; weight: number }> = [];

      // Search for each keyword with flexible spacing
      Object.entries(this.keywords).forEach(([keyword, weight]) => {
        // Create regex with flexible spacing: "wire transfer" matches "wire  transfer", "wiretransfer", etc.
        const flexibleKeyword = keyword.split(/\s+/).join('\\s*');
        const regex = new RegExp(flexibleKeyword, 'gi');

        if (regex.test(normalizedText)) {
          foundKeywords.push({ keyword, weight });
        }
      });

      // Calculate weighted score
      let score = 0;
      const positiveKeywords: string[] = [];
      const negativeKeywords: string[] = [];

      foundKeywords.forEach(({ keyword, weight }) => {
        score += weight;
        if (weight > 0) {
          positiveKeywords.push(keyword);
        } else {
          negativeKeywords.push(keyword);
        }
      });

      // Normalize to 0-100 scale (adjust factor as needed)
      // Assume max 500 points = 100% risk
      score = Math.min(100, Math.max(0, (score / 500) * 100));

      return {
        score: Math.round(score),
        foundKeywords: positiveKeywords,
      };
    } catch (error) {
      return {
        score: 0,
        foundKeywords: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
