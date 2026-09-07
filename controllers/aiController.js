const { GoogleGenerativeAI } = require("@google/generative-ai");

/* ==========================================================================
   Helpers
   ========================================================================== */

/**
 * Wait for a specified amount of time.
 */
const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));


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

  if (
    numericCount / nonEmptyValues.length >= 0.8
  ) {
    return "numeric";
  }

  // Date detection
  const dateCount = nonEmptyValues.filter(
    (value) => {
      if (typeof value !== "string") {
        return false;
      }

      const parsedDate = Date.parse(value);

      return !Number.isNaN(parsedDate);
    }
  ).length;

  if (
    dateCount / nonEmptyValues.length >= 0.8
  ) {
    return "date";
  }

  return "categorical";
};


/**
 * Create a compact statistical profile of the complete dataset.
 *
 * We do NOT send every row directly to Gemini.
 * Statistics are calculated locally from the
 * complete dataset and only the useful profile
 * is sent to Gemini.
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


  /* ------------------------------------------------------------------------
     Detect column types
     ------------------------------------------------------------------------ */

  const columnTypes = {};

  columns.forEach((column) => {
    const values = data.map(
      (row) => row[column]
    );

    columnTypes[column] =
      getColumnType(values);
  });


  /* ------------------------------------------------------------------------
     Numeric statistics
     ------------------------------------------------------------------------ */

  const numericStatistics = {};

  columns
    .filter(
      (column) =>
        columnTypes[column] === "numeric"
    )
    .forEach((column) => {
      const values = data
        .map((row) => Number(row[column]))
        .filter((value) =>
          Number.isFinite(value)
        );

      if (!values.length) {
        return;
      }

      const sorted = [...values].sort(
        (a, b) => a - b
      );

      const sum = values.reduce(
        (total, value) =>
          total + value,
        0
      );

      const mean =
        sum / values.length;

      const median =
        values.length % 2 === 0
          ? (
              sorted[
                values.length / 2 - 1
              ] +
              sorted[
                values.length / 2
              ]
            ) / 2
          : sorted[
              Math.floor(
                values.length / 2
              )
            ];

      numericStatistics[column] = {
        count: values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: Number(
          mean.toFixed(2)
        ),
        median: Number(
          median.toFixed(2)
        ),
      };
    });


  /* ------------------------------------------------------------------------
     Categorical distributions
     ------------------------------------------------------------------------ */

  const categoricalDistributions = {};

  columns
    .filter(
      (column) =>
        columnTypes[column] ===
        "categorical"
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

        counts[key] =
          (counts[key] || 0) + 1;
      });

      const distribution =
        Object.entries(counts)
          .sort(
            (a, b) =>
              b[1] - a[1]
          )
          .slice(0, 10)
          .reduce(
            (
              result,
              [key, count]
            ) => {
              result[key] = count;
              return result;
            },
            {}
          );

      categoricalDistributions[
        column
      ] = distribution;
    });


  /* ------------------------------------------------------------------------
     Missing values
     ------------------------------------------------------------------------ */

  const missingValues = {};

  columns.forEach((column) => {
    const missingCount =
      data.filter(
        (row) =>
          row[column] === null ||
          row[column] === undefined ||
          row[column] === ""
      ).length;

    if (missingCount > 0) {
      missingValues[column] =
        missingCount;
    }
  });


  /* ------------------------------------------------------------------------
     Duplicate rows
     ------------------------------------------------------------------------ */

  const rowSet = new Set();

  let duplicateRows = 0;

  data.forEach((row) => {
    const serializedRow =
      JSON.stringify(row);

    if (
      rowSet.has(serializedRow)
    ) {
      duplicateRows++;
    } else {
      rowSet.add(serializedRow);
    }
  });


  /* ------------------------------------------------------------------------
     Protect sensitive fields
     ------------------------------------------------------------------------ */

  const sensitiveFieldPattern =
    /email|e-mail|phone|mobile|password|token|secret|api.?key/i;

  const safeColumns =
    columns.filter(
      (column) =>
        !sensitiveFieldPattern.test(
          column
        )
    );


  /* ------------------------------------------------------------------------
     Sample rows
     ------------------------------------------------------------------------ */

  const sampleRows = data
    .slice(0, 10)
    .map((row) => {
      const safeRow = {};

      safeColumns.forEach(
        (column) => {
          safeRow[column] =
            row[column];
        }
      );

      return safeRow;
    });


  /* ------------------------------------------------------------------------
     Final profile
     ------------------------------------------------------------------------ */

  return {
    rowCount: data.length,

    columnCount: columns.length,

    columns: columns.map(
      (column) => ({
        name: column,
        type: columnTypes[column],
      })
    ),

    numericStatistics,

    categoricalDistributions,

    missingValues,

    duplicateRows,

    sampleRows,
  };
};


/* ==========================================================================
   Gemini error detection
   ========================================================================== */

/**
 * Detect HTTP status from Gemini SDK errors.
 *
 * The legacy GoogleGenerativeAI SDK may put the
 * HTTP status inside the error message instead
 * of error.status.
 */
const getGeminiErrorStatus = (error) => {
  if (!error) {
    return null;
  }

  // Direct SDK status
  if (error.status) {
    return Number(error.status);
  }

  // Response status
  if (error.response?.status) {
    return Number(
      error.response.status
    );
  }

  const message = String(
    error.message || ""
  );

  const lowerMessage =
    message.toLowerCase();


  // 503 - Service unavailable
  if (
    message.includes("503") ||
    lowerMessage.includes(
      "service unavailable"
    ) ||
    lowerMessage.includes(
      "high demand"
    ) ||
    lowerMessage.includes(
      "temporarily unavailable"
    )
  ) {
    return 503;
  }


  // 429 - Rate limit / quota
  if (
    message.includes("429") ||
    message.includes(
      "RESOURCE_EXHAUSTED"
    ) ||
    lowerMessage.includes(
      "rate limit"
    ) ||
    lowerMessage.includes(
      "quota"
    )
  ) {
    return 429;
  }


  // 401 - Authentication
  if (
    message.includes("401") ||
    lowerMessage.includes(
      "unauthorized"
    )
  ) {
    return 401;
  }


  // 403 - Permission
  if (
    message.includes("403") ||
    lowerMessage.includes(
      "permission denied"
    )
  ) {
    return 403;
  }


  // 404 - Model/API
  if (
    message.includes("404") ||
    lowerMessage.includes(
      "not found"
    )
  ) {
    return 404;
  }


  return null;
};


/* ==========================================================================
   Gemini generation with retry
   ========================================================================== */

/**
 * Generate Gemini response with automatic retry
 * for temporary 503 errors.
 *
 * Retry delays:
 *
 * Attempt 1
 *    ↓
 *   2 sec
 *
 * Attempt 2
 *    ↓
 *   4 sec
 *
 * Attempt 3
 */
const generateWithRetry = async (
  model,
  prompt,
  maxRetries = 2
) => {
  let lastError = null;

  for (
    let attempt = 0;
    attempt <= maxRetries;
    attempt++
  ) {
    try {
      console.log(
        `Gemini request attempt ${
          attempt + 1
        }/${maxRetries + 1}`
      );

      const result =
        await model.generateContent(
          prompt
        );

      return result;

    } catch (error) {
      lastError = error;

      const status =
        getGeminiErrorStatus(
          error
        );

      console.error(
        `Gemini attempt ${
          attempt + 1
        } failed. Status: ${status}`
      );

      // Retry ONLY temporary 503 errors
      if (
        status !== 503 ||
        attempt === maxRetries
      ) {
        throw error;
      }

      const delay =
        2000 *
        Math.pow(
          2,
          attempt
        );

      console.log(
        `Gemini is temporarily busy. ` +
        `Retrying in ${
          delay / 1000
        } seconds...`
      );

      await sleep(delay);
    }
  }

  throw lastError;
};


/* ==========================================================================
   Generate AI Summary
   ========================================================================== */

exports.generateSummary =
  async (req, res) => {
    try {

      /* --------------------------------------------------------------------
         Get dataset
         -------------------------------------------------------------------- */

      const {
        parsedData
      } = req.body;


      /* --------------------------------------------------------------------
         Validate dataset
         -------------------------------------------------------------------- */

      if (
        !parsedData ||
        !Array.isArray(parsedData)
      ) {
        return res.status(400).json({
          error:
            "No valid data provided.",
        });
      }


      /* --------------------------------------------------------------------
         Prevent empty dataset
         -------------------------------------------------------------------- */

      if (
        parsedData.length === 0
      ) {
        return res.status(400).json({
          error:
            "The dataset is empty.",
        });
      }


      /* --------------------------------------------------------------------
         Validate Gemini API key
         -------------------------------------------------------------------- */

      if (
        !process.env.GEMINI_API_KEY
      ) {
        console.error(
          "GEMINI_API_KEY is missing from environment variables."
        );

        return res.status(500).json({
          error:
            "AI service is not configured on the server.",
        });
      }


      /* --------------------------------------------------------------------
         Create Gemini client
         -------------------------------------------------------------------- */

      const genAI =
        new GoogleGenerativeAI(
          process.env.GEMINI_API_KEY
        );


      /* --------------------------------------------------------------------
         Build complete dataset profile
         -------------------------------------------------------------------- */

      console.log(
        `Creating dataset profile for ${parsedData.length} rows...`
      );

      const datasetProfile =
        createDatasetProfile(
          parsedData
        );


      console.log(
        `Dataset profile created: ` +
        `${datasetProfile.rowCount} rows, ` +
        `${datasetProfile.columnCount} columns`
      );


      /* --------------------------------------------------------------------
         Prompt
         -------------------------------------------------------------------- */

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
- Keep the response concise and easy for a non-technical user to understand.

DATASET PROFILE:

${JSON.stringify(
  datasetProfile,
  null,
  2
)}

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


      /* --------------------------------------------------------------------
         Models
         -------------------------------------------------------------------- */

      const models = [
        "gemini-3.7-flash",
        "gemini-3.6-flash",
      ];


      let result = null;
      let successfulModel = null;
      let lastGeminiError = null;


      /* --------------------------------------------------------------------
         Try models with retry
         -------------------------------------------------------------------- */

      for (
        const modelName of models
      ) {

        console.log(
          `Trying Gemini model: ${modelName}`
        );

        try {

          const model =
            genAI.getGenerativeModel({
              model: modelName,
            });


          result =
            await generateWithRetry(
              model,
              prompt,
              2
            );


          successfulModel =
            modelName;

          console.log(
            `Gemini succeeded using ${modelName}`
          );

          break;

        } catch (error) {

          lastGeminiError =
            error;

          const status =
            getGeminiErrorStatus(
              error
            );

          console.error(
            `Model ${modelName} failed with status ${status}`
          );

          /*
           * If the problem is authentication,
           * permission, quota, etc., there is no
           * benefit in trying another model.
           */
          if (
            status === 401 ||
            status === 403 ||
            status === 429
          ) {
            throw error;
          }

          /*
           * For 503/404, move to the next model.
           */
        }
      }


      /* --------------------------------------------------------------------
         No Gemini model succeeded
         -------------------------------------------------------------------- */

      if (!result) {
        throw (
          lastGeminiError ||
          new Error(
            "No Gemini model returned a response."
          )
        );
      }


      /* --------------------------------------------------------------------
         Validate Gemini response
         -------------------------------------------------------------------- */

      if (!result?.response) {
        throw new Error(
          "No response received from Gemini."
        );
      }


      const summary =
        result.response.text();


      /* --------------------------------------------------------------------
         Validate generated text
         -------------------------------------------------------------------- */

      if (
        !summary ||
        !summary.trim()
      ) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }


      /* --------------------------------------------------------------------
         Success
         -------------------------------------------------------------------- */

      console.log(
        `AI summary generated successfully using ${successfulModel}`
      );

      return res.json({
        summary:
          summary.trim(),
      });

    } catch (error) {

      const status =
        getGeminiErrorStatus(
          error
        );


      /* --------------------------------------------------------------------
         Detailed server logging
         -------------------------------------------------------------------- */

      console.error(
        "\n========== GEMINI ERROR =========="
      );

      console.error(
        "Message:",
        error?.message ||
          error
      );

      console.error(
        "Detected status:",
        status
      );

      console.error(
        "=================================\n"
      );


      /* --------------------------------------------------------------------
         Rate limit / quota
         -------------------------------------------------------------------- */

      if (
        status === 429
      ) {
        return res.status(429).json({
          error:
            "AI usage limit reached. Please try again later.",
        });
      }


      /* --------------------------------------------------------------------
         Temporary service unavailable
         -------------------------------------------------------------------- */

      if (
        status === 503
      ) {
        return res.status(503).json({
          error:
            "Gemini is temporarily experiencing high demand. Please try again in a few seconds.",
        });
      }


      /* --------------------------------------------------------------------
         Authentication / permission
         -------------------------------------------------------------------- */

      if (
        status === 401 ||
        status === 403
      ) {
        return res.status(status).json({
          error:
            "AI service authentication failed. Please try again later.",
        });
      }


      /* --------------------------------------------------------------------
         Model/API configuration
         -------------------------------------------------------------------- */

      if (
        status === 404
      ) {
        return res.status(500).json({
          error:
            "AI model is currently unavailable. Please try again later.",
        });
      }


      /* --------------------------------------------------------------------
         Generic error
         -------------------------------------------------------------------- */

      return res.status(500).json({
        error:
          "Unable to generate AI insights right now. Please try again later.",
      });
    }
  };