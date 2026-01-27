const axios = require("axios");
const mongoose = require("mongoose");
const path = require("path");
const xlsx = require("xlsx");
const fs = require("fs");
const FileData = require("../models/FileData");

// ✅ Upload Excel File via Cloudinary URL
const uploadExcel = async (req, res) => {
  try {
    const fileUrl = req.file.path;

    // ✅ Download from Cloudinary URL
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const workbook = xlsx.read(response.data, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = xlsx.utils.sheet_to_json(sheet);

    const fileEntry = new FileData({
      originalName: req.file.originalname,
      savedName: req.file.filename,
      data: jsonData,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: fileUrl,
      user: req.user._id,
    });

    await fileEntry.save();

    res.status(200).json({ message: "File uploaded successfully!", data: jsonData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const getLatestUploadData = async (req, res) => {
  try {
    // ✅ 1. Find the most recent file entry
    const latestFile = await FileData.findOne(
      req.user.role === "admin" ? {} : { user: req.user._id }
    ).sort({ uploadedAt: -1 });

    if (!latestFile) {
      return res.status(404).json({ message: "No uploaded files found" });
    }

    // ✅ 2. Download from Cloudinary URL
    const response = await axios.get(latestFile.path, { responseType: "arraybuffer" });

    // ✅ 3. Convert to JSON
    const workbook = xlsx.read(response.data, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = xlsx.utils.sheet_to_json(sheet);

    res.status(200).json({ data: jsonData });
  } catch (err) {
    console.error("❌ Error in getLatestUploadData:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};



const getHistory = async (req, res) => {
  try {
    const history = req.user.role === "admin"
      ? await FileData.find().sort({ uploadedAt: -1 })
      : await FileData.find({ user: req.user._id }).sort({ uploadedAt: -1 });

    res.json({ history });
  } catch (err) {
    console.error("❌ Error in getHistory:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const getUserFiles = async (req, res) => {
  try {
    const files = await FileData.find({ user: req.user.id })
      .select("_id originalName createdAt")
      .sort({ createdAt: -1 });

    res.json({ files });
  } catch (err) {
    res.status(500).json({ message: "Server error fetching files" });
  }
};

const viewFileData = async (req, res) => {
  try {
    const file = await FileData.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "File not found" });
    res.status(200).json({ data: file.data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const downloadFile = async (req, res) => {
  try {
    const file = await FileData.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "File not found" });

    res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`);
    res.redirect(file.path); 
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const deleteFile = async (req, res) => {
  try {
    const file = await FileData.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "File not found" });

    await FileData.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "File deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  uploadExcel,
  getHistory,
  viewFileData,
  downloadFile,
  deleteFile,
  getUserFiles,
  getLatestUploadData,
};
