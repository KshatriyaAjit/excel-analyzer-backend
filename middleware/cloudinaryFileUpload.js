// middleware/cloudinaryFileUpload.js
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const path = require("path");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    return {
      folder: "excel-uploads",
      resource_type: "raw", // For non-image uploads like .xlsx or .csv
      public_id: file.originalname.split(".")[0],
      format: path.extname(file.originalname).slice(1),
    };
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [".xlsx", ".csv"];
  const ext = path.extname(file.originalname);
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Only .xlsx and .csv files are allowed"));
  }
};

const upload = multer({ storage, fileFilter });

module.exports = upload;
