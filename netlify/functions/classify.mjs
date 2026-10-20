
const CATEGORIES = [
  "automatic subscription renewal",
  "free trial converting into a paid subscription",
  "hidden or unclear fees",
  "difficult cancellation policy",
  "clear subscription terms"
];

const GEMINI_TIMEOUT_MS = 18000;
const MODEL = "gemini-3.8-flash";

function fallbackAnalysis(text) {
  const value = text.toLowerCase();

  const keywords = {
    "automatic subscription renewal": [
      "automatically renew", "auto-renew", "auto renew",
      "recurring billing", "subscription renews",
      "renews every", "charged monthly", "billed monthly",
      "billed annually", "subscription continues"
    ],
    "free trial converting into a paid subscription": [
      "free trial", "trial period", "trial ends",
      "after the trial", "after 7 days", "after 14 days",
      "converts to paid", "convert to paid",
      "paid subscription", "trial expires"
    ],
    "hidden or unclear fees": [
      "hidden fee", "additional fees", "extra charges",
      "processing fee", "service fee", "fees may apply",
      "at checkout", "not included", "unclear fees",
      "additional charges", "small print"
    ],
    "difficult cancellation policy": [
      "call to cancel", "cancel by phone", "contact support",
      "cancellation policy", "difficult to cancel",
      "cannot cancel online", "can't cancel online",
      "cancellation fee", "no cancellation"
    ],
    "clear subscription terms": [
      "terms and conditions", "cancel anytime",
      "cancel at any time", "monthly price",
      "annual price", "billing date", "clearly stated",
      "no hidden fees", "price will be", "unless cancelled"
    ]
  };

  const scores = CATEGORIES.map(label => {
    const matches = keywords[label].filter(word =>
      value.includes(word)
    ).length;

    return {
      label,
      score: 0.1 + matches
    };
  });

  const total = scores.reduce((sum, item) => sum + item.score, 0);

  return scores
    .map(item => ({
      label: item.label,
      score: item.score / total
    }))
    .sort((a, b) => b.score - a.score);
}

function backupResponse(text, reason) {
  console.warn("Using SubSentry keyword-based backup:", reason);

  return Response.json({
    results: fallbackAnalysis(text),
    fallback: true,
    warning:
      "Gemini was unavailable. These are keyword-based estimates, not AI-generated analysis."
  });
}

export default async (request) => {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Use a POST request to analyze text." },
      { status: 405 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON request." },
      { status: 400 }
    );
  }

  const text = typeof body.text === "string"
    ? body.text.trim()
    : "";

  if (!text) {
    return Response.json(
      { error: "Please provide text to analyze." },
      { status: 400 }
    );
  }

  if (text.length > 5000) {
    return Response.json(
      { error: "Text must be 5000 characters or fewer." },
      { status: 413 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY is not configured.");
    return backupResponse(text, "API key is not configured");
  }

  const prompt = `
You are SubSentry, a subscription wording analysis tool.

Analyze the supplied text for these five concepts:
${CATEGORIES.map((category, i) => `${i + 1}. ${category}`).join("\n")}

Return only JSON in this format:
{
  "results": [
    {"label": "automatic subscription renewal", "score": 0.0},
    {"label": "free trial converting into a paid subscription", "score": 0.0},
    {"label": "hidden or unclear fees", "score": 0.0},
    {"label": "difficult cancellation policy", "score": 0.0},
    {"label": "clear subscription terms", "score": 0.0}
  ]
}

Include every category exactly once. Scores must be non-negative,
at most 1, and sum to 1. Scores are relative relevance estimates,
not calibrated probabilities. Do not assume wrongdoing without evidence.

Text to analyze:
${JSON.stringify(text)}
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    GEMINI_TIMEOUT_MS
  );

  try {
    let upstream;
    let raw;

    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
              maxOutputTokens: 400,
              thinkingConfig: { thinkingLevel: "low" }
            }
          }),
          signal: controller.signal
        }
      );

      raw = await upstream.text();
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        error?.name === "TimeoutError"
      ) {
        return backupResponse(text, "Gemini request timed out");
      }

      console.error("Gemini connection failed:", error?.message);
      return backupResponse(text, "Could not connect to Gemini");
    }

    if (upstream.status === 503 || upstream.status === 429) {
      return backupResponse(text, `Gemini returned ${upstream.status}`);
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      console.error("Gemini returned a non-JSON response.");
      return backupResponse(text, "Gemini returned unreadable data");
    }

    if (!upstream.ok) {
      console.error(
        "Gemini status:",
        upstream.status,
        "Message:",
        data.error?.message || "No details"
      );

      if (upstream.status === 401 || upstream.status === 403) {
        return Response.json(
          { error: "The Gemini API key is invalid or lacks access." },
          { status: 502 }
        );
      }

      if (upstream.status === 400) {
        return Response.json(
          { error: "Gemini rejected the request configuration." },
          { status: 502 }
        );
      }

      return backupResponse(text, `Gemini returned ${upstream.status}`);
    }

    const outputText = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(outputText || "");
    } catch {
      return backupResponse(text, "Gemini returned invalid JSON");
    }

    if (
      !Array.isArray(parsed.results) ||
      parsed.results.length !== CATEGORIES.length
    ) {
      return backupResponse(text, "Gemini returned incomplete results");
    }

    const scoresByLabel = new Map();

    for (const item of parsed.results) {
      if (
        !item ||
        !CATEGORIES.includes(item.label) ||
        !Number.isFinite(item.score) ||
        item.score < 0 ||
        item.score > 1 ||
        scoresByLabel.has(item.label)
      ) {
        return backupResponse(text, "Gemini returned invalid scores");
      }

      scoresByLabel.set(item.label, item.score);
    }

    const total = [...scoresByLabel.values()]
      .reduce((sum, score) => sum + score, 0);

    if (total <= 0) {
      return backupResponse(text, "Gemini returned unusable scores");
    }

    const results = CATEGORIES
      .map(label => ({
        label,
        score: scoresByLabel.get(label) / total
      }))
      .sort((a, b) => b.score - a.score);

    return Response.json({
      results,
      fallback: false
    });

  } catch (error) {
    console.error("Classification failed:", error?.message);
    return backupResponse(text, "Unexpected analysis error");
  } finally {
    clearTimeout(timeoutId);
  }
};
