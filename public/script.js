const input = document.getElementById("subscriptionText");
const button = document.getElementById("scanButton");
const statusBox = document.getElementById("status");
const resultsBox = document.getElementById("results");
const resultList = document.getElementById("resultList");
const charCount = document.getElementById("charCount");

input.addEventListener("input", () => {
  charCount.textContent = `${input.value.length} / 5000 characters`;
});

button.addEventListener("click", analyzeText);

async function analyzeText() {
  const text = input.value.trim();

  if (!text) {
    statusBox.textContent = "Please paste some subscription text first.";
    return;
  }

  if (text.length > 5000) {
    statusBox.textContent = "Please shorten your text to 5000 characters.";
    return;
  }

  button.disabled = true;
  button.textContent = "Analyzing...";
  statusBox.textContent = "Sending text to the AI model. The first request may take a little while.";
  resultsBox.hidden = true;
  resultList.replaceChildren();

  try {
    const response = await fetch("/.netlify/functions/classify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    if (!Array.isArray(data.results) || data.results.length === 0) {
      throw new Error("The model returned no usable categories.");
    }

    displayResults(data.results);
    resultsBox.hidden = false;
    statusBox.textContent = "Analysis complete.";
  } catch (error) {
    statusBox.textContent =
      `Could not complete the analysis: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "Analyze text →";
  }
}

function displayResults(results) {
  resultList.replaceChildren();

  results.forEach((item) => {
    const score = Number(item.score);

    if (!Number.isFinite(score)) return;

    const percentage = Math.max(0, Math.min(100, score * 100));

    const row = document.createElement("div");
    row.className = "result-row";

    const heading = document.createElement("div");
    heading.className = "result-heading";

    const label = document.createElement("span");
    label.textContent = item.label;

    const value = document.createElement("span");
    value.textContent = `${percentage.toFixed(2)}%`;

    heading.append(label, value);

    const track = document.createElement("div");
    track.className = "bar-track";

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${percentage}%`;

    track.appendChild(bar);
    row.append(heading, track);
    resultList.appendChild(row);
  });
}

const monthlyPriceInput = document.getElementById("monthlyPrice");
const trialDaysInput = document.getElementById("trialDays");
const calculateCostButton = document.getElementById("calculateCostButton");
const calculatorResult = document.getElementById("calculatorResult");

calculateCostButton.addEventListener("click", () => {
  const monthlyPrice = Number(monthlyPriceInput.value);
  const trialDays = Number(trialDaysInput.value);

  if (
    monthlyPriceInput.value.trim() === "" ||
    trialDaysInput.value.trim() === "" ||
    !Number.isFinite(monthlyPrice) ||
    !Number.isInteger(trialDays) ||
    monthlyPrice < 0 ||
    trialDays < 0 ||
    trialDays > 365
  ) {
    calculatorResult.textContent =
      "Enter a valid monthly price and a trial duration from 0 to 365 days.";
    return;
  }

  const yearlyCost = monthlyPrice * 12;

  calculatorResult.textContent =
    `Monthly cost: ₹${monthlyPrice.toFixed(2)}. ` +
    `Cost for 12 paid months: ₹${yearlyCost.toFixed(2)}. ` +
    (trialDays > 0
      ? `The free trial lasts ${trialDays} days before the potential paid period begins.`
      : "No free trial is included.");
});
