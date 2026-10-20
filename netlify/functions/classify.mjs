
const CATEGORIES = [
  "automatic subscription renewal",
  "free trial converting into a paid subscription",
  "hidden or unclear fees",
  "difficult cancellation policy",
  "clear subscription terms"
];

const GEMINI_TIMEOUT_MS = 22000;

export default async (request) => {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Use a POST request to analyze text." },
      { status: 405 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY is not configured.");

    return Response.json(
      { error: "The server is missing its GEMINI_API_KEY configuration." },
      { status: 500 }
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

  try {
    const prompt = `
You are SubSentry, a tool that analyzes e-commerce subscription wording.

Classify the following text into these five categories:
${CATEGORIES.map((category, i) => `${i + 1}. ${category}`).join("\n")}

Analyze the actual wording. Do not assume a dark pattern exists
without evidence. A clear disclosure may still describe an automatic
renewal, so classify the concepts present in the text.

Return ONLY a JSON object in this exact format:
{
  "results": [
    {"label": "automatic subscription renewal", "score": 0.0},
    {"label": "free trial converting into a paid subscription", "score": 0.0},
    {"label": "hidden or unclear fees", "score": 0.0},
    {"label": "difficult cancellation policy", "score": 0.0},
    {"label": "clear subscription terms", "score": 0.0}
  ]
}

Include every category exactly once. Each score must be between 0 and 1.
Scores should reflect relative relevance and sum to 1.
These are model-estimated relevance scores, not calibrated probabilities.

Text to analyze:
${JSON.stringify(text)}
`;

    const controller = new AbortController();

    const timeoutId = setTimeout(
      () => controller.abort(),
      GEMINI_TIMEOUT_MS
    );

    let upstream;

    try {
      upstream = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
              maxOutputTokens: 800,
              thinkingConfig: {
                thinkingLevel: "low"
              }
            }
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await upstream.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      console.error(
        "Gemini returned a non-JSON response. HTTP status:",
        upstream.status
      );

      return Response.json(
        { error: "The AI service returned an unreadable response." },
        { status: 502 }
      );
    }

    if (!upstream.ok) {
      console.error(
        "Gemini response status:",
        upstream.status,
        "Message:",
        data.error?.message || "No error details provided."
      );

      if (upstream.status === 400) {
        return Response.json(
          { error: "Gemini rejected the request. Check the model and request configuration." },
          { status: 502 }
        );
      }

      if (upstream.status === 401 || upstream.status === 403) {
        return Response.json(
          { error: "The Gemini API key is invalid or does not have access." },
          { status: 502 }
        );
      }

      if (upstream.status === 429) {
        return Response.json(
          { error: "Gemini's request limit was reached. Try again later." },
          { status: 503 }
        );
      }

      return Response.json(
        { error: `Gemini request failed (status ${upstream.status}). Check the deployment logs.` },
        { status: 502 }
      );
    }

    const outputText = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!outputText) {
      console.error(
        "Gemini returned no text. Finish reason:",
        data.candidates?.[0]?.finishReason
      );

      return Response.json(
        { error: "Gemini did not return an analysis. Please try again." },
        { status: 502 }
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(outputText);
    } catch {
      console.error("Gemini returned invalid JSON.");

      return Response.json(
        { error: "The AI returned an unexpected format. Please try again." },
        { status: 502 }
      );
    }

    if (
      !Array.isArray(parsed.results) ||
      parsed.results.length !== CATEGORIES.length
    ) {
      return Response.json(
        { error: "The AI response did not contain all five categories." },
        { status: 502 }
      );
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
        return Response.json(
          { error: "The AI returned invalid category scores." },
          { status: 502 }
        );
      }

      scoresByLabel.set(item.label, item.score);
    }

    const total = [...scoresByLabel.values()]
      .reduce((sum, score) => sum + score, 0);

    if (total <= 0) {
      return Response.json(
        { error: "The AI returned unusable scores. Please try again." },
        { status: 502 }
      );
    }

    const results = CATEGORIES.map(label => ({
      label,
      score: scoresByLabel.get(label) / total
    })).sort((a, b) => b.score - a.score);

    return Response.json({ results });

  } catch (error) {
    if (
      error?.name === "AbortError" ||
      error?.name === "TimeoutError"
    ) {
      console.error(
        `Gemini request timed out after ${GEMINI_TIMEOUT_MS} ms.`
      );

      return Response.json(
        {
          error: "Gemini took too long to respond. Please try again."
        },
        { status: 504 }
      );
    }

    console.error(
      "Classification request failed:",
      error?.message || "Unknown error"
    );

    return Response.json(
      { error: "Could not connect to Gemini. Please try again." },
      { status: 502 }
    );
  }
};
