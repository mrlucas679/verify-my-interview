import { NLPScamDetectionService } from '../../../services/legacy/nlpScamDetectionService';
import { ToolResult } from '../../../types/tool_results';

const nlpService = new NLPScamDetectionService();

function categorizePatterns(keywords: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    payment_methods: [],
    urgency_language: [],
    credential_requests: [],
    work_from_home: [],
    high_pay: [],
  };

  const paymentKeywords = ['wire transfer', 'bitcoin', 'gift card', 'western union', 'money gram'];
  const urgencyKeywords = ['urgent', 'asap', 'immediate', 'hurry'];
  const credentialKeywords = ['password', 'ssn', 'social security', 'bank account', 'credit card'];
  const workFromHomeKeywords = ['work from home', 'remote', 'flexible'];
  const highPayKeywords = ['easy money', 'guaranteed', 'high pay'];

  keywords.forEach((kw) => {
    const lowerKw = kw.toLowerCase();
    if (paymentKeywords.some((p) => lowerKw.includes(p))) categories.payment_methods.push(kw);
    if (urgencyKeywords.some((u) => lowerKw.includes(u))) categories.urgency_language.push(kw);
    if (credentialKeywords.some((c) => lowerKw.includes(c))) categories.credential_requests.push(kw);
    if (workFromHomeKeywords.some((w) => lowerKw.includes(w))) categories.work_from_home.push(kw);
    if (highPayKeywords.some((h) => lowerKw.includes(h))) categories.high_pay.push(kw);
  });

  return categories;
}

export async function scamPatternDetectorAdapter(input: { text: string }): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const result = await nlpService.analyzeText(input.text);

    return {
      tool: 'detect_scam_patterns',
      success: true,
      data: {
        text_length: input.text.length,
        scam_score: result.score || 0, // 0-100
        found_keywords: result.foundKeywords || [],
        keyword_count: (result.foundKeywords || []).length,
        patterns_detected: categorizePatterns(result.foundKeywords || []),
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      tool: 'detect_scam_patterns',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}
