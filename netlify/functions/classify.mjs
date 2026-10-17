const CATEGORIES = [
  "automatic subscription renewal",
  "free trial converting into a paid subscription",
  "hidden or unclear fees",
  "difficult cancellation policy",
  "clear subscription terms"
];

export default async (request) => {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Use a POST request to analyze text." },
      { status: 405 }
    );
  }

  const token = process.env.HF_TOKEN;

  if (!token) {
    return Response.json(
      { error: "The server is missing its HF_TOKEN configuration." },
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

  const text = typeof body.text === "string" ? body.text.trim() : "";

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
    const upstream = await fetch(
      "https://router.huggingface.co/hf-inference/models/facebook/bart-large-mnli",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: text,
          parameters: {
            candidate_labels: CATEGORIES,
            multi_label: false
          }
        })
      }
    );

    const raw = await upstream.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "The AI service returned an unreadable response." },
        { status: 502 }
      );
    }

    if (!upstream.ok) {
      console.error("Hugging Face response:", upstream.status, data);

      if (upstream.status === 401 || upstream.status === 403) {
        return Response.json(
          { error: "The AI token is invalid or lacks inference permission." },
          { status: 502 }
        );
      }

      if (upstream.status === 429) {
        return Response.json(
          { error: "The AI service is rate-limiting requests. Try again later." },
          { status: 503 }
        );
      }

      if (upstream.status === 503) {
        return Response.json(
          { error: "The model may be loading or temporarily unavailable. Try again shortly." },
          { status: 503 }
        );
      }

      if (upstream.status === 402) {
        return Response.json(
          { error: "Inference credits or billing access may be exhausted. Check your Hugging Face account." },
          { status: 503 }
        );
      }

      return Response.json(
        { error: `The AI service failed (status ${upstream.status}). Check the deployment logs.` },
        { status: 502 }
      );
    }

    // Support both the pipeline-style response and label/score arrays.
    let labels;
    let scores;

    if (Array.isArray(data) && data.length > 0 &&
        data[0].labels && data[0].scores) {
      labels = data[0].labels;
      scores = data[0].scores;
    } else if (data.labels && data.scores) {
      labels = data.labels;
      scores = data.scores;
    } else if (Array.isArray(data) &&
               data.every(item => item.label && Number.isFinite(item.score))) {
      const sorted = [...data].sort((a, b) => b.score - a.score);

      return Response.json({
        results: sorted.map(item => ({
          label: item.label,
          score: item.score
        }))
      });
    } else {
      console.error("Unexpected model response:", data);
      return Response.json(
        { error: "The AI response did not contain recognizable labels and scores." },
        { status: 502 }
      );
    }

    const results = labels.map((label, index) => ({
      label,
      score: scores[index]
    })).sort((a, b) => b.score - a.score);

    return Response.json({ results });
  } catch (error) {
    console.error("Classification request failed:", error);

    return Response.json(
      { error: "Could not connect to the AI service. Check the logs and try again." },
      { status: 502 }
    );
  }
};
