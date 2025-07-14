const express = require("express");
const connectDB = require("./db");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const adminRoutes = require("./routes/adminRoutes");
const aiRoutes = require("./routes/aiRoutes");

const authRoutes = require("./routes/authRoutes");
const uploadRoutes = require("./routes/uploadRoutes");

dotenv.config();

const app = express();

connectDB(); 
app.use(cors({
  origin: "http://localhost:5173", // your frontend URL
  credentials: true                // allow cookies/auth headers
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));



app.use("/api/auth", authRoutes); 
console.log("✅ Upload routes mounted");// all auth routes
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);




const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
