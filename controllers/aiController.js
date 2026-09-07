const { GoogleGenerativeAI } = require("@google/generative-ai");

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

/**
 * Detect the approximate data type of a column.
 */
const getColumnType = (values) => {
  const nonEmptyValues = values.filter(
    (value) =>
      value !== null &&
      value !== undefined &&
      value !== ""
  );

  if (nonEmptyValues.length === 0) {
    return "empty";
  }

  // Numeric detection
  const numericCount = nonEmptyValues.filter(
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value)
  ).length;

  if (numericCount / nonEmptyValues.length >= 0.8) {
    return "numeric";
  }

  // Date detection
  const dateCount = nonEmptyValues.filter((value) => {
    if (typeof value !== "string") return false;

    const parsedDate = Date.parse(value);

    return !Number.isNaN(parsedDate);
  }).length;

  if (dateCount / nonEmptyValues.length >= 0.8) {
    return "date";
  }

  return "categorical";
};


/**
 * Create a compact statistical profile of the complete dataset.
 *
 * We do NOT send every row directly to Gemini.
 * Instead, we calculate statistics locally and send
 * Gemini the useful information.
 */
const createDatasetProfile = (data) => {
  if (!data.length) {
    return {
      rowCount: 0,
      columnCount: 0,
      columns: [],
      numericStatistics: {},
      categoricalDistributions: {},
      missingValues: {},
      duplicateRows: 0,
      sampleRows: [],
    };
  }

  const columns = Object.keys(data[0]);

  /*
  |--------------------------------------------------------------------------
  | Detect column types
  |--------------------------------------------------------------------------
  */

  const columnTypes = {};

  columns.forEach((column) => {
    const values = data.map((row) => row[column]);

    columnTypes[column] = getColumnType(values);
  });


  /*
  |--------------------------------------------------------------------------
  | Numeric statistics
  |--------------------------------------------------------------------------
  */

  const numericStatistics = {};

  columns
    .filter((column) => columnTypes[column] === "numeric")
    .forEach((column) => {
      const values = data
        .map((row) => Number(row[column]))
        .filter((value) => Number.isFinite(value));

      if (!values.length) return;

      const sorted = [...values].sort(
        (a, b) => a - b
      );

      const sum = values.reduce(
        (total, value) => total + value,
        0
      );

      const mean = sum / values.length;

      const median =
        values.length % 2 === 0
          ? (
              sorted[values.length / 2 - 1] +
              sorted[values.length / 2]
            ) / 2
          : sorted[Math.floor(values.length / 2)];

      numericStatistics[column] = {
        count: values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: Number(mean.toFixed(2)),
        median: Number(median.toFixed(2)),
      };
    });


  /*
  |--------------------------------------------------------------------------
  | Categorical distributions
  |--------------------------------------------------------------------------
  */

  const categoricalDistributions = {};

  columns
    .filter(
      (column) =>
        columnTypes[column] === "categorical"
    )
    .forEach((column) => {
      const counts = {};

      data.forEach((row) => {
        const value = row[column];

        if (
          value === null ||
          value === undefined ||
          value === ""
        ) {
          return;
        }

        const key = String(value);

        counts[key] = (counts[key] || 0) + 1;
      });

      const distribution = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reduce((result, [key, count]) => {
          result[key] = count;

          return result;
        }, {});

      categoricalDistributions[column] =
        distribution;
    });


  /*
  |--------------------------------------------------------------------------
  | Missing values
  |--------------------------------------------------------------------------
  */

  const missingValues = {};

  columns.forEach((column) => {
    const missingCount = data.filter(
      (row) =>
        row[column] === null ||
        row[column] === undefined ||
        row[column] === ""
    ).length;

    if (missingCount > 0) {
      missingValues[column] = missingCount;
    }
  });


  /*
  |--------------------------------------------------------------------------
  | Duplicate rows
  |--------------------------------------------------------------------------
  */

  const rowSet = new Set();

  let duplicateRows = 0;

  data.forEach((row) => {
    const serializedRow = JSON.stringify(row);

    if (rowSet.has(serializedRow)) {
      duplicateRows++;
    } else {
      rowSet.add(serializedRow);
    }
  });


  /*
  |--------------------------------------------------------------------------
  | Protect sensitive fields
  |--------------------------------------------------------------------------
  */

  const sensitiveFieldPattern =
    /email|e-mail|phone|mobile|password|token|secret|api.?key/i;

  const safeColumns = columns.filter(
    (column) =>
      !sensitiveFieldPattern.test(column)
  );


  /*
  |--------------------------------------------------------------------------
  | Sample rows
  |--------------------------------------------------------------------------
  |
  | Only send a small sample to Gemini.
  | The actual statistics above are calculated
  | from the complete dataset.
  |
  */

  const sampleRows = data
    .slice(0, 10)
    .map((row) => {
      const safeRow = {};

      safeColumns.forEach((column) => {
        safeRow[column] = row[column];
      });

      return safeRow;
    });


  /*
  |--------------------------------------------------------------------------
  | Final profile
  |--------------------------------------------------------------------------
  */

  return {
    rowCount: data.length,

    columnCount: columns.length,

    columns: columns.map((column) => ({
      name: column,
      type: columnTypes[column],
    })),

    numericStatistics,

    categoricalDistributions,

    missingValues,

    duplicateRows,

    sampleRows,
  };
};


/*
|--------------------------------------------------------------------------
| Gemini error detection
|--------------------------------------------------------------------------
*/

const getGeminiErrorStatus = (error) => {
  if (!error) return null;

  // Some SDK/API versions expose status directly.
  if (error.status) {
    return Number(error.status);
  }

  if (error.response?.status) {
    return Number(error.response.status);
  }

  /*
   * The legacy GoogleGenerativeAI SDK may sometimes
   * expose the HTTP status only inside the message.
   */
  const message = String(error.message || "");

  if (
    message.includes("429") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("quota")
  ) {
    return 429;
  }

  if (
    message.includes("401") ||
    message.toLowerCase().includes("unauthorized")
  ) {
    return 401;
  }

  if (
    message.includes("403") ||
    message.toLowerCase().includes("permission denied")
  ) {
    return 403;
  }

  if (
    message.includes("404") ||
    message.toLowerCase().includes("not found")
  ) {
    return 404;
  }

  return null;
};


/*
|--------------------------------------------------------------------------
| Generate AI Summary
|--------------------------------------------------------------------------
*/

exports.generateSummary = async (req, res) => {
  try {
    /*
     * Get dataset from request
     */
    const { parsedData } = req.body;


    /*
     * Validate dataset
     */
    if (!parsedData || !Array.isArray(parsedData)) {
      return res.status(400).json({
        error: "No valid data provided.",
      });
    }


    /*
     * Prevent empty dataset requests
     */
    if (parsedData.length === 0) {
      return res.status(400).json({
        error: "The dataset is empty.",
      });
    }


    /*
     * Validate Gemini API key
     */
    if (!process.env.GEMINI_API_KEY) {
      console.error(
        "GEMINI_API_KEY is missing from environment variables."
      );

      return res.status(500).json({
        error:
          "AI service is not configured on the server.",
      });
    }


    /*
     * Create Gemini client
     */
    const genAI = new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY
    );


    /*
     * Use the working Gemini model
     */
    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
    });


    /*
     * Build complete dataset profile
     */
    const datasetProfile =
      createDatasetProfile(parsedData);


    /*
     * Prompt Gemini
     */
    const prompt = `
You are a professional data analyst.

Analyze the following dataset profile and provide
a concise, accurate and useful business-oriented analysis.

IMPORTANT RULES:

- Use only the information provided in the dataset profile.
- Do not invent statistics.
- Do not make unsupported assumptions.
- Use the calculated statistics when discussing numbers.
- Mention data-quality problems only when there is evidence.
- Do not expose private or sensitive information.
- Keep the response concise and easy for a non-technical user
  to understand.

DATASET PROFILE:

${JSON.stringify(datasetProfile, null, 2)}


Your response MUST contain these sections:

1. Overview

Explain:
- What the dataset appears to contain.
- Total number of records.
- Total number of columns.
- Important column types.


2. Important Patterns

Identify:
- Meaningful trends.
- Distributions.
- Differences between categories.
- Important numerical patterns.

Use actual statistics from the dataset profile.


3. Notable Observations

Highlight:
- Unusual values.
- Large differences.
- Missing values.
- Duplicate rows.
- Potential data-quality issues.

Only mention issues supported by the dataset profile.


4. Useful Insights & Recommendations

Provide:
- Practical insights.
- Useful recommendations.
- Potential areas that deserve attention.

Do not make unsupported assumptions.


Keep the final response concise.
Use clear headings and bullet points where appropriate.
`;


    /*
     * Send request to Gemini
     */
    const result =
      await model.generateContent(prompt);


    /*
     * Validate response
     */
    if (!result?.response) {
      throw new Error(
        "No response received from Gemini."
      );
    }


    const summary =
      result.response.text();


    /*
     * Validate generated text
     */
    if (!summary || !summary.trim()) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }


    /*
     * Success
     */
    return res.json({
      summary: summary.trim(),
    });

  } catch (error) {

    const status =
      getGeminiErrorStatus(error);

    console.error(
      "\n========== GEMINI ERROR =========="
    );

    console.error(
      "Message:",
      error?.message || error
    );

    console.error(
      "Detected status:",
      status
    );

    console.error(
      "=================================\n"
    );


    /*
     |--------------------------------------------------------------------------
     | Rate limit / quota
     |--------------------------------------------------------------------------
     */

    if (status === 429) {
      return res.status(429).json({
        error:
          "AI usage limit reached. Please try again later.",
      });
    }


    /*
     |--------------------------------------------------------------------------
     | Authentication / permission
     |--------------------------------------------------------------------------
     */

    if (
      status === 401 ||
      status === 403
    ) {
      return res.status(status).json({
        error:
          "AI service authentication failed. Please try again later.",
      });
    }


    /*
     |--------------------------------------------------------------------------
     | Model/API configuration problem
     |--------------------------------------------------------------------------
     */

    if (status === 404) {
      return res.status(500).json({
        error:
          "AI model is currently unavailable. Please try again later.",
      });
    }


    /*
     |--------------------------------------------------------------------------
     | Generic server error
     |--------------------------------------------------------------------------
     */

    return res.status(500).json({
      error:
        "Unable to generate AI insights right now. Please try again later.",
    });
  }
};