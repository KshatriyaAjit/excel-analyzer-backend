const mongoose = require("mongoose");

const fileDataSchema = new mongoose.Schema({
  originalName: {
    type: String,
    required: true,
  },
  savedName: String, 
  data: Array,
  mimetype: String,
  size: Number,
  path: String,
  uploadedAt: { type: Date, default: Date.now },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

module.exports = mongoose.model("FileData", fileDataSchema);
