const express = require("express");
const {
  uploadExcel,
  getLatestUploadData,
  getHistory,
  viewFileData,
  downloadFile,
  deleteFile,
  getUserFiles
} = require("../controllers/fileUploadController");

const upload = require("../middleware/cloudinaryFileUpload"); 



const auth = require("../middleware/authMiddleware"); // ✅ Add this line

const router = express.Router();

// ✅ Routes that require user context
router.post("/", auth, upload.single("file"), uploadExcel);      // ✅ Now only logged-in users can upload
router.get("/history", auth, getHistory);                  // ✅ Only logged-in users see their own history
router.get("/latest", auth, getLatestUploadData);                // ✅ Optional: protect this too for user-specific context
router.get("/view/:id", auth, viewFileData);                     // ✅ Optional: protect file access
router.get("/download/:id", auth, downloadFile);                 // ✅ Optional: protect file download
router.delete("/delete/:id", auth, deleteFile); 
router.get("/files", auth, getUserFiles);                 // ✅ Optional: protect file delete

module.exports = router;
