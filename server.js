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




const allowedOrigins = [
  "http://localhost:5173",
  "https://exceliq.netlify.app"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors());





app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));



app.use("/api/auth", authRoutes); 
console.log("✅ Upload routes mounted");// all auth routes
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);


app.get("/", (req, res) => {
  res.send("Excel Analyzer Backend is Live");
})




const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
