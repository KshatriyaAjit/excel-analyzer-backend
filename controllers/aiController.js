const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Generate summary controller
exports.generateSummary = async (req, res) => {
  try {
    const { parsedData } = req.body;
    console.log("Received parsedData length:", parsedData?.length);
    console.log("Gemini API Key:", !!process.env.GEMINI_API_KEY);

    if (!parsedData || !Array.isArray(parsedData)) {
      return res.status(400).json({ error: "No valid data provided." });
    }

    const text = JSON.stringify(parsedData.slice(0, 2), null, 2); // smaller chunk

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const result = await model.generateContent(
      `You are a professional data analyst. Provide a summary of this data:\n\n${text}`
    );

    if (!result?.response) {
      throw new Error("No response from Gemini.");
    }

    const response = await result.response;
    const summary = response.text();

    res.json({ summary });

  } catch (error) {
    console.error("🔥 Gemini AI error:", error?.message || error);
    res.status(500).json({ error: "Failed to generate summary using Gemini." });
  }
};
