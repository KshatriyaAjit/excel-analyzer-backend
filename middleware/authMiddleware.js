const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader) return res.status(401).json({ msg: "No token, authorization denied" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ msg: "Token malformed" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) return res.status(401).json({ msg: "User not found" });

    req.user = user;  // ✅ Attach the full user object here

    next();
  } catch (err) {
    res.status(400).json({ msg: "Token is not valid" });
  }
};

module.exports = authMiddleware;
