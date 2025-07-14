const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Generate summary controller
exports.generateSummary = async (req, res) => {
  try {
    const { parsedData } = req.body;

    if (!parsedData || !Array.isArray(parsedData)) {
      return res.status(400).json({ error: "No valid data provided." });
    }

    const text = JSON.stringify(parsedData.slice(0, 10), null, 2); // limit size

    // ✅ Correct model for v1 API
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const result = await model.generateContent(
      `You are a professional data analyst. Provide a clear and concise summary of the following Excel data:\n\n${text}`
    );

    const response = await result.response;
    const summary = response.text();

    res.json({ summary });

  } catch (error) {
    console.error("🔥 Gemini AI error:", error);
    res.status(500).json({ error: "Failed to generate summary using Gemini." });
  }
};






